/// <reference lib="webworker" />
// Service Worker приложения.
//
// Кеширует только оболочку: HTML, JS, CSS, иконки, manifest и ассеты pdf.js.
// Данные поездки и документы сюда не попадают — их хранит IndexedDB
// (src/storage/db.ts), а запросы к /trips/ идут мимо SW прямо в сеть.
//
// Обновления: precache версионирован (workbox сам кладёт ревизии), новый SW
// ставится рядом и ждёт. Страница показывает «App update available», по
// нажатию шлёт SKIP_WAITING и перезагружается. cleanupOutdatedCaches удаляет
// precache прежних версий, так что старые бандлы не копятся и не залипают.
import { clientsClaim, cacheNames } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, getCacheKeyForURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

const manifest = self.__WB_MANIFEST

precacheAndRoute(manifest)
cleanupOutdatedCaches()

// Любая навигация (в том числе запуск с Home Screen без сети) получает
// index.html из precache.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/trips\//] }))

// Первая установка сразу берёт страницу под контроль, без лишней перезагрузки.
// Обновления этим не затрагиваются: они ждут SKIP_WAITING.
clientsClaim()

type ShellStatus = { total: number; cached: number; missing: string[] }

async function checkShell(): Promise<ShellStatus> {
  const cache = await caches.open(cacheNames.precache)
  const missing: string[] = []
  for (const entry of manifest) {
    const url = typeof entry === 'string' ? entry : entry.url
    const key = getCacheKeyForURL(url) ?? url
    if (!(await cache.match(key))) missing.push(url)
  }
  return { total: manifest.length, cached: manifest.length - missing.length, missing }
}

self.addEventListener('message', (event) => {
  const type = (event.data as { type?: string } | null)?.type
  if (type === 'SKIP_WAITING') {
    void self.skipWaiting()
  } else if (type === 'CHECK_SHELL') {
    const port = event.ports[0]
    event.waitUntil(checkShell().then((status) => port?.postMessage(status)))
  }
})
