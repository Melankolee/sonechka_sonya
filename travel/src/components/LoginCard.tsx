// Вход. Показывается, когда сервер ответил 401: первый запуск или пароль
// сменили. После входа cookie живёт 400 дней — в том числе в приложении с
// экрана «Домой», которое basic auth не запоминало.
import { useState, type FormEvent } from 'react'
import { errorText, login } from '../services/api'

export function LoginCard({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(password)
      setPassword('')
      onDone()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form login" onSubmit={(e) => void submit(e)}>
      <p className="summary-title">Вход</p>
      {/* Логин для связки ключей iOS: без поля имени она не предлагает сохранить пароль. */}
      <input type="text" name="username" autoComplete="username" value="travel" readOnly hidden />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="Пароль"
        aria-label="Пароль"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button className="button primary" type="submit" disabled={busy || !password}>
        {busy ? 'Вхожу…' : 'Войти'}
      </button>
    </form>
  )
}
