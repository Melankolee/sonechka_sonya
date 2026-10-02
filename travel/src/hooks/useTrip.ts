// Состояние поездки на главном экране.
//
// Порядок при запуске: сначала сохранённая копия из IndexedDB (мгновенно и без
// сети), затем проверка офлайн-готовности, затем — тихий запрос trip.json с
// сервера. Если сервер недоступен, это просто «Offline», без ошибок. Если на
// сервере версия новее, показывается «Trip update available»; документы сами
// не качаются, только по кнопке.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getActiveTripId, getDocumentMeta, getSync, getTrip, type StoredDocument, type SyncMetadata } from '../storage/db'
import { fetchActiveTrip } from '../services/api'
import { DownloadError, downloadTrip, type DownloadProgress } from '../services/sync'
import { verifyOffline, type Verification } from '../services/verify'
import type { Trip } from '../types/trip'

export type Network = 'checking' | 'online' | 'offline'

export interface TripState {
  /** Что показывается: сохранённая копия, а если её нет — серверная. */
  trip: Trip | null
  isLocal: boolean
  sync: SyncMetadata | null
  docs: Map<string, StoredDocument>
  remote: Trip | null
  network: Network
  verification: Verification | null
  download: DownloadProgress | null
  downloadError: string | null
  loaded: boolean
}

interface Local {
  trip: Trip
  sync: SyncMetadata | null
  docs: Map<string, StoredDocument>
}

async function loadLocal(): Promise<Local | null> {
  const id = await getActiveTripId()
  const trip = id ? await getTrip(id) : null
  if (!trip) return null
  const sync = await getSync(trip.id)
  return { trip, sync, docs: await getDocumentMeta(trip.id, sync?.version ?? trip.version) }
}

const initial: TripState = {
  trip: null,
  isLocal: false,
  sync: null,
  docs: new Map(),
  remote: null,
  network: 'checking',
  verification: null,
  download: null,
  downloadError: null,
  loaded: false,
}

export function useTrip() {
  const [state, setState] = useState<TripState>(initial)
  const downloading = useRef(false)

  const verify = useCallback(async () => {
    const verification = await verifyOffline().catch(() => null)
    setState((s) => ({ ...s, verification }))
  }, [])

  const checkRemote = useCallback(async () => {
    try {
      const remote = await fetchActiveTrip()
      setState((s) => ({ ...s, remote, network: 'online', trip: s.isLocal ? s.trip : remote }))
    } catch {
      setState((s) => ({ ...s, network: 'offline' }))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const local = await loadLocal().catch(() => null)
      if (cancelled) return
      setState((s) => ({ ...s, loaded: true, ...(local && { trip: local.trip, isLocal: true, sync: local.sync, docs: local.docs }) }))
      void verify()
      void checkRemote()
    })()

    const onOnline = () => void checkRemote()
    const onOffline = () => setState((s) => ({ ...s, network: 'offline' }))
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkRemote()
    }
    // Service Worker при первой установке докачивает оболочку уже после
    // открытия страницы — когда он берёт управление, проверка повторяется.
    const onController = () => void verify()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    navigator.serviceWorker?.addEventListener('controllerchange', onController)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      navigator.serviceWorker?.removeEventListener('controllerchange', onController)
    }
  }, [verify, checkRemote])

  const downloadForOffline = useCallback(async () => {
    if (downloading.current) return
    downloading.current = true
    setState((s) => ({ ...s, download: { steps: [], finished: false }, downloadError: null }))
    try {
      const remote = await downloadTrip((download) => setState((s) => ({ ...s, download })))
      const local = await loadLocal()
      setState((s) => ({
        ...s,
        remote,
        network: 'online',
        ...(local && { trip: local.trip, isLocal: true, sync: local.sync, docs: local.docs }),
      }))
    } catch (e) {
      const message = e instanceof DownloadError ? e.message : 'Download failed.'
      setState((s) => ({ ...s, downloadError: `${message} Previously saved data is untouched.` }))
    } finally {
      downloading.current = false
      await verify()
    }
  }, [verify])

  const { trip, remote, isLocal } = state
  const updateAvailable = !!(isLocal && trip && remote && (remote.id !== trip.id || remote.version > trip.version))
  const isDownloading = !!state.download && !state.download.finished && !state.downloadError

  return { ...state, updateAvailable, isDownloading, downloadForOffline, verify }
}
