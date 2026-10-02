// Документы поездки в режиме редактирования. В отличие от остальных полей,
// всё здесь уходит на сервер сразу: загрузка, переименование, удаление.
import { useRef, useState } from 'react'
import { deleteDocument, errorText, updateDocument, uploadDocument } from '../services/api'
import { documentType, formatSize } from '../services/format'
import type { DocumentKind, Trip, TripDocument } from '../types/trip'

export const KINDS: { id: DocumentKind; label: string }[] = [
  { id: 'flight', label: 'Билет' },
  { id: 'hotel', label: 'Бронь отеля' },
  { id: 'transfer', label: 'Трансфер' },
  { id: 'insurance', label: 'Страховка' },
  { id: 'visa', label: 'Виза' },
  { id: 'guide', label: 'Путеводитель' },
  { id: 'other', label: 'Другое' },
]

/** Тип по имени файла — чтобы чаще всего не приходилось выбирать руками. */
function guessKind(name: string): DocumentKind {
  const n = name.toLowerCase()
  if (/ticket|boarding|flight|билет|рейс|посадоч/.test(n)) return 'flight'
  if (/hotel|booking|voucher|отел|брон/.test(n)) return 'hotel'
  if (/transfer|трансфер/.test(n)) return 'transfer'
  if (/insur|polic|страх|полис/.test(n)) return 'insurance'
  if (/visa|виза/.test(n)) return 'visa'
  if (/guide|путевод|программ/.test(n)) return 'guide'
  return 'other'
}

interface Upload {
  key: string
  name: string
  progress: number
  error?: string
}

export function DocumentsEditor({ trip, onServerTrip }: { trip: Trip; onServerTrip: (t: Trip) => void }) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const documents = trip.documents ?? []

  const upload = async (files: FileList) => {
    setError(null)
    // По одному: параллельные загрузки по мобильной сети только мешают друг другу.
    for (const file of [...files]) {
      const key = `${file.name}-${file.size}-${Math.random()}`
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }])
      try {
        const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Документ'
        const next = await uploadDocument(trip.id, file, { title, kind: guessKind(file.name) }, (p) =>
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))),
        )
        onServerTrip(next)
        setUploads((u) => u.filter((x) => x.key !== key))
      } catch (e) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: errorText(e) } : x)))
      }
    }
  }

  const run = async (fn: () => Promise<Trip>) => {
    setError(null)
    try {
      onServerTrip(await fn())
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <section>
      <h3 className="group-title">Документы</h3>
      <p className="muted small hint-line">Файлы сохраняются сразу, без кнопки «Сохранить».</p>
      {documents.map((d) => (
        <DocumentRow
          key={d.id}
          doc={d}
          onRename={(title) => void run(() => updateDocument(trip.id, d.id, { title }))}
          onKind={(kind) => void run(() => updateDocument(trip.id, d.id, { kind }))}
          onDelete={() => {
            if (window.confirm(`Удалить «${d.title}»?`)) void run(() => deleteDocument(trip.id, d.id))
          }}
        />
      ))}
      {uploads.map((u) => (
        <div key={u.key} className="card upload">
          <p>{u.name}</p>
          {u.error ? (
            <p className="error">
              {u.error}{' '}
              <button className="link" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>
                Скрыть
              </button>
            </p>
          ) : (
            <div className="bar">
              <span style={{ width: `${Math.round(u.progress * 100)}%` }} />
            </div>
          )}
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files)
          e.target.value = ''
        }}
      />
      <button className="button add" onClick={() => input.current?.click()}>
        + Загрузить документ
      </button>
    </section>
  )
}

function DocumentRow({
  doc,
  onRename,
  onKind,
  onDelete,
}: {
  doc: TripDocument
  onRename: (title: string) => void
  onKind: (kind: DocumentKind) => void
  onDelete: () => void
}) {
  const [title, setTitle] = useState(doc.title)
  return (
    <div className="card doc-edit">
      <div className="form">
        <label className="form-field">
          <span className="label">
            Название · {documentType(doc.mime)}
            {doc.size ? ` · ${formatSize(doc.size)}` : ''}
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title.trim() !== doc.title && onRename(title.trim())}
          />
        </label>
        <label className="form-field">
          <span className="label">Тип</span>
          <select value={doc.kind} onChange={(e) => onKind(e.target.value as DocumentKind)}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <button className="button danger small" onClick={onDelete}>
          Удалить документ
        </button>
      </div>
    </div>
  )
}
