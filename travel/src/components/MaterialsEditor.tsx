// Файлы поездки в режиме редактирования. Два блока:
//
//   «Описание поездки» — один главный PDF (main), отдельно и сверху. Новый
//                        заменяет прежний.
//   «Материалы»        — остальные файлы и под ними всегда одно пустое поле
//                        «Добавить материал»: загрузил — файл встал в список,
//                        ниже снова пустое поле.
//
// Всё уходит на сервер сразу, без «Сохранить». Название правится прямо в строке.
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

type OnServerTrip = (t: Trip) => void

function useFiles(trip: Trip, onServerTrip: OnServerTrip) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [error, setError] = useState<string | null>(null)

  const upload = async (files: File[], main = false) => {
    setError(null)
    const queued = files.map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, progress: 0 }))
    setUploads((u) => [...u, ...queued])
    // По одному: параллельные загрузки по мобильной сети только мешают друг другу.
    for (const [i, file] of files.entries()) {
      const { key } = queued[i]
      try {
        const title = main ? 'Описание поездки' : titleFromName(file.name)
        const next = await uploadDocument(trip.id, file, title, (p) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))), main)
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

  const rename = (doc: TripDocument, title: string) => void run(() => renameDocument(trip.id, doc.id, title))
  const remove = (doc: TripDocument) => {
    if (window.confirm(`Удалить «${doc.title}»?`)) void run(() => deleteDocument(trip.id, doc.id))
  }
  const dismiss = (key: string) => setUploads((x) => x.filter((y) => y.key !== key))

  return { uploads, error, upload, rename, remove, dismiss }
}

export function GuideEditor({ trip, onServerTrip }: { trip: Trip; onServerTrip: OnServerTrip }) {
  const files = useFiles(trip, onServerTrip)
  const input = useRef<HTMLInputElement>(null)
  const guide = trip.documents?.find((d) => d.main)

  const pick = () => {
    if (!guide || window.confirm(`Заменить «${guide.title}» новым PDF?`)) input.current?.click()
  }

  return (
    <section>
      <h3 className="group-title">Описание поездки</h3>
      <ul className="materials">
        {guide && <Material key={guide.id} doc={guide} onRename={(t) => files.rename(guide, t)} onDelete={() => files.remove(guide)} />}
        {files.uploads.map((u) => (
          <Uploading key={u.key} upload={u} onDismiss={() => files.dismiss(u.key)} />
        ))}
        {files.uploads.length === 0 && (
          <li>
            <button className="material-add" onClick={pick}>
              <span className="material-plus" aria-hidden="true">
                {guide ? '↻' : '+'}
              </span>
              <span>
                {guide ? 'Заменить описание' : 'Загрузить описание поездки'}
                <span className="muted small">Один PDF — показывается над материалами</span>
              </span>
            </button>
          </li>
        )}
      </ul>
      {files.error && <p className="error">{files.error}</p>}
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ''
          if (list.length) void files.upload(list.slice(0, 1), true)
        }}
      />
    </section>
  )
}

export function MaterialsEditor({ trip, onServerTrip }: { trip: Trip; onServerTrip: OnServerTrip }) {
  const files = useFiles(trip, onServerTrip)
  const input = useRef<HTMLInputElement>(null)
  const materials = (trip.documents ?? []).filter((d) => !d.main)

  return (
    <section>
      <h3 className="group-title">Материалы</h3>
      <ul className="materials">
        {materials.map((m, i) => (
          <Material key={m.id} n={i + 1} doc={m} onRename={(t) => files.rename(m, t)} onDelete={() => files.remove(m)} />
        ))}
        {files.uploads.map((u) => (
          <Uploading key={u.key} upload={u} onDismiss={() => files.dismiss(u.key)} />
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
      {files.error && <p className="error">{files.error}</p>}
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ''
          if (list.length) void files.upload(list)
        }}
      />
    </section>
  )
}

function Uploading({ upload: u, onDismiss }: { upload: Upload; onDismiss: () => void }) {
  return (
    <li className="material">
      <span className="material-n" />
      <div className="material-main">
        <p className="material-name">{u.name}</p>
        {u.error ? (
          <p className="error small">
            {u.error}{' '}
            <button className="link" onClick={onDismiss}>
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
  )
}

function Material({ n, doc, onRename, onDelete }: { n?: number; doc: TripDocument; onRename: (title: string) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(doc.title)
  return (
    <li className="material">
      <span className="material-n">{n ?? '★'}</span>
      <div className="material-main">
        <label className="material-title-wrap">
          <input
            className="material-title"
            aria-label="Название"
            value={title}
            enterKeyHint="done"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            onBlur={() => {
              const t = title.trim()
              if (!t) setTitle(doc.title)
              else if (t !== doc.title) onRename(t)
            }}
          />
          <span className="material-pencil" aria-hidden="true">
            ✎
          </span>
        </label>
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
