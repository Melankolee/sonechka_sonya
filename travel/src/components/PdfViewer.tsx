// Локальный просмотр PDF на pdf.js. Файл приходит готовым (из IndexedDB),
// сеть не нужна: воркер, шрифты, CMaps и wasm лежат в precache (public/pdfjs/).
//
// Страницы рисуются на canvas только рядом с экраном и очищаются, уходя
// далеко: у Safari на iPhone жёсткий лимит памяти под canvas, и длинный
// путеводитель целиком в полном разрешении туда не помещается.
import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerSrc

const ASSETS = '/pdfjs/'
const ZOOMS = [1, 1.5, 2, 3]
/** Предел пикселей одного canvas: ~16 Мп у iOS, берём с запасом. */
const MAX_CANVAS_PIXELS = 8_000_000

interface PageSize {
  width: number
  height: number
}

export default function PdfViewer({ file }: { file: File }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(0)
  const [width, setWidth] = useState(0)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    void (async () => {
      try {
        // pdf.js забирает буфер себе в воркер, поэтому — свежая копия из File.
        const data = new Uint8Array(await file.arrayBuffer())
        task = getDocument({
          data,
          cMapUrl: `${ASSETS}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${ASSETS}standard_fonts/`,
          wasmUrl: `${ASSETS}wasm/`,
          iccUrl: `${ASSETS}iccs/`,
          enableXfa: false,
        })
        const loaded = await task.promise
        const pages: PageSize[] = []
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 })
          pages.push({ width: vp.width, height: vp.height })
        }
        if (cancelled) return
        setPdf(loaded)
        setSizes(pages)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [file])

  useEffect(() => {
    const el = container.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const pageWidth = Math.max(0, width - 16) * ZOOMS[zoom]

  return (
    <div className="pdf" ref={container}>
      {failed && <p className="placeholder muted">Не удалось показать PDF. Нажми «Сохранить в „Файлы“», чтобы открыть его в другом приложении.</p>}
      {!pdf && !failed && <p className="placeholder muted">Открываю…</p>}
      {pdf && pageWidth > 0 && (
        <div className="pdf-pages" style={{ width: pageWidth + 16 }}>
          {sizes.map((size, i) => (
            <PdfPage key={i} pdf={pdf} pageNumber={i + 1} cssWidth={pageWidth} cssHeight={Math.round((pageWidth * size.height) / size.width)} />
          ))}
        </div>
      )}
      {pdf && (
        <div className="zoom">
          <button aria-label="Уменьшить" disabled={zoom === 0} onClick={() => setZoom((z) => z - 1)}>
            −
          </button>
          <span>{Math.round(ZOOMS[zoom] * 100)}%</span>
          <button aria-label="Увеличить" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => z + 1)}>
            +
          </button>
        </div>
      )}
    </div>
  )
}

function PdfPage({ pdf, pageNumber, cssWidth, cssHeight }: { pdf: PDFDocumentProxy; pageNumber: number; cssWidth: number; cssHeight: number }) {
  const wrapper = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = wrapper.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '150% 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    if (!near) {
      el.width = 0
      el.height = 0
      return
    }
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null
    let cancelled = false
    void (async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      let ratio = Math.min(window.devicePixelRatio || 1, 2)
      if (cssWidth * cssHeight * ratio * ratio > MAX_CANVAS_PIXELS) ratio = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight))
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio })
      el.width = Math.floor(viewport.width)
      el.height = Math.floor(viewport.height)
      task = page.render({ canvas: el, viewport })
      await task.promise.catch(() => {})
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [near, pdf, pageNumber, cssWidth, cssHeight])

  return (
    <div className="pdf-page" ref={wrapper} style={{ width: cssWidth, height: cssHeight }}>
      <canvas ref={canvas} style={{ width: cssWidth, height: cssHeight }} aria-label={`Страница ${pageNumber}`} />
    </div>
  )
}
