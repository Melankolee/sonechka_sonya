// Формат данных поездки. Источник — /trips/<id>/trip.json, описание полей и
// пример — в README.md и trips-demo/maldives-2026/trip.json.
//
// Даты — "YYYY-MM-DD", время — местное для точки, без часового пояса:
// "2026-10-05T09:40". Приложение показывает его как есть и ничего не
// пересчитывает, поэтому вылет в Москве и прилёт в Мале читаются так же, как в
// билете.

/** /trips/index.json — какая поездка сейчас активна. Остальные могут лежать рядом. */
export interface TripIndex {
  active: string
}

export interface Trip {
  id: string
  title: string
  location: Location
  dateFrom: string
  dateTo: string
  /** Увеличивается вручную при любой правке поездки или её документов. */
  version: number
  flights?: Flight[]
  stays?: Stay[]
  transfers?: Transfer[]
  notes?: Note[]
  checklist?: ChecklistItem[]
  documents?: TripDocument[]
}

export interface Location {
  country: string
  /** Город, атолл, регион — что удобнее для заголовка. */
  place?: string
}

export interface Airport {
  code: string
  city: string
  terminal?: string
}

export interface Flight {
  id: string
  /** Подпись над рейсом: "Outbound", "Return", "Connection". */
  label?: string
  airline: string
  flightNumber: string
  from: Airport
  to: Airport
  departure: string
  arrival: string
  bookingRef?: string
  seat?: string
  baggage?: string
  notes?: string
  /** id документа из documents, который открывается кнопкой у рейса. */
  documentId?: string
}

export interface Stay {
  id: string
  name: string
  address?: string
  checkIn: string
  checkOut: string
  room?: string
  board?: string
  bookingRef?: string
  phone?: string
  notes?: string
  documentId?: string
}

export interface Transfer {
  id: string
  title: string
  /** "Seaplane", "Speedboat", "Car"… — свободный текст. */
  mode?: string
  departure: string
  from: string
  to: string
  provider?: string
  phone?: string
  bookingRef?: string
  notes?: string
  documentId?: string
}

export interface Note {
  id: string
  title: string
  /** Абзацы разделяются пустой строкой. */
  text: string
}

export interface ChecklistItem {
  id: string
  text: string
  group?: string
}

export type DocumentKind = 'guide' | 'flight' | 'hotel' | 'transfer' | 'insurance' | 'visa' | 'other'

export interface TripDocument {
  id: string
  title: string
  kind: DocumentKind
  /** Путь относительно каталога поездки: "documents/flights.pdf". */
  file: string
  /** application/pdf, image/jpeg, image/png. */
  mime: string
  /** Размер в байтах, если известен заранее. После скачивания берётся фактический. */
  size?: number
}
