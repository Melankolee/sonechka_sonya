// Документ внутри приложения. Источник — IndexedDB; сеть используется, только
// если файла на телефоне нет и интернет есть (поездка ещё не скачана).
import { lazy, Suspense, useEffect, useState } from 'react'
import { Screen } from '../components/ui'
import type { Network } from '../hooks/useTrip'
import { fetchDocument } from '../services/api'
import { saveToFiles } from '../services/share'
import { getDocumentData, type StoredDocument } from '../storage/db'
import type { Trip, TripDocument } from '../types/trip'

// pdf.js весит ~0.5 МБ — грузится только при открытии PDF. Чанк всё равно
// лежит в precache, так что офлайн он тоже есть.
const PdfViewer = lazy(() => import('../components/PdfViewer'))

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; file: File; fromNetwork: boolean }
  | { status: 'missing' }
  | { status: 'error' }

interface Props {
  trip: Trip
  doc: TripDocument
  stored: StoredDocument | undefined
  network: Network
}

export function DocumentPage({ trip, doc, stored, network }: Props) {
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const fileName = doc.file.split('/').pop() || `${doc.id}.pdf`

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let data = stored ? await getDocumentData(stored.key).catch(() => null) : null
      let fromNetwork = false
      if (!data?.byteLength && network !== 'offline') {
        data = await fetchDocument(trip, doc).catch(() => null)
        fromNetwork = !!data
      }
      if (cancelled) return
      if (!data?.byteLength) {
        setState({ status: network === 'offline' || !stored ? 'missing' : 'error' })
        return
      }
      // File готовится сразу, чтобы «Save to Files» вызывал Share Sheet без
      // ожидания — иначе Safari не считает это жестом пользователя.
      setState({ status: 'ready', file: new File([data], fileName, { type: doc.mime }), fromNetwork })
    })()
    return () => {
      cancelled = true
    }
    // network намеренно не в зависимостях: смена статуса сети не должна
    // перезагружать уже открытый документ.
  }, [trip, doc, stored, fileName])

  const action =
    state.status === 'ready' ? (
      <button className="link" onClick={() => saveToFiles(state.file)}>
        Save to Files
      </button>
    ) : null

  return (
    <Screen title={doc.title} action={action} flush>
      {state.status === 'loading' && <p className="placeholder muted">Loading…</p>}
      {state.status === 'missing' && (
        <p className="placeholder muted">This document isn’t saved on this device. Download the trip for offline while connected.</p>
      )}
      {state.status === 'error' && <p className="placeholder muted">Could not open this document.</p>}
      {state.status === 'ready' && (
        <>
          {state.fromNetwork && <p className="notice">Opened from the server — not saved for offline yet.</p>}
          <Viewer file={state.file} />
        </>
      )}
    </Screen>
  )
}

function Viewer({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  const isImage = file.type.startsWith('image/')

  useEffect(() => {
    if (!isImage) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, isImage])

  if (file.type === 'application/pdf') {
    return (
      <Suspense fallback={<p className="placeholder muted">Loading…</p>}>
        <PdfViewer file={file} />
      </Suspense>
    )
  }
  if (isImage) return url ? <img className="doc-image" src={url} alt={file.name} /> : null
  return <p className="placeholder muted">No preview for this file type. Use “Save to Files” to open it in another app.</p>
}
