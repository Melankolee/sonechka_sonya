import { OfflinePanel } from '../components/OfflinePanel'
import { Check, Row } from '../components/ui'
import { useChecklist } from '../hooks/useChecklist'
import { go, type SectionId } from '../hooks/useRoute'
import type { useTrip } from '../hooks/useTrip'
import { documentType, formatDateRange, formatSize, plural } from '../services/format'
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
  const { trip, loaded, network, updateAvailable, isDownloading } = state
  const online = network === 'online'

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
  const { checked } = useChecklist(trip.id)
  const { verification, network, docs } = state
  const place = [trip.location?.place, trip.location?.country].filter(Boolean).join(', ')
  const offlineReady = state.isLocal && verification?.ready
  const notes = trip.notes?.length ?? 0

  const sections: { id: SectionId; title: string; detail?: string; show: boolean }[] = [
    {
      id: 'flights',
      title: 'Перелёты',
      detail: trip.flights?.map((f) => `${f.from?.code || '…'} → ${f.to?.code || '…'}`).join(', '),
      show: !!trip.flights?.length,
    },
    { id: 'stays', title: 'Проживание', detail: trip.stays?.map((s) => s.name).filter(Boolean).join(', '), show: !!trip.stays?.length },
    {
      id: 'transfers',
      title: 'Трансфер',
      detail: [...new Set(trip.transfers?.map((t) => t.mode).filter(Boolean))].join(', '),
      show: !!trip.transfers?.length,
    },
    { id: 'notes', title: 'Заметки', detail: `${notes} ${plural(notes, 'заметка', 'заметки', 'заметок')}`, show: notes > 0 },
    {
      id: 'checklist',
      title: 'Чеклист',
      detail: `${trip.checklist?.filter((c) => checked.has(c.id)).length ?? 0} из ${trip.checklist?.length ?? 0}`,
      show: !!trip.checklist?.length,
    },
  ]
  const visible = sections.filter((s) => s.show)

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

      {visible.length > 0 && (
        <section>
          <h3 className="group-title">Поездка</h3>
          <ul className="list">
            {visible.map((s) => (
              <Row key={s.id} title={s.title} detail={s.detail} onClick={() => go(`/section/${s.id}`)} />
            ))}
          </ul>
        </section>
      )}

      {!!trip.documents?.length && (
        <section>
          <h3 className="group-title">Документы</h3>
          <ul className="list">
            {trip.documents.map((d) => {
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
        </section>
      )}

      {visible.length === 0 && !trip.documents?.length && (
        <section>
          <p className="muted empty">Здесь пока пусто. Нажми «Изменить» — добавь перелёты, отель, заметки и загрузи документы.</p>
        </section>
      )}
    </>
  )
}
