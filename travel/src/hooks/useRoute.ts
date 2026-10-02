// Навигация на хэше: #/section/flights, #/doc/insurance. Сервер про маршруты
// ничего не знает, перезагрузка и кнопка «назад» работают сами.
import { useEffect, useState } from 'react'

export type SectionId = 'flights' | 'stays' | 'transfers' | 'notes' | 'checklist'

export type Route = { screen: 'home' } | { screen: 'section'; id: SectionId } | { screen: 'doc'; id: string }

function parse(hash: string): Route {
  const [, kind, id] = hash.replace(/^#/, '').split('/')
  if (kind === 'section' && id) return { screen: 'section', id: id as SectionId }
  if (kind === 'doc' && id) return { screen: 'doc', id: decodeURIComponent(id) }
  return { screen: 'home' }
}

let pushedInApp = false

export function go(path: string): void {
  pushedInApp = true
  window.location.hash = path
}

/** Назад по истории, если пришли изнутри; иначе (открыли по ссылке) — на главный. */
export function back(): void {
  if (pushedInApp) window.history.back()
  else window.location.replace('#/')
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
