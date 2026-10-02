// Даты из trip.json — без часового пояса, поэтому разбираются и форматируются
// в UTC: так день не съезжает, где бы ни находился телефон.

function utcDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })

/** «5–10 октября», «28 сентября – 3 октября». */
export function formatDateRange(from: string, to: string): string {
  return dayMonth.formatRange(utcDate(from), utcDate(to))
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
