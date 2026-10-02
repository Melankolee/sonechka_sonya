// Мелкие общие куски интерфейса: шапка экрана, строка списка, значки.
import type { ReactNode } from 'react'
import { back } from '../hooks/useRoute'

export function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 8 14" aria-hidden="true">
      <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Check() {
  return (
    <svg className="check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface ScreenProps {
  title: string
  action?: ReactNode
  children: ReactNode
  flush?: boolean
  /** Свой обработчик «назад» — например, чтобы спросить про несохранённое. */
  onBack?: () => void
  footer?: ReactNode
  /** Название можно нажать — например, чтобы переименовать документ. */
  onTitleClick?: () => void
}

export function Screen({ title, action, children, flush, onBack, footer, onTitleClick }: ScreenProps) {
  return (
    <div className="screen" role="dialog" aria-label={title}>
      <header className="screen-header">
        <button className="back" onClick={onBack ?? back}>
          <svg viewBox="0 0 10 16" aria-hidden="true">
            <path d="M8.5 1.5L2 8l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Назад
        </button>
        <h2>
          {onTitleClick ? (
            <button className="title-button" onClick={onTitleClick} aria-label={`${title} — переименовать`}>
              {title} <span aria-hidden="true">✎</span>
            </button>
          ) : (
            title
          )}
        </h2>
        <div className="screen-action">{action}</div>
      </header>
      <div className={flush ? 'screen-body flush' : 'screen-body'}>{children}</div>
      {footer && <div className="screen-footer">{footer}</div>}
    </div>
  )
}

export function Row({ title, detail, trailing, onClick }: { title: ReactNode; detail?: ReactNode; trailing?: ReactNode; onClick: () => void }) {
  return (
    <li>
      <button className="row" onClick={onClick}>
        <span className="row-main">
          <span className="row-title">{title}</span>
          {detail && <span className="row-detail">{detail}</span>}
        </span>
        {trailing && <span className="row-trailing">{trailing}</span>}
        <Chevron />
      </button>
    </li>
  )
}
