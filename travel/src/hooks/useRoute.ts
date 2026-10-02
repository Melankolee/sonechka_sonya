// Навигация на хэше: #/doc/<id>, #/trips, #/new, #/edit/<id>.
// Сервер про маршруты ничего не знает, перезагрузка и «назад» работают сами.
import { useEffect, useState } from 'react'

export type Route =
  | { screen: 'home' }
  | { screen: 'doc'; id: string }
  | { screen: 'trips' }
  | { screen: 'new' }
  | { screen: 'edit'; id: string }

function parse(hash: string): Route {
  const [, kind, id] = hash.replace(/^#/, '').split('/')
  if (kind === 'doc' && id) return { screen: 'doc', id: decodeURIComponent(id) }
  if (kind === 'trips') return { screen: 'trips' }
  if (kind === 'new') return { screen: 'new' }
  if (kind === 'edit' && id) return { screen: 'edit', id: decodeURIComponent(id) }
  return { screen: 'home' }
}

let pushedInApp = false

export function go(path: string): void {
  pushedInApp = true
  window.location.hash = path
}

/** Переход без записи в историю: «создать» → «редактировать» не должен оставлять форму создания под «назад». */
export function replace(path: string): void {
  window.location.replace(`#${path}`)
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
