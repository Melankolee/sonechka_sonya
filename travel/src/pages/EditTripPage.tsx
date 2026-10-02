// Создание и редактирование поездки: основное (название, место, даты),
// описание поездки (главный PDF) и материалы.
//
// Основное копится в черновике и уходит на сервер кнопкой «Сохранить» (с
// проверкой версии — правка с другого устройства не затирается молча).
// Материалы — сразу, см. MaterialsEditor. После любого изменения на сервере
// вызывается onChanged: главный экран обновляет офлайн-копию на телефоне.
import { useEffect, useMemo, useState } from 'react'
import { GuideEditor, MaterialsEditor } from '../components/MaterialsEditor'
import { Screen } from '../components/ui'
import { back, replace } from '../hooks/useRoute'
import { ApiError, createTrip, deleteTrip, errorText, fetchTrip, listTrips, saveTrip, setActiveTrip, type TripBasics } from '../services/api'
import type { Trip } from '../types/trip'

const basicsOf = (t: TripBasics): string => JSON.stringify([t.title, t.location?.country ?? '', t.location?.place ?? '', t.dateFrom, t.dateTo])

function Basics({ draft, set }: { draft: TripBasics; set: (patch: Partial<TripBasics>) => void }) {
  return (
    <section>
      <h3 className="group-title">Основное</h3>
      <div className="card form">
        <label className="form-field">
          <span className="label">Название</span>
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Мальдивы" />
        </label>
        <div className="two">
          <label className="form-field">
            <span className="label">Страна</span>
            <input value={draft.location?.country ?? ''} onChange={(e) => set({ location: { ...draft.location, country: e.target.value } })} />
          </label>
          <label className="form-field">
            <span className="label">Город или место</span>
            <input value={draft.location?.place ?? ''} onChange={(e) => set({ location: { ...draft.location, place: e.target.value } })} />
          </label>
        </div>
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
  const [draft, setDraft] = useState<TripBasics>({ title: '', location: {}, dateFrom: '', dateTo: '' })
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
      <p className="muted small hint-line">Материалы добавляются на следующем шаге.</p>
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
      setSaved(basicsOf(trip))
      setActive(list.active)
    } catch (e) {
      setLoadError(`${errorText(e)} Редактировать можно только с интернетом.`)
    }
  }

  useEffect(() => {
    void load()
  }, [id])

  const dirty = useMemo(() => !!draft && basicsOf(draft) !== saved, [draft, saved])

  /** Ответ сервера после операции с материалами: версия и материалы — с сервера, правки основного — свои. */
  const fromServer = (t: Trip) => {
    setDraft((d) => (d ? { ...d, version: t.version, documents: t.documents } : t))
    onChanged()
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const trip = await saveTrip(draft)
      setDraft(trip)
      setSaved(basicsOf(trip))
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
    if (!draft || !window.confirm(`Удалить поездку «${draft.title}» вместе со всеми материалами? Это не отменить.`)) return
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

      <GuideEditor trip={draft} onServerTrip={fromServer} />
      <MaterialsEditor trip={draft} onServerTrip={fromServer} />

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
