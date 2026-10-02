// Проверка каталога поездок перед заливкой: node scripts/check-trips.mjs [trips-demo]
//
// Ловит то, что иначе всплыло бы уже на телефоне: битый JSON, нецелую version,
// документ без файла или пустой файл, ссылку documentId на несуществующий
// документ, активную поездку, которой нет в каталоге.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? (existsSync('trips') ? 'trips' : 'trips-demo')
const errors = []
const err = (where, msg) => errors.push(`${where}: ${msg}`)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    err(path, e.code === 'ENOENT' ? 'file not found' : `invalid JSON (${e.message})`)
    return null
  }
}

const index = readJson(join(root, 'index.json'))
const tripDirs = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory())
if (index && !tripDirs.includes(index.active)) err('index.json', `active "${index.active}" has no directory`)

for (const dir of tripDirs) {
  const where = `${dir}/trip.json`
  const trip = readJson(join(root, dir, 'trip.json'))
  if (!trip) continue

  if (trip.id !== dir) err(where, `id "${trip.id}" must match directory name "${dir}"`)
  if (typeof trip.title !== 'string' || !trip.title) err(where, 'title is required')
  if (typeof trip.location?.country !== 'string') err(where, 'location.country is required')
  if (!Number.isInteger(trip.version) || trip.version < 1) err(where, 'version must be a positive integer')
  for (const k of ['dateFrom', 'dateTo']) if (!DATE.test(trip[k] ?? '')) err(where, `${k} must be YYYY-MM-DD`)

  const docs = trip.documents ?? []
  const docIds = new Set()
  let bytes = 0
  for (const d of docs) {
    if (docIds.has(d.id)) err(where, `duplicate document id "${d.id}"`)
    docIds.add(d.id)
    if (!MIMES.has(d.mime)) err(where, `document "${d.id}": unsupported mime "${d.mime}"`)
    const file = join(root, dir, d.file ?? '')
    if (!d.file || !existsSync(file)) err(where, `document "${d.id}": file "${d.file}" not found`)
    else if (statSync(file).size === 0) err(where, `document "${d.id}": file "${d.file}" is empty`)
    else bytes += statSync(file).size
  }

  const times = {
    flights: ['departure', 'arrival'],
    stays: ['checkIn', 'checkOut'],
    transfers: ['departure'],
  }
  for (const [section, fields] of Object.entries(times)) {
    for (const item of trip[section] ?? []) {
      for (const f of fields) {
        if (!DATETIME.test(item[f] ?? '')) err(where, `${section} "${item.id}": ${f} must be YYYY-MM-DDTHH:MM`)
      }
      if (item.documentId && !docIds.has(item.documentId)) err(where, `${section} "${item.id}": documentId "${item.documentId}" not in documents`)
    }
  }
  for (const section of ['flights', 'stays', 'transfers', 'notes', 'checklist']) {
    const ids = (trip[section] ?? []).map((i) => i.id)
    if (ids.some((id) => !id)) err(where, `${section}: every item needs an id`)
    if (new Set(ids).size !== ids.length) err(where, `${section}: duplicate ids`)
  }

  const active = index?.active === dir ? ' (active)' : ''
  console.log(`${dir}${active}: version ${trip.version}, ${docs.length} documents, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log('OK')
