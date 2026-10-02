// Всё, что ходит в сеть. Запросы — относительные и same-origin, cookie
// входа (travel_session) уходит с ними сама. Без неё Caddy отвечает 401 —
// это AuthError, и главный экран показывает форму входа.
//
// Чтение (/trips/…) — статика, её отдаёт Caddy. Запись (/api/…) — сервис
// server/travel-api.py.
import type { Trip, TripDocument, TripIndex, TripSummary } from '../types/trip'

/** Сеть недоступна или сервер не ответил. Пользователю показывается просто «Офлайн». */
export class NetworkError extends Error {}

/** Нет cookie входа или она устарела (сменили пароль). */
export class AuthError extends Error {}

/** Сервер ответил отказом; message — готовый текст для пользователя. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly trip?: Trip,
  ) {
    super(message)
  }
}

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
  if (res.status === 401) throw new AuthError(url)
  if (!res.ok) throw new NetworkError(`${url}: HTTP ${res.status}`)
  return res
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Активная поездка с сервера; null — поездок нет совсем. */
export async function fetchActiveTrip(): Promise<Trip | null> {
  const index = (await (await request('/trips/index.json', CHECK_TIMEOUT_MS)).json()) as TripIndex
  if (!index.active) return null
  return fetchTrip(index.active)
}

export async function fetchTrip(id: string): Promise<Trip> {
  const trip = (await (await request(`/trips/${encodeURIComponent(id)}/trip.json`, CHECK_TIMEOUT_MS)).json()) as Trip
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
  trip.location ??= {}
}

// ---------- редактирование ----------

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new NetworkError(url)
  }
  if (res.status === 401) throw new AuthError(url)
  const data = (await res.json().catch(() => ({}))) as { error?: string; trip?: Trip }
  if (!res.ok) throw new ApiError(data.error ?? `Ошибка сервера (${res.status})`, res.status, data.trip)
  return data as T
}

/** Вход: сервер ставит cookie на 400 дней. */
export function login(password: string): Promise<{ ok: true }> {
  return call('POST', '/api/login', { password })
}

export function listTrips(): Promise<{ active: string | null; trips: TripSummary[] }> {
  return call('GET', '/api/trips')
}

export type TripBasics = Pick<Trip, 'title' | 'location' | 'dateFrom' | 'dateTo'>

export function createTrip(basics: TripBasics): Promise<Trip> {
  return call('POST', '/api/trips', basics)
}

export function saveTrip(trip: Trip): Promise<Trip> {
  return call('PUT', `/api/trips/${encodeURIComponent(trip.id)}`, { baseVersion: trip.version, trip })
}

export function deleteTrip(id: string): Promise<{ active: string | null }> {
  return call('DELETE', `/api/trips/${encodeURIComponent(id)}`)
}

export function setActiveTrip(id: string): Promise<{ active: string }> {
  return call('POST', '/api/active', { id })
}

export function renameDocument(tripId: string, docId: string, title: string): Promise<Trip> {
  return call('PATCH', `/api/trips/${encodeURIComponent(tripId)}/documents/${encodeURIComponent(docId)}`, { title })
}

export function deleteDocument(tripId: string, docId: string): Promise<Trip> {
  return call('DELETE', `/api/trips/${encodeURIComponent(tripId)}/documents/${encodeURIComponent(docId)}`)
}

/**
 * Загрузка файла. Через XMLHttpRequest, а не fetch: только он сообщает
 * прогресс отправки, а PDF по мобильной сети может ехать долго.
 */
export function uploadDocument(
  tripId: string,
  file: File,
  title: string,
  onProgress: (fraction: number) => void,
  main = false,
): Promise<Trip> {
  const query = new URLSearchParams({ title, ...(main && { main: '1' }) })
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/trips/${encodeURIComponent(tripId)}/documents?${query}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onerror = () => reject(new NetworkError('upload'))
    xhr.onload = () => {
      let data: { error?: string } & Partial<Trip> = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        // ответ не JSON — например, 413 от Caddy
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Trip)
      else if (xhr.status === 401) reject(new AuthError('upload'))
      else reject(new ApiError(data.error ?? (xhr.status === 413 ? 'Файл слишком большой' : `Ошибка сервера (${xhr.status})`), xhr.status))
    }
    xhr.send(file)
  })
}

/** Текст ошибки для экрана. */
export function errorText(e: unknown): string {
  if (e instanceof AuthError) return 'Нужно войти — вернись на главный экран.'
  if (e instanceof ApiError) return e.message
  if (e instanceof NetworkError) return 'Нет связи с сервером.'
  return 'Что-то пошло не так.'
}
