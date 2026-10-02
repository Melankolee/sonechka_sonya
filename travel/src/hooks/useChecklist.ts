// Отметки чеклиста живут только на телефоне (IndexedDB) и переживают
// обновление поездки: ключ — id пункта, а не его порядковый номер.
import { useCallback, useEffect, useState } from 'react'
import { getChecked, setChecked } from '../storage/db'

export function useChecklist(tripId: string | undefined) {
  const [checked, setState] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!tripId) return
    let cancelled = false
    getChecked(tripId)
      .then((ids) => !cancelled && setState(new Set(ids)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tripId])

  const toggle = useCallback(
    (id: string) => {
      if (!tripId) return
      setState((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        void setChecked(tripId, [...next]).catch(() => {})
        return next
      })
    },
    [tripId],
  )

  return { checked, toggle }
}
