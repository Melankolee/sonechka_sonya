// Даты и время из trip.json — местные для точки и без часового пояса, поэтому
// разбираются как UTC и форматируются в UTC: так часы не съезжают, где бы ни
// находился телефон.

function utcDate(value: string): Date {
  const [date, time = '00:00'] = value.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, h || 0, min || 0))
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const shortDay = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** «5–10 октября», «28 сентября – 3 октября». */
export function formatDateRange(from: string, to: string): string {
  return dayMonth.formatRange(utcDate(from), utcDate(to))
}

/** «пн, 5 окт.». */
export function formatDay(value: string): string {
  return shortDay.format(utcDate(value))
}

/** "09:40". Пустая строка, если времени в значении нет. */
export function formatTime(value: string): string {
  return value.includes('T') ? value.slice(11, 16) : ''
}

export function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10)
}

/** Время синхронизации — по часам телефона: «4 октября, 21:32». */
export function formatSyncedAt(ms: number): string {
  const d = new Date(ms)
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d)
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d)
  return `${date}, ${time}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}

export function documentType(mime: string): string {
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('image/')) return mime.slice(6).toUpperCase().replace('JPEG', 'JPG')
  return 'Файл'
}

/** Склонение: plural(5, 'заметка', 'заметки', 'заметок') → «заметок». */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
