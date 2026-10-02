import { OfflinePanel } from '../components/OfflinePanel'
import { Check, Row } from '../components/ui'
import { useChecklist } from '../hooks/useChecklist'
import { go, type SectionId } from '../hooks/useRoute'
import type { useTrip } from '../hooks/useTrip'
import { documentType, formatDateRange, formatSize } from '../services/format'
import type { Trip } from '../types/trip'

type State = ReturnType<typeof useTrip>

interface Props {
  state: State
  appUpdate: { needRefresh: boolean; reload: () => void }
}

// Safari и приложение с Home Screen хранят данные раздельно: скачанное во
// вкладке Safari в установленной PWA не появится.
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function Home({ state, appUpdate }: Props) {
  const { trip, loaded, network, updateAvailable, isDownloading } = state

  return (
    <main className="home">
      {appUpdate.needRefresh && (
        <div className="banner">
          <span>App update available</span>
          <button onClick={appUpdate.reload}>Reload</button>
        </div>
      )}
      {updateAvailable && !isDownloading && (
        <div className="banner">
          <span>Trip update available</span>
          <button onClick={() => void state.downloadForOffline()}>Update</button>
        </div>
      )}

      {isIos && !isStandalone && (
        <p className="hint">
          To use offline, add this page to the Home Screen (Share → Add to Home Screen) and download the trip from there. Safari and the
          installed app keep separate storage.
        </p>
      )}

      {trip ? (
        <TripView trip={trip} state={state} />
      ) : (
        <header className="trip-header">
          <h1>Travel</h1>
          <p className="muted">{!loaded || network === 'checking' ? 'Loading…' : network === 'offline' ? 'Offline — no trip saved on this device yet.' : 'No active trip.'}</p>
        </header>
      )}

      <OfflinePanel state={state} />
    </main>
  )
}

function TripView({ trip, state }: { trip: Trip; state: State }) {
  const { checked } = useChecklist(trip.id)
  const { verification, network, docs } = state
  const place = [trip.location.place, trip.location.country].filter(Boolean).join(', ')
  const offlineReady = state.isLocal && verification?.ready

  const sections: { id: SectionId; title: string; detail?: string; show: boolean }[] = [
    {
      id: 'flights',
      title: 'Flights',
      detail: trip.flights?.map((f) => `${f.from.code} → ${f.to.code}`).join(', '),
      show: !!trip.flights?.length,
    },
    { id: 'stays', title: trip.stays && trip.stays.length > 1 ? 'Hotels' : 'Hotel', detail: trip.stays?.map((s) => s.name).join(', '), show: !!trip.stays?.length },
    {
      id: 'transfers',
      title: trip.transfers && trip.transfers.length > 1 ? 'Transfers' : 'Transfer',
      detail: [...new Set(trip.transfers?.map((t) => t.mode).filter(Boolean))].join(', '),
      show: !!trip.transfers?.length,
    },
    { id: 'notes', title: 'Notes', detail: `${trip.notes?.length ?? 0} notes`, show: !!trip.notes?.length },
    {
      id: 'checklist',
      title: 'Checklist',
      detail: `${trip.checklist?.filter((c) => checked.has(c.id)).length ?? 0} / ${trip.checklist?.length ?? 0}`,
      show: !!trip.checklist?.length,
    },
  ]

  return (
    <>
      <header className="trip-header">
        <h1>{trip.title}</h1>
        <p className="dates">{formatDateRange(trip.dateFrom, trip.dateTo)}</p>
        {place && place !== trip.title && <p className="muted">{place}</p>}
        <p className="status-line">
          {offlineReady ? (
            <span className="pill ok">
              <Check /> Available offline
            </span>
          ) : state.isLocal && verification ? (
            <span className="pill warn">Offline incomplete</span>
          ) : state.loaded && !state.isLocal ? (
            <span className="pill">Not saved for offline</span>
          ) : null}
          {network === 'offline' && <span className="pill">Offline</span>}
        </p>
      </header>

      <section>
        <h3 className="group-title">Trip</h3>
        <ul className="list">
          {sections
            .filter((s) => s.show)
            .map((s) => (
              <Row key={s.id} title={s.title} detail={s.detail} onClick={() => go(`/section/${s.id}`)} />
            ))}
        </ul>
      </section>

      {!!trip.documents?.length && (
        <section>
          <h3 className="group-title">Documents</h3>
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
                      <span className="saved" aria-label="Saved for offline">
                        <Check />
                      </span>
                    ) : (
                      <span className="not-saved">Not saved</span>
                    )
                  }
                  onClick={() => go(`/doc/${encodeURIComponent(d.id)}`)}
                />
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}
