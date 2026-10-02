// Регистрация Service Worker и обновление самого приложения.
//
// Новая сборка ставится в фоне и ждёт. Как только она готова, needRefresh
// становится true и на экране появляется «Вышла новая версия приложения». «Перезагрузить»
// отправляет ожидающему SW SKIP_WAITING и перезагружает страницу уже на новых
// файлах. Наличие новой сборки проверяется при каждом возврате в приложение и
// раз в час — иначе запущенная неделями PWA так и сидела бы на старом бандле.
import { useRegisterSW } from 'virtual:pwa-register/react'

const HOUR = 60 * 60 * 1000

export function useAppUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => {})
      }
      setInterval(check, HOUR)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  const reload = () => {
    void updateServiceWorker(true)
    // Если ожидающего SW уже нет (его активировала другая вкладка), событие
    // смены контроллера не придёт — перезагружаемся сами.
    setTimeout(() => window.location.reload(), 3000)
  }

  return { needRefresh, reload }
}
