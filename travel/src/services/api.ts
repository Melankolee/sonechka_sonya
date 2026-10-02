// Всё, что ходит в сеть. Запросы — относительные и same-origin, так что
// HTTP-авторизация перед сайтом (basic_auth в Caddy) работает без правок кода.
import type { Trip, TripDocument, TripIndex } from '../types/trip'

/** Сеть недоступна или сервер не ответил. Пользователю показывается просто «Offline». */
export class NetworkError extends Error {}

const CHECK_TIMEOUT_MS = 10_000

async function request(url: string, timeoutMs?: number): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      // Мимо HTTP-кеша: иначе Safari может показать вчерашнюю версию поездки.
      cache: 'no-store',
      credentials: 'same-origin',
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    })
  } catch {
    throw new NetworkError(url)
  }
  if (!res.ok) throw new NetworkError(`${url}: HTTP ${res.status}`)
  return res
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export async function fetchActiveTrip(): Promise<Trip> {
  const index = (await (await request('/trips/index.json', CHECK_TIMEOUT_MS)).json()) as TripIndex
  const trip = (await (await request(`/trips/${encodeURIComponent(index.active)}/trip.json`, CHECK_TIMEOUT_MS)).json()) as Trip
  assertTrip(trip)
  return trip
}

export async function fetchDocument(trip: Trip, doc: TripDocument): Promise<ArrayBuffer> {
  // ?v= — на случай промежуточного кеша, который игнорирует no-store.
  const url = `/trips/${encodeURIComponent(trip.id)}/${encodePath(doc.file)}?v=${trip.version}`
  return (await request(url)).arrayBuffer()
}

function assertTrip(trip: Trip): void {
  const ok =
    typeof trip?.id === 'string' &&
    typeof trip.title === 'string' &&
    Number.isInteger(trip.version) &&
    /^\d{4}-\d{2}-\d{2}$/.test(trip.dateFrom) &&
    /^\d{4}-\d{2}-\d{2}$/.test(trip.dateTo)
  if (!ok) throw new Error('trip.json: missing id, title, integer version or dates')
  const ids = (trip.documents ?? []).map((d) => d.id)
  if (new Set(ids).size !== ids.length) throw new Error('trip.json: duplicate document ids')
}
