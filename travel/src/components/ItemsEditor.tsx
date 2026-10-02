// Редактор одного раздела поездки (перелёты, проживание, трансфер, заметки,
// чеклист): список карточек, каждая раскрывается в форму. Поля раздела описаны
// в SECTIONS ниже — добавить поле в форму значит добавить строку туда (и то же
// поле в SECTIONS сервера, server/travel-api.py).
import { useState } from 'react'
import type { Airport, TripDocument } from '../types/trip'

type Item = { id: string } & Record<string, unknown>

type FieldDef =
  | { key: string; label: string; type: 'text' | 'tel' | 'datetime' | 'textarea'; placeholder?: string }
  | { key: string; label: string; type: 'airport' }
  | { key: string; label: string; type: 'document' }

export interface SectionDef {
  title: string
  add: string
  empty: string
  summary: (item: Item) => string
  fields: FieldDef[]
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export const SECTIONS = {
  flights: {
    title: 'Перелёты',
    add: 'Добавить перелёт',
    empty: 'Перелёт',
    summary: (i) => {
      const from = (i.from as Airport | undefined)?.code
      const to = (i.to as Airport | undefined)?.code
      return [from || to ? `${from || '…'} → ${to || '…'}` : '', str(i.flightNumber), str(i.label)].filter(Boolean).join(' · ')
    },
    fields: [
      { key: 'label', label: 'Подпись', type: 'text', placeholder: 'Туда, Обратно, Пересадка' },
      { key: 'airline', label: 'Авиакомпания', type: 'text' },
      { key: 'flightNumber', label: 'Номер рейса', type: 'text', placeholder: 'SU 321' },
      { key: 'from', label: 'Откуда', type: 'airport' },
      { key: 'to', label: 'Куда', type: 'airport' },
      { key: 'departure', label: 'Вылет (местное время)', type: 'datetime' },
      { key: 'arrival', label: 'Прилёт (местное время)', type: 'datetime' },
      { key: 'bookingRef', label: 'Код брони', type: 'text' },
      { key: 'seat', label: 'Место', type: 'text' },
      { key: 'baggage', label: 'Багаж', type: 'text', placeholder: '1 × 23 кг' },
      { key: 'notes', label: 'Заметка', type: 'textarea' },
      { key: 'documentId', label: 'Документ', type: 'document' },
    ],
  },
  stays: {
    title: 'Проживание',
    add: 'Добавить отель',
    empty: 'Отель',
    summary: (i) => str(i.name),
    fields: [
      { key: 'name', label: 'Название', type: 'text' },
      { key: 'address', label: 'Адрес', type: 'text' },
      { key: 'checkIn', label: 'Заезд', type: 'datetime' },
      { key: 'checkOut', label: 'Выезд', type: 'datetime' },
      { key: 'room', label: 'Номер', type: 'text' },
      { key: 'board', label: 'Питание', type: 'text', placeholder: 'Завтраки' },
      { key: 'bookingRef', label: 'Номер брони', type: 'text' },
      { key: 'phone', label: 'Телефон', type: 'tel' },
      { key: 'notes', label: 'Заметка', type: 'textarea' },
      { key: 'documentId', label: 'Документ', type: 'document' },
    ],
  },
  transfers: {
    title: 'Трансфер',
    add: 'Добавить трансфер',
    empty: 'Трансфер',
    summary: (i) => [str(i.title), str(i.mode)].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Название', type: 'text', placeholder: 'Аэропорт → отель' },
      { key: 'mode', label: 'Транспорт', type: 'text', placeholder: 'Такси, катер, гидросамолёт' },
      { key: 'departure', label: 'Когда', type: 'datetime' },
      { key: 'from', label: 'Откуда', type: 'text' },
      { key: 'to', label: 'Куда', type: 'text' },
      { key: 'provider', label: 'Компания', type: 'text' },
      { key: 'phone', label: 'Телефон', type: 'tel' },
      { key: 'bookingRef', label: 'Номер брони', type: 'text' },
      { key: 'notes', label: 'Заметка', type: 'textarea' },
      { key: 'documentId', label: 'Документ', type: 'document' },
    ],
  },
  notes: {
    title: 'Заметки',
    add: 'Добавить заметку',
    empty: 'Заметка',
    summary: (i) => str(i.title),
    fields: [
      { key: 'title', label: 'Заголовок', type: 'text' },
      { key: 'text', label: 'Текст', type: 'textarea' },
    ],
  },
  checklist: {
    title: 'Чеклист',
    add: 'Добавить пункт',
    empty: 'Пункт',
    summary: (i) => str(i.text),
    fields: [
      { key: 'text', label: 'Что сделать', type: 'text' },
      { key: 'group', label: 'Группа', type: 'text', placeholder: 'Документы, Вещи…' },
    ],
  },
} satisfies Record<string, SectionDef>

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface Props {
  def: SectionDef
  items: Item[]
  documents: TripDocument[]
  onChange: (items: Item[]) => void
}

export function ItemsEditor({ def, items, documents, onChange }: Props) {
  const [open, setOpen] = useState<string | null>(null)

  const set = (id: string, key: string, value: unknown) =>
    onChange(
      items.map((item) => {
        if (item.id !== id) return item
        const next = { ...item }
        const empty = value === '' || (typeof value === 'object' && value !== null && Object.values(value).every((v) => !v))
        if (empty) delete next[key]
        else next[key] = value
        return next
      }),
    )

  const add = () => {
    const id = newId()
    onChange([...items, { id }])
    setOpen(id)
  }

  const remove = (id: string) => {
    if (window.confirm('Удалить?')) onChange(items.filter((i) => i.id !== id))
  }

  return (
    <section>
      <h3 className="group-title">{def.title}</h3>
      {items.map((item) => (
        <details key={item.id} className="card item" open={open === item.id} onToggle={(e) => {
            const isOpen = e.currentTarget.open
            setOpen((o) => (isOpen ? item.id : o === item.id ? null : o))
          }}>
          <summary>{def.summary(item) || def.empty}</summary>
          <div className="form">
            {def.fields.map((f) => (
              <FieldInput key={f.key} def={f} value={item[f.key]} documents={documents} onChange={(v) => set(item.id, f.key, v)} />
            ))}
            <button className="button danger small" onClick={() => remove(item.id)}>
              Удалить
            </button>
          </div>
        </details>
      ))}
      <button className="button add" onClick={add}>
        + {def.add}
      </button>
    </section>
  )
}

function FieldInput({ def, value, documents, onChange }: { def: FieldDef; value: unknown; documents: TripDocument[]; onChange: (v: unknown) => void }) {
  if (def.type === 'airport') {
    const a = (value as Airport | undefined) ?? {}
    const part = (k: keyof Airport, v: string) => onChange({ ...a, [k]: v })
    return (
      <div className="form-field">
        <span className="label">{def.label}</span>
        <div className="airport">
          <input value={a.code ?? ''} onChange={(e) => part('code', e.target.value.toUpperCase())} placeholder="Код" autoCapitalize="characters" maxLength={8} />
          <input value={a.city ?? ''} onChange={(e) => part('city', e.target.value)} placeholder="Город" />
          <input value={a.terminal ?? ''} onChange={(e) => part('terminal', e.target.value)} placeholder="Терм." />
        </div>
      </div>
    )
  }
  return (
    <label className="form-field">
      <span className="label">{def.label}</span>
      {def.type === 'textarea' ? (
        <textarea value={str(value)} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : def.type === 'document' ? (
        <select value={str(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={def.type === 'datetime' ? 'datetime-local' : def.type}
          value={str(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'placeholder' in def ? def.placeholder : undefined}
        />
      )}
    </label>
  )
}
