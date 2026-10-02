import { useEffect } from 'react'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useRoute } from './hooks/useRoute'
import { useTrip } from './hooks/useTrip'
import { DocumentPage } from './pages/DocumentPage'
import { Home } from './pages/Home'
import { SectionPage } from './pages/SectionPage'

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
    </>
  )
}
