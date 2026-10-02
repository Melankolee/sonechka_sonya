import { useEffect } from 'react'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useRoute } from './hooks/useRoute'
import { useTrip } from './hooks/useTrip'
import { DocumentPage } from './pages/DocumentPage'
import { EditTripPage, NewTripPage } from './pages/EditTripPage'
import { Home } from './pages/Home'
import { SectionPage } from './pages/SectionPage'
import { TripsPage } from './pages/TripsPage'

export function App() {
  const state = useTrip()
  const app = useAppUpdate()
  const route = useRoute()
  const { trip } = state

  // Пока открыт экран поверх главного, главный не прокручивается под ним.
  const overlay = route.screen !== 'home'
  useEffect(() => {
    document.documentElement.classList.toggle('has-overlay', overlay)
  }, [overlay])

  // Любая правка на сервере сразу обновляет копию на телефоне. Документы,
  // которые уже скачаны, повторно не качаются (см. services/sync.ts).
  const onChanged = () => void state.downloadForOffline()

  const doc = route.screen === 'doc' ? trip?.documents?.find((d) => d.id === route.id) : undefined

  return (
    <>
      <Home state={state} appUpdate={app} />
      {route.screen === 'section' && trip && <SectionPage trip={trip} section={route.id} />}
      {doc && trip && (
        <DocumentPage
          key={`${trip.id}@${trip.version}/${doc.id}`}
          trip={trip}
          doc={doc}
          stored={state.docs.get(doc.id)}
          network={state.network}
        />
      )}
      {route.screen === 'trips' && <TripsPage />}
      {route.screen === 'new' && <NewTripPage onChanged={onChanged} />}
      {route.screen === 'edit' && <EditTripPage key={route.id} id={route.id} onChanged={onChanged} />}
    </>
  )
}
