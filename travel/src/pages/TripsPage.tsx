// Список поездок на сервере: какая активна, переход к редактированию, новая.
import { useEffect, useState } from 'react'
import { Row, Screen } from '../components/ui'
import { go } from '../hooks/useRoute'
import { errorText, listTrips } from '../services/api'
import { formatDateRange } from '../services/format'
import type { TripSummary } from '../types/trip'

export function TripsPage() {
  const [data, setData] = useState<{ active: string | null; trips: TripSummary[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listTrips().then(setData, (e) => setError(errorText(e)))
  }, [])

  return (
    <Screen
      title="Поездки"
      action={
        <button className="link" onClick={() => go('/new')}>
          Новая
        </button>
      }
    >
      {error && <p className="placeholder muted">{error} Список поездок доступен только с интернетом.</p>}
      {!data && !error && <p className="placeholder muted">Загрузка…</p>}
      {data && data.trips.length === 0 && (
        <div className="placeholder">
          <p className="muted">Поездок пока нет.</p>
          <button className="button primary" onClick={() => go('/new')}>
            Создать поездку
          </button>
        </div>
      )}
      {data && data.trips.length > 0 && (
        <ul className="list">
          {data.trips.map((t) => (
            <Row
              key={t.id}
              title={t.title}
              detail={[formatDateRange(t.dateFrom, t.dateTo), t.location?.country].filter(Boolean).join(' · ')}
              trailing={t.id === data.active ? <span className="pill ok">активная</span> : undefined}
              onClick={() => go(`/edit/${encodeURIComponent(t.id)}`)}
            />
          ))}
        </ul>
      )}
    </Screen>
  )
}
