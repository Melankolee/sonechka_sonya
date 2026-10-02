// Проверка, что поездку действительно можно открыть без сети. Смотрит на то,
// что лежит в хранилищах прямо сейчас, а не на факт былого нажатия кнопки.
import { getActiveTripId, getDocumentData, getDocumentMeta, getSync, getTrip } from '../storage/db'
import type { TripDocument } from '../types/trip'

export interface ShellStatus {
  total: number
  cached: number
  missing: string[]
}

export interface Verification {
  /** null — Service Worker не установлен (dev-сервер, приватный режим, ещё ставится). */
  shell: ShellStatus | null
  shellOk: boolean
  tripSaved: boolean
  version: number | null
  total: number
  available: number
  missing: TripDocument[]
  ready: boolean
}

/** Просит активный Service Worker сверить свой precache с кешем. */
export async function checkShell(): Promise<ShellStatus | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  const worker = reg?.active
  if (!worker) return null
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 5000)
    channel.port1.onmessage = (e: MessageEvent<ShellStatus>) => {
      clearTimeout(timer)
      resolve(e.data)
    }
    worker.postMessage({ type: 'CHECK_SHELL' }, [channel.port2])
  })
}

export async function verifyOffline(): Promise<Verification> {
  const shell = await checkShell().catch(() => null)
  const shellOk = !!shell && shell.total > 0 && shell.missing.length === 0

  const id = await getActiveTripId()
  const trip = id ? await getTrip(id) : null
  const sync = id ? await getSync(id) : null
  if (!trip || !sync) {
    return { shell, shellOk, tripSaved: false, version: null, total: 0, available: 0, missing: [], ready: false }
  }

  const documents = trip.documents ?? []
  const meta = await getDocumentMeta(trip.id, sync.version)
  const missing: TripDocument[] = []
  // По одному: файлы читаются целиком, держать все в памяти разом незачем.
  for (const doc of documents) {
    const m = meta.get(doc.id)
    const data = m ? await getDocumentData(m.key) : null
    if (!m || !data || data.byteLength === 0 || data.byteLength !== m.size) missing.push(doc)
  }

  const versionOk = sync.version === trip.version
  return {
    shell,
    shellOk,
    tripSaved: true,
    version: sync.version,
    total: documents.length,
    available: documents.length - missing.length,
    missing,
    ready: shellOk && versionOk && missing.length === 0,
  }
}
