import { LoginCard } from '../components/LoginCard'
import { OfflinePanel } from '../components/OfflinePanel'
import { Check, Row } from '../components/ui'
import { go } from '../hooks/useRoute'
import type { useTrip } from '../hooks/useTrip'
import { documentType, formatDateRange, formatSize } from '../services/format'
import type { Trip } from '../types/trip'

type State = ReturnType<typeof useTrip>

interface Props {
  state: State
  appUpdate: { needRefresh: boolean; reload: () => void }
}

// Safari и приложение с экрана «Домой» хранят данные раздельно: скачанное во
// вкладке Safari в установленном приложении не появится.
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function Home({ state, appUpdate }: Props) {
  const { trip, loaded, network, updateAvailable, isDownloading, needLogin } = state
  const online = network === 'online' && !needLogin

  return (
    <main className="home">
      <nav className="top-bar">
        <button className="link" onClick={() => go('/trips')} disabled={!online}>
          Поездки
        </button>
        {trip && (
          <button className="link" onClick={() => go(`/edit/${encodeURIComponent(trip.id)}`)} disabled={!online}>
            Изменить
          </button>
        )}
      </nav>

      {appUpdate.needRefresh && (
        <div className="banner">
          <span>Вышла новая версия приложения</span>
          <button onClick={appUpdate.reload}>Перезагрузить</button>
        </div>
      )}
      {updateAvailable && !isDownloading && (
        <div className="banner">
          <span>Доступно обновление поездки</span>
          <button onClick={() => void state.downloadForOffline()}>Обновить</button>
        </div>
      )}

      {needLogin && (
        <LoginCard
          onDone={() => {
            void state.refresh()
            if (state.isLocal) void state.downloadForOffline()
          }}
        />
      )}

      {isIos && !isStandalone && (
        <p className="hint">
          Чтобы пользоваться без интернета, добавь страницу на экран «Домой» (Поделиться → На экран «Домой») и скачивай поездку уже оттуда. У
          Safari и у приложения разные хранилища.
        </p>
      )}

      {trip ? (
        <TripView trip={trip} state={state} />
      ) : (
        <header className="trip-header">
          <h1>Поездки</h1>
          <p className="muted">
            {!loaded || network === 'checking'
              ? 'Загрузка…'
              : needLogin
                ? 'Войди, чтобы увидеть поездки.'
                : network === 'offline'
                ? 'Офлайн — на этом телефоне ещё нет сохранённой поездки.'
                : 'Поездок пока нет.'}
          </p>
          {online && state.remote === null && (
            <button className="button primary" onClick={() => go('/new')}>
              Создать поездку
            </button>
          )}
        </header>
      )}

      <OfflinePanel state={state} />
    </main>
  )
}

function TripView({ trip, state }: { trip: Trip; state: State }) {
  const { verification, network, docs } = state
  const place = [trip.location?.place, trip.location?.country].filter(Boolean).join(', ')
  const offlineReady = state.isLocal && verification?.ready
  const materials = trip.documents ?? []

  return (
    <>
      <header className="trip-header">
        <h1>{trip.title}</h1>
        <p className="dates">{formatDateRange(trip.dateFrom, trip.dateTo)}</p>
        {place && place !== trip.title && <p className="muted">{place}</p>}
        <p className="status-line">
          {offlineReady ? (
            <span className="pill ok">
              <Check /> Доступно офлайн
            </span>
          ) : state.isLocal && verification ? (
            <span className="pill warn">Офлайн-копия неполная</span>
          ) : state.loaded && !state.isLocal ? (
            <span className="pill">Не сохранено для офлайна</span>
          ) : null}
          {network === 'offline' && <span className="pill">Офлайн</span>}
        </p>
      </header>

      <section>
        <h3 className="group-title">Материалы</h3>
        {materials.length > 0 ? (
          <ul className="list">
            {materials.map((d) => {
              const stored = state.isLocal ? docs.get(d.id) : undefined
              const saved = !!stored && !verification?.missing.some((m) => m.id === d.id)
              const size = stored?.size ?? d.size
              return (
                <Row
                  key={d.id}
                  title={d.title}
                  detail={[documentType(d.mime), size ? formatSize(size) : null].filter(Boolean).join(' · ')}
                  trailing={
                    saved ? (
                      <span className="saved" aria-label="Сохранено для офлайна">
                        <Check />
                      </span>
                    ) : (
                      <span className="not-saved">Не скачан</span>
                    )
                  }
                  onClick={() => go(`/doc/${encodeURIComponent(d.id)}`)}
                />
              )
            })}
          </ul>
        ) : (
          <p className="muted empty">Материалов пока нет. Нажми «Изменить» и загрузи билеты, брони, страховку.</p>
        )}
      </section>
    </>
  )
}
