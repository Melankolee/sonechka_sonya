// Материалы поездки в режиме редактирования: загруженные файлы и под ними
// всегда одно пустое поле «Добавить материал». Загрузил — файл встал в список,
// ниже снова пустое поле. Всё уходит на сервер сразу, без «Сохранить».
import { useRef, useState } from 'react'
import { deleteDocument, errorText, renameDocument, uploadDocument } from '../services/api'
import { documentType, formatSize } from '../services/format'
import type { Trip, TripDocument } from '../types/trip'

interface Upload {
  key: string
  name: string
  progress: number
  error?: string
}

/** «bilet_moskva-male.pdf» → «bilet moskva male». */
function titleFromName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Материал'
}

export function MaterialsEditor({ trip, onServerTrip }: { trip: Trip; onServerTrip: (t: Trip) => void }) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const materials = trip.documents ?? []

  const upload = async (files: File[]) => {
    setError(null)
    const queued = files.map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, progress: 0 }))
    setUploads((u) => [...u, ...queued])
    // По одному: параллельные загрузки по мобильной сети только мешают друг другу.
    for (const [i, file] of files.entries()) {
      const { key } = queued[i]
      try {
        const next = await uploadDocument(trip.id, file, titleFromName(file.name), (p) =>
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
      <h3 className="group-title">Материалы</h3>
      <ul className="materials">
        {materials.map((m, i) => (
          <Material
            key={m.id}
            n={i + 1}
            doc={m}
            onRename={(title) => void run(() => renameDocument(trip.id, m.id, title))}
            onDelete={() => {
              if (window.confirm(`Удалить «${m.title}»?`)) void run(() => deleteDocument(trip.id, m.id))
            }}
          />
        ))}
        {uploads.map((u) => (
          <li key={u.key} className="material">
            <span className="material-n" />
            <div className="material-main">
              <p className="material-name">{u.name}</p>
              {u.error ? (
                <p className="error small">
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
          </li>
        ))}
        <li>
          <button className="material-add" onClick={() => input.current?.click()}>
            <span className="material-plus" aria-hidden="true">
              +
            </span>
            <span>
              Добавить материал
              <span className="muted small">PDF или фото</span>
            </span>
          </button>
        </li>
      </ul>
      {error && <p className="error">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void upload(files)
        }}
      />
    </section>
  )
}

function Material({ n, doc, onRename, onDelete }: { n: number; doc: TripDocument; onRename: (title: string) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(doc.title)
  return (
    <li className="material">
      <span className="material-n">{n}</span>
      <div className="material-main">
        <input
          className="material-title"
          aria-label="Название"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const t = title.trim()
            if (!t) setTitle(doc.title)
            else if (t !== doc.title) onRename(t)
          }}
        />
        <span className="muted small">
          {documentType(doc.mime)}
          {doc.size ? ` · ${formatSize(doc.size)}` : ''}
        </span>
      </div>
      <button className="material-delete" aria-label={`Удалить «${doc.title}»`} onClick={onDelete}>
        ✕
      </button>
    </li>
  )
}
