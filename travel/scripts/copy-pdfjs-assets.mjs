// Кладёт в public/pdfjs/ то, что pdf.js подгружает по сети во время рендера:
// стандартные шрифты, CMaps, ICC-профиль и wasm-декодеры картинок. Из public/
// они попадают в сборку и в precache Service Worker, поэтому PDF без встроенных
// шрифтов или с JPEG2000-картинками открываются и в авиарежиме.
// Каталог генерируется заново при каждом dev/build и в git не лежит.
import { cpSync, rmSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const from = fileURLToPath(new URL('../node_modules/pdfjs-dist/', import.meta.url))
const to = fileURLToPath(new URL('../public/pdfjs/', import.meta.url))

rmSync(to, { recursive: true, force: true })
mkdirSync(to, { recursive: true })
for (const dir of ['standard_fonts', 'cmaps', 'iccs']) {
  cpSync(from + dir, to + dir, { recursive: true })
}
// quickjs нужен только для JavaScript внутри PDF, а скрипты мы не исполняем.
cpSync(from + 'wasm', to + 'wasm', {
  recursive: true,
  filter: (src) => !src.includes('quickjs'),
})
