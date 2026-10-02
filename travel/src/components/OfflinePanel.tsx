// Блок офлайна внизу главного экрана: результат проверки, время последней
// синхронизации, прогресс загрузки и главная кнопка.
import type { useTrip } from '../hooks/useTrip'
import { formatSyncedAt, plural } from '../services/format'
import type { DownloadStep } from '../services/sync'
import { Check } from './ui'

type State = ReturnType<typeof useTrip>

export function OfflinePanel({ state }: { state: State }) {
  const { verification: v, sync, download, downloadError, isDownloading, isLocal, network, updateAvailable, trip } = state
  if (!trip) return null

  const label = isDownloading
    ? 'Скачиваю…'
    : !isLocal || (v && !v.ready && !updateAvailable)
      ? 'Скачать поездку для офлайна'
      : 'Обновить поездку'
  const primary = !isLocal || updateAvailable || (v && !v.ready)

  return (
    <section className="offline">
      <h3 className="group-title">Офлайн</h3>
      <div className="card">
        {isLocal && v ? <Summary v={v} /> : <p className="summary-title">На этом телефоне не сохранено</p>}

        {sync && <p className="muted small">Последняя синхронизация: {formatSyncedAt(sync.syncedAt)}</p>}

        {download && download.steps.length > 0 && <Progress steps={download.steps} />}
        {download?.finished && v?.ready && (
          <p className="ready">
            <Check /> Готово к работе без интернета
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
        {network === 'offline' && <p className="muted small center">Для загрузки нужен интернет.</p>}
      </div>
    </section>
  )
}

function Summary({ v }: { v: NonNullable<State['verification']> }) {
  return (
    <div className="summary">
      <p className={v.ready ? 'summary-title ok' : 'summary-title warn'}>
        {v.ready && <Check />}
        {v.ready ? 'Готово к офлайну' : 'Офлайн-копия неполная'}
      </p>
      <p>
        {v.total === 0
          ? 'Документов нет'
          : `Доступно ${v.available} из ${v.total} ${plural(v.total, 'документа', 'документов', 'документов')}`}
      </p>
      {v.missing.length > 0 && <p className="muted">Не хватает: {v.missing.map((d) => d.title).join(', ')}</p>}
      {!v.shellOk && (
        <p className="muted">
          {v.shell
            ? `Файлы приложения в кеше: ${v.shell.cached} из ${v.shell.total}. Открой приложение ещё раз с интернетом.`
            : 'Приложение ещё не закешировано. Открой его ещё раз с интернетом.'}
        </p>
      )}
    </div>
  )
}

function Progress({ steps }: { steps: DownloadStep[] }) {
  const done = steps.filter((s) => s.status === 'done').length
  return (
    <div className="progress" aria-live="polite">
      <p className="summary-title">Скачиваю поездку</p>
      <ul>
        {steps.map((s) => (
          <li key={s.id} className={`step ${s.status}`}>
            <span className="step-mark">{s.status === 'done' ? <Check /> : s.status === 'failed' ? '✕' : s.status === 'active' ? <span className="spinner" /> : '·'}</span>
            {s.label}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {done} из {steps.length} {plural(steps.length, 'файла', 'файлов', 'файлов')}
      </p>
    </div>
  )
}
