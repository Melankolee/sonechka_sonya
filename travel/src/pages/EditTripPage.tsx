// Создание и редактирование поездки.
//
// Текстовые поля копятся в черновике и уходят на сервер кнопкой «Сохранить»
// (одним PUT, с проверкой версии — правка с другого устройства не затирается
// молча). Документы — отдельно и сразу, см. DocumentsEditor. После любого
// изменения на сервере вызывается onChanged: главный экран обновляет
// офлайн-копию на телефоне.
import { useEffect, useMemo, useState } from 'react'
import { DocumentsEditor } from '../components/DocumentsEditor'
import { ItemsEditor, SECTIONS } from '../components/ItemsEditor'
import { Screen } from '../components/ui'
import { back, replace } from '../hooks/useRoute'
import { ApiError, createTrip, deleteTrip, errorText, fetchTrip, listTrips, saveTrip, setActiveTrip } from '../services/api'
import type { Trip } from '../types/trip'

type SectionKey = keyof typeof SECTIONS
const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[]

/** То, что меняет форма: без версии, документов и служебных полей. */
function editable(t: Trip): string {
  return JSON.stringify([t.title, t.location, t.dateFrom, t.dateTo, ...SECTION_KEYS.map((k) => t[k] ?? [])])
}

function Basics({ draft, set }: { draft: Pick<Trip, 'title' | 'location' | 'dateFrom' | 'dateTo'>; set: (patch: Partial<Trip>) => void }) {
  return (
    <section>
      <h3 className="group-title">Основное</h3>
      <div className="card form">
        <label className="form-field">
          <span className="label">Название</span>
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Мальдивы" />
        </label>
        <label className="form-field">
          <span className="label">Страна</span>
          <input value={draft.location?.country ?? ''} onChange={(e) => set({ location: { ...draft.location, country: e.target.value } })} />
        </label>
        <label className="form-field">
          <span className="label">Город или место</span>
          <input value={draft.location?.place ?? ''} onChange={(e) => set({ location: { ...draft.location, place: e.target.value } })} />
        </label>
        <div className="two">
          <label className="form-field">
            <span className="label">С</span>
            <input type="date" value={draft.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
          </label>
          <label className="form-field">
            <span className="label">По</span>
            <input type="date" value={draft.dateTo} min={draft.dateFrom || undefined} onChange={(e) => set({ dateTo: e.target.value })} />
          </label>
        </div>
      </div>
    </section>
  )
}

export function NewTripPage({ onChanged }: { onChanged: () => void }) {
  const [draft, setDraft] = useState({ title: '', location: {}, dateFrom: '', dateTo: '' } as Pick<Trip, 'title' | 'location' | 'dateFrom' | 'dateTo'>)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const trip = await createTrip(draft)
      onChanged()
      replace(`/edit/${encodeURIComponent(trip.id)}`)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Screen
      title="Новая поездка"
      footer={
        <>
          {error && <p className="error">{error}</p>}
          <button className="button primary" disabled={busy || !draft.title.trim() || !draft.dateFrom || !draft.dateTo} onClick={() => void create()}>
            {busy ? 'Создаю…' : 'Создать'}
          </button>
        </>
      }
    >
      <Basics draft={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
      <p className="muted small hint-line">Перелёты, отель, заметки и документы добавляются на следующем шаге.</p>
    </Screen>
  )
}

export function EditTripPage({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [draft, setDraft] = useState<Trip | null>(null)
  const [saved, setSaved] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    setLoadError(null)
    setError(null)
    setConflict(false)
    try {
      const [trip, list] = await Promise.all([fetchTrip(id), listTrips()])
      setDraft(trip)
      setSaved(editable(trip))
      setActive(list.active)
    } catch (e) {
      setLoadError(`${errorText(e)} Редактировать можно только с интернетом.`)
    }
  }

  useEffect(() => {
    void load()
  }, [id])

  const dirty = useMemo(() => !!draft && editable(draft) !== saved, [draft, saved])

  /** Ответ сервера после операции с документами: версия и документы — с сервера, правки формы — свои. */
  const fromServer = (t: Trip) => {
    setDraft((d) => {
      if (!d) return t
      const ids = new Set((t.documents ?? []).map((x) => x.id))
      // Удалённый документ сервер уже отвязал от рейсов и отелей — в черновике тоже.
      const unlink = <T extends { documentId?: string }>(items?: T[]) =>
        items?.map((item) => (item.documentId && !ids.has(item.documentId) ? { ...item, documentId: undefined } : item))
      return {
        ...d,
        version: t.version,
        documents: t.documents,
        flights: unlink(d.flights),
        stays: unlink(d.stays),
        transfers: unlink(d.transfers),
      }
    })
    onChanged()
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const trip = await saveTrip(draft)
      setDraft(trip)
      setSaved(editable(trip))
      onChanged()
    } catch (e) {
      const isConflict = e instanceof ApiError && e.status === 409
      setConflict(isConflict)
      setError(isConflict ? 'Поездку изменили на другом устройстве. Нажми «Загрузить заново» — несохранённые правки пропадут.' : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const leave = () => {
    if (!dirty || window.confirm('Есть несохранённые изменения. Выйти без сохранения?')) back()
  }

  const makeActive = async () => {
    try {
      await setActiveTrip(id)
      setActive(id)
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const remove = async () => {
    if (!draft || !window.confirm(`Удалить поездку «${draft.title}» вместе со всеми документами? Это не отменить.`)) return
    try {
      await deleteTrip(id)
      onChanged()
      replace('/trips')
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (!draft) {
    return (
      <Screen title="Поездка">
        <p className="placeholder muted">{loadError ?? 'Загрузка…'}</p>
        {loadError && (
          <button className="button" onClick={() => void load()}>
            Повторить
          </button>
        )}
      </Screen>
    )
  }

  return (
    <Screen
      title={draft.title || 'Поездка'}
      onBack={leave}
      footer={
        <>
          {error && <p className="error">{error}</p>}
          {conflict ? (
            <button className="button" onClick={() => void load()}>
              Загрузить заново
            </button>
          ) : (
            <button className="button primary" disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? 'Сохраняю…' : dirty ? 'Сохранить' : 'Сохранено'}
            </button>
          )}
        </>
      }
    >
      <Basics draft={draft} set={(patch) => setDraft((d) => d && { ...d, ...patch })} />

      <DocumentsEditor trip={draft} onServerTrip={fromServer} />

      {SECTION_KEYS.map((key) => (
        <ItemsEditor
          key={key}
          def={SECTIONS[key]}
          items={(draft[key] ?? []) as unknown as ({ id: string } & Record<string, unknown>)[]}
          documents={draft.documents ?? []}
          onChange={(items) => setDraft((d) => d && { ...d, [key]: items })}
        />
      ))}

      <section>
        <h3 className="group-title">Поездка</h3>
        {active === id ? (
          <p className="muted small hint-line">Это активная поездка — она на главном экране.</p>
        ) : (
          <button className="button" onClick={() => void makeActive()}>
            Сделать активной
          </button>
        )}
        <button className="button danger" onClick={() => void remove()}>
          Удалить поездку
        </button>
      </section>
    </Screen>
  )
}
