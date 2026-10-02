// «Download trip for offline»: свежий trip.json и все документы — в IndexedDB.
//
// Каждый файл после записи читается обратно и сверяется по размеру. Поездка
// становится локальной версией только после того, как легли все файлы
// (commitTrip), поэтому оборванная загрузка оставляет прежнюю копию целой.
import { commitTrip, documentKey, getDocumentData, getTrip, pruneExcept, putDocument } from '../storage/db'
import type { Trip } from '../types/trip'
import { fetchActiveTrip, fetchDocument, NetworkError } from './api'

export type StepStatus = 'pending' | 'active' | 'done' | 'failed'

export interface DownloadStep {
  id: string
  label: string
  status: StepStatus
}

export interface DownloadProgress {
  steps: DownloadStep[]
  finished: boolean
}

export class DownloadError extends Error {}

export async function downloadTrip(onProgress: (p: DownloadProgress) => void): Promise<Trip> {
  const steps: DownloadStep[] = [{ id: 'trip', label: 'Trip information', status: 'active' }]
  const report = (finished = false) => onProgress({ steps: steps.map((s) => ({ ...s })), finished })
  const fail = (step: DownloadStep, message: string): never => {
    step.status = 'failed'
    report()
    throw new DownloadError(message)
  }
  report()

  let trip: Trip
  try {
    trip = await fetchActiveTrip()
  } catch (e) {
    return fail(steps[0], e instanceof NetworkError ? 'No connection to the server.' : 'Trip data on the server is invalid.')
  }
  const documents = trip.documents ?? []
  steps[0].status = 'done'
  steps.push(...documents.map((d) => ({ id: d.id, label: d.title, status: 'pending' as StepStatus })))
  report()

  for (const [i, doc] of documents.entries()) {
    const step = steps[i + 1]
    step.status = 'active'
    report()

    let data: ArrayBuffer
    try {
      data = await fetchDocument(trip, doc)
    } catch {
      return fail(step, `Could not download “${doc.title}”.`)
    }
    if (data.byteLength === 0) fail(step, `“${doc.title}” is empty on the server.`)

    const key = documentKey(trip.id, trip.version, doc.id)
    try {
      await putDocument(
        { key, tripId: trip.id, docId: doc.id, version: trip.version, mime: doc.mime, size: data.byteLength, savedAt: Date.now() },
        data,
      )
    } catch (e) {
      const quota = e instanceof DOMException && e.name === 'QuotaExceededError'
      return fail(step, quota ? 'Not enough storage on this device.' : `Could not save “${doc.title}”.`)
    }
    const back = await getDocumentData(key)
    if (back?.byteLength !== data.byteLength) fail(step, `“${doc.title}” was not saved correctly.`)

    step.status = 'done'
    report()
  }

  await commitTrip(trip, Date.now())
  const saved = await getTrip(trip.id)
  if (saved?.version !== trip.version) fail(steps[0], 'Trip information was not saved correctly.')
  await pruneExcept(trip.id, trip.version)

  // Просьба не вытеснять данные при нехватке места. Отказ не критичен:
  // приложение с Home Screen Safari и так не чистит по таймеру.
  await navigator.storage?.persist?.().catch(() => false)

  report(true)
  return trip
}
