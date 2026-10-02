// Блок офлайна внизу главного экрана: результат проверки, время последней
// синхронизации, прогресс загрузки и главная кнопка.
import type { useTrip } from '../hooks/useTrip'
import { formatSyncedAt } from '../services/format'
import type { DownloadStep } from '../services/sync'
import { Check } from './ui'

type State = ReturnType<typeof useTrip>

export function OfflinePanel({ state }: { state: State }) {
  const { verification: v, sync, download, downloadError, isDownloading, isLocal, network, updateAvailable, trip } = state
  if (!trip && network !== 'online') return null

  const label = isDownloading
    ? 'Downloading…'
    : !isLocal || (v && !v.ready && !updateAvailable)
      ? 'Download trip for offline'
      : 'Update trip'
  const primary = !isLocal || updateAvailable || (v && !v.ready)

  return (
    <section className="offline">
      <h3 className="group-title">Offline</h3>
      <div className="card">
        {isLocal && v ? <Summary v={v} /> : <p className="summary-title">Not saved on this device</p>}

        {sync && <p className="muted small">Last synced: {formatSyncedAt(sync.syncedAt)}</p>}

        {download && download.steps.length > 0 && <Progress steps={download.steps} />}
        {download?.finished && v?.ready && (
          <p className="ready">
            <Check /> Ready for offline use
          </p>
        )}
        {downloadError && <p className="error">{downloadError}</p>}

        <button
          className={primary ? 'button primary' : 'button'}
          disabled={isDownloading || network === 'offline'}
          onClick={() => void state.downloadForOffline()}
        >
          {label}
        </button>
        {network === 'offline' && <p className="muted small center">Connect to the internet to download.</p>}
      </div>
    </section>
  )
}

function Summary({ v }: { v: NonNullable<State['verification']> }) {
  return (
    <div className="summary">
      <p className={v.ready ? 'summary-title ok' : 'summary-title warn'}>
        {v.ready && <Check />}
        {v.ready ? 'Offline ready' : 'Offline incomplete'}
      </p>
      <p>
        {v.available} / {v.total} documents available
      </p>
      {v.missing.length > 0 && <p className="muted">Missing: {v.missing.map((d) => d.title).join(', ')}</p>}
      {!v.shellOk && (
        <p className="muted">
          {v.shell
            ? `App files cached: ${v.shell.cached} / ${v.shell.total}. Open the app once more while online.`
            : 'App is not cached for offline yet. Reopen it while online.'}
        </p>
      )}
    </div>
  )
}

function Progress({ steps }: { steps: DownloadStep[] }) {
  const done = steps.filter((s) => s.status === 'done').length
  return (
    <div className="progress" aria-live="polite">
      <p className="summary-title">Downloading trip</p>
      <ul>
        {steps.map((s) => (
          <li key={s.id} className={`step ${s.status}`}>
            <span className="step-mark">{s.status === 'done' ? <Check /> : s.status === 'failed' ? '✕' : s.status === 'active' ? <span className="spinner" /> : '·'}</span>
            {s.label}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {done} / {steps.length} files
      </p>
    </div>
  )
}
