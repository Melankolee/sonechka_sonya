// «Скачать для офлайна»: свежий trip.json и все документы — в IndexedDB.
//
// Документ на сервере после загрузки не меняется (новый файл — новый id),
// поэтому файл, который уже лежит на телефоне от прошлой версии, не качается
// заново, а копируется локально. После правки текста поездки синхронизация
// занимает долю секунды.
//
// Каждый файл после записи читается обратно и сверяется по размеру. Поездка
// становится локальной версией только после того, как легли все файлы
// (commitTrip), поэтому оборванная загрузка оставляет прежнюю копию целой.
import { clearAll, commitTrip, documentKey, findStoredDocument, getDocumentData, getTrip, pruneExcept, putDocument } from '../storage/db'
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

/** Возвращает сохранённую поездку; null — на сервере поездок нет, локальная копия стёрта. */
export async function downloadTrip(onProgress: (p: DownloadProgress) => void): Promise<Trip | null> {
  const steps: DownloadStep[] = [{ id: 'trip', label: 'Данные поездки', status: 'active' }]
  const report = (finished = false) => onProgress({ steps: steps.map((s) => ({ ...s })), finished })
  const fail = (step: DownloadStep, message: string): never => {
    step.status = 'failed'
    report()
    throw new DownloadError(message)
  }
  report()

  let trip: Trip | null
  try {
    trip = await fetchActiveTrip()
  } catch (e) {
    return fail(steps[0], e instanceof NetworkError ? 'Нет связи с сервером.' : 'Данные поездки на сервере повреждены.')
  }
  if (!trip) {
    await clearAll()
    steps[0].status = 'done'
    report(true)
    return null
  }
  const documents = trip.documents ?? []
  steps[0].status = 'done'
  steps.push(...documents.map((d) => ({ id: d.id, label: d.title, status: 'pending' as StepStatus })))
  report()

  for (const [i, doc] of documents.entries()) {
    const step = steps[i + 1]
    step.status = 'active'
    report()

    const previous = await findStoredDocument(trip.id, doc.id, doc.size)
    let data: ArrayBuffer | null = previous ? await getDocumentData(previous.key) : null
    if (!data?.byteLength) {
      try {
        data = await fetchDocument(trip, doc)
      } catch {
        return fail(step, `Не удалось скачать «${doc.title}».`)
      }
    }
    if (data.byteLength === 0) fail(step, `«${doc.title}» на сервере пустой.`)

    const key = documentKey(trip.id, trip.version, doc.id)
    try {
      await putDocument(
        { key, tripId: trip.id, docId: doc.id, version: trip.version, mime: doc.mime, size: data.byteLength, savedAt: Date.now() },
        data,
      )
    } catch (e) {
      const quota = e instanceof DOMException && e.name === 'QuotaExceededError'
      return fail(step, quota ? 'На телефоне не хватает места.' : `Не удалось сохранить «${doc.title}».`)
    }
    const back = await getDocumentData(key)
    if (back?.byteLength !== data.byteLength) fail(step, `«${doc.title}» сохранился с ошибкой.`)

    step.status = 'done'
    report()
  }

  await commitTrip(trip, Date.now())
  const saved = await getTrip(trip.id)
  if (saved?.version !== trip.version) fail(steps[0], 'Данные поездки сохранились с ошибкой.')
  await pruneExcept(trip.id, trip.version)

  // Просьба не вытеснять данные при нехватке места. Отказ не критичен:
  // приложение с экрана «Домой» Safari и так не чистит по таймеру.
  await navigator.storage?.persist?.().catch(() => false)

  report(true)
  return trip
}
