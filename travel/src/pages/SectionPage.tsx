import type { ReactNode } from 'react'
import { Check, Field, Screen } from '../components/ui'
import { useChecklist } from '../hooks/useChecklist'
import { go, type SectionId } from '../hooks/useRoute'
import { formatDay, formatTime, sameDay } from '../services/format'
import type { Flight, Note, Stay, Transfer, Trip } from '../types/trip'

const TITLES: Record<SectionId, string> = {
  flights: 'Перелёты',
  stays: 'Проживание',
  transfers: 'Трансфер',
  notes: 'Заметки',
  checklist: 'Чеклист',
}

export function SectionPage({ trip, section }: { trip: Trip; section: SectionId }) {
  return (
    <Screen title={TITLES[section] ?? ''}>
      {section === 'flights' && trip.flights?.map((f) => <FlightCard key={f.id} flight={f} trip={trip} />)}
      {section === 'stays' && trip.stays?.map((s) => <StayCard key={s.id} stay={s} trip={trip} />)}
      {section === 'transfers' && trip.transfers?.map((t) => <TransferCard key={t.id} transfer={t} trip={trip} />)}
      {section === 'notes' && trip.notes?.map((n) => <NoteCard key={n.id} note={n} />)}
      {section === 'checklist' && <Checklist trip={trip} />}
    </Screen>
  )
}

/** «09:40 · пн, 5 окт.» */
function When({ value }: { value?: string }) {
  if (!value) return null
  const time = formatTime(value)
  return (
    <>
      {time && <strong>{time}</strong>}
      {time && ' · '}
      {formatDay(value)}
    </>
  )
}

function DocButton({ trip, id }: { trip: Trip; id?: string }) {
  const doc = id ? trip.documents?.find((d) => d.id === id) : undefined
  if (!doc) return null
  return (
    <button className="button small" onClick={() => go(`/doc/${encodeURIComponent(doc.id)}`)}>
      Открыть: {doc.title}
    </button>
  )
}

function Phone({ value }: { value?: string }) {
  if (!value) return null
  return <a href={`tel:${value.replace(/[^\d+]/g, '')}`}>{value}</a>
}

function Paragraphs({ text }: { text?: string }): ReactNode {
  if (!text) return null
  return text.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)
}

function FlightCard({ flight: f, trip }: { flight: Flight; trip: Trip }) {
  return (
    <article className="card">
      {f.label && <p className="eyebrow">{f.label}</p>}
      <div className="route">
        <div>
          <span className="code">{f.from?.code || '—'}</span>
          <span className="muted small">{f.from?.city}</span>
        </div>
        <span className="route-arrow" aria-hidden="true">
          →
        </span>
        <div className="end">
          <span className="code">{f.to?.code || '—'}</span>
          <span className="muted small">{f.to?.city}</span>
        </div>
      </div>
      <dl>
        <Field label="Рейс">{[f.airline, f.flightNumber].filter(Boolean).join(' · ')}</Field>
        <Field label="Вылет">
          {f.departure && (
            <>
              <When value={f.departure} />
              {f.from?.terminal && ` · терминал ${f.from.terminal}`}
            </>
          )}
        </Field>
        <Field label="Прилёт">
          {f.arrival && (
            <>
              {f.departure && sameDay(f.departure, f.arrival) ? <strong>{formatTime(f.arrival)}</strong> : <When value={f.arrival} />}
              {f.to?.terminal && ` · терминал ${f.to.terminal}`}
            </>
          )}
        </Field>
        <Field label="Бронь">{f.bookingRef}</Field>
        <Field label="Место">{f.seat}</Field>
        <Field label="Багаж">{f.baggage}</Field>
      </dl>
      <Paragraphs text={f.notes} />
      <DocButton trip={trip} id={f.documentId} />
    </article>
  )
}

function StayCard({ stay: s, trip }: { stay: Stay; trip: Trip }) {
  return (
    <article className="card">
      <h4>{s.name}</h4>
      {s.address && <p className="muted">{s.address}</p>}
      <dl>
        <Field label="Заезд">{s.checkIn && <When value={s.checkIn} />}</Field>
        <Field label="Выезд">{s.checkOut && <When value={s.checkOut} />}</Field>
        <Field label="Номер">{s.room}</Field>
        <Field label="Питание">{s.board}</Field>
        <Field label="Бронь">{s.bookingRef}</Field>
        <Field label="Телефон">{s.phone && <Phone value={s.phone} />}</Field>
      </dl>
      <Paragraphs text={s.notes} />
      <DocButton trip={trip} id={s.documentId} />
    </article>
  )
}

function TransferCard({ transfer: t, trip }: { transfer: Transfer; trip: Trip }) {
  return (
    <article className="card">
      {t.mode && <p className="eyebrow">{t.mode}</p>}
      <h4>{t.title}</h4>
      <dl>
        <Field label="Когда">{t.departure && <When value={t.departure} />}</Field>
        <Field label="Откуда">{t.from}</Field>
        <Field label="Куда">{t.to}</Field>
        <Field label="Компания">{t.provider}</Field>
        <Field label="Телефон">{t.phone && <Phone value={t.phone} />}</Field>
        <Field label="Бронь">{t.bookingRef}</Field>
      </dl>
      <Paragraphs text={t.notes} />
      <DocButton trip={trip} id={t.documentId} />
    </article>
  )
}

function NoteCard({ note }: { note: Note }) {
  return (
    <article className="card note">
      <h4>{note.title}</h4>
      <Paragraphs text={note.text} />
    </article>
  )
}

function Checklist({ trip }: { trip: Trip }) {
  const { checked, toggle } = useChecklist(trip.id)
  const items = trip.checklist ?? []
  const groups = [...new Set(items.map((i) => i.group ?? ''))]
  return (
    <>
      {groups.map((g) => (
        <section key={g}>
          {g && <h3 className="group-title">{g}</h3>}
          <ul className="list checklist">
            {items
              .filter((i) => (i.group ?? '') === g)
              .map((i) => (
                <li key={i.id}>
                  <label className={checked.has(i.id) ? 'row done' : 'row'}>
                    <input type="checkbox" checked={checked.has(i.id)} onChange={() => toggle(i.id)} />
                    <span className="box" aria-hidden="true">
                      <Check />
                    </span>
                    <span className="row-title">{i.text}</span>
                  </label>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  )
}
