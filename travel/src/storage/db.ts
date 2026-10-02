// IndexedDB — единственное место, где живёт поездка для офлайна.
//
//   trips      сохранённая поездка (одна запись на id, последняя скачанная версия)
//   documents  метаданные документа: размер, тип, версия — читаются без байтов
//   blobs      сами файлы, ArrayBuffer по тому же ключу, что и в documents
//   sync       версия и время последней успешной синхронизации поездки
//   kv         активная поездка и отметки чеклиста
//
// Файлы хранятся как ArrayBuffer, а не Blob: Blob, прочитанный из IndexedDB в
// Safari, бывает ссылкой на внешний файл и иногда не читается
// ("WebKitBlobResource error"). Байты внутри записи такой проблемы не имеют.
//
// Ключ документа включает версию поездки. Обновление пишет новые файлы рядом
// со старыми и переключает sync только в самом конце, так что оборванная на
// середине загрузка не портит уже сохранённую копию.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Trip } from '../types/trip'

export interface StoredDocument {
  key: string
  tripId: string
  docId: string
  version: number
  mime: string
  size: number
  savedAt: number
}

export interface SyncMetadata {
  tripId: string
  version: number
  syncedAt: number
}

interface TravelDB extends DBSchema {
  trips: { key: string; value: Trip }
  documents: { key: string; value: StoredDocument; indexes: { byTrip: string } }
  blobs: { key: string; value: ArrayBuffer }
  sync: { key: string; value: SyncMetadata }
  kv: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<TravelDB>> | null = null

function db(): Promise<IDBPDatabase<TravelDB>> {
  dbPromise ??= openDB<TravelDB>('travel', 1, {
    upgrade(database) {
      database.createObjectStore('trips', { keyPath: 'id' })
      database.createObjectStore('documents', { keyPath: 'key' }).createIndex('byTrip', 'tripId')
      database.createObjectStore('blobs')
      database.createObjectStore('sync', { keyPath: 'tripId' })
      database.createObjectStore('kv')
    },
  })
  return dbPromise
}

export function documentKey(tripId: string, version: number, docId: string): string {
  return `${tripId}@${version}/${docId}`
}

export async function getActiveTripId(): Promise<string | null> {
  return ((await (await db()).get('kv', 'activeTripId')) as string | undefined) ?? null
}

export async function getTrip(id: string): Promise<Trip | null> {
  return (await (await db()).get('trips', id)) ?? null
}

export async function getSync(tripId: string): Promise<SyncMetadata | null> {
  return (await (await db()).get('sync', tripId)) ?? null
}

/** Метаданные документов поездки нужной версии, без чтения самих файлов. */
export async function getDocumentMeta(tripId: string, version: number): Promise<Map<string, StoredDocument>> {
  const all = await (await db()).getAllFromIndex('documents', 'byTrip', tripId)
  return new Map(all.filter((d) => d.version === version).map((d) => [d.docId, d]))
}

export async function getDocumentData(key: string): Promise<ArrayBuffer | null> {
  return (await (await db()).get('blobs', key)) ?? null
}

export async function putDocument(meta: StoredDocument, data: ArrayBuffer): Promise<void> {
  const tx = (await db()).transaction(['documents', 'blobs'], 'readwrite')
  await Promise.all([tx.objectStore('documents').put(meta), tx.objectStore('blobs').put(data, meta.key), tx.done])
}

/**
 * Последний шаг синхронизации: поездка, её версия и активность — одной
 * транзакцией. До этого момента приложение видит предыдущую версию.
 */
export async function commitTrip(trip: Trip, syncedAt: number): Promise<void> {
  const tx = (await db()).transaction(['trips', 'sync', 'kv'], 'readwrite')
  await Promise.all([
    tx.objectStore('trips').put(trip),
    tx.objectStore('sync').put({ tripId: trip.id, version: trip.version, syncedAt }),
    tx.objectStore('kv').put(trip.id, 'activeTripId'),
    tx.done,
  ])
}

/**
 * Удаляет всё, что не относится к активной поездке в её текущей версии:
 * файлы прошлых версий, недокачанные файлы оборванного обновления, прежние
 * поездки. Место на iPhone не бесконечное.
 */
export async function pruneExcept(tripId: string, version: number): Promise<void> {
  const tx = (await db()).transaction(['trips', 'documents', 'blobs', 'sync'], 'readwrite')
  const docs = tx.objectStore('documents')
  for (const doc of await docs.getAll()) {
    if (doc.tripId !== tripId || doc.version !== version) {
      await docs.delete(doc.key)
      await tx.objectStore('blobs').delete(doc.key)
    }
  }
  for (const id of await tx.objectStore('trips').getAllKeys()) {
    if (id !== tripId) {
      await tx.objectStore('trips').delete(id)
      await tx.objectStore('sync').delete(id)
    }
  }
  await tx.done
}

export async function getChecked(tripId: string): Promise<string[]> {
  return ((await (await db()).get('kv', `checklist:${tripId}`)) as string[] | undefined) ?? []
}

export async function setChecked(tripId: string, ids: string[]): Promise<void> {
  await (await db()).put('kv', ids, `checklist:${tripId}`)
}
