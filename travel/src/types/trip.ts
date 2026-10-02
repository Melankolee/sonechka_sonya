// Формат данных поездки. Источник — /trips/<id>/trip.json. Пишет его
// server/travel-api.py по тому, что введено в интерфейсе.
//
// Даты — "YYYY-MM-DD", показываются как есть, без пересчёта часовых поясов.

/** /trips/index.json — какая поездка сейчас активна. Остальные лежат рядом. */
export interface TripIndex {
  active: string | null
}

export interface Trip {
  id: string
  title: string
  location: Location
  dateFrom: string
  dateTo: string
  /** Сервер увеличивает при любой правке поездки или её материалов. */
  version: number
  /** Материалы поездки — загруженные файлы; описание поездки (main) — первым. */
  documents?: TripDocument[]
}

export interface Location {
  country?: string
  /** Город, атолл, регион — что удобнее для заголовка. */
  place?: string
}

export interface TripDocument {
  id: string
  title: string
  /** Путь относительно каталога поездки: "documents/d-1a2b3c.pdf". */
  file: string
  /** application/pdf, image/jpeg, image/png, image/webp, image/heic. */
  mime: string
  /** Размер в байтах. Файл после загрузки не меняется: новый файл — новый id. */
  size?: number
  uploadedAt?: string
  /** Описание поездки: один PDF, показывается отдельно над остальными. */
  main?: boolean
}

/** Строка списка поездок (GET /api/trips). */
export interface TripSummary {
  id: string
  title: string
  location?: Location
  dateFrom: string
  dateTo: string
  version: number
}
