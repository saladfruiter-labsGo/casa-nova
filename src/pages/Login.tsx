import { FormEvent, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { api } from '../lib/api'
import { ErrorBox } from '../components/ui'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth/login', { method: 'POST', body: { password } })
      onLogin()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 sm:p-8">
        <img src="/icon.svg" alt="" className="mb-5 h-12 w-12" />
        <h1 className="text-2xl font-semibold tracking-tight">Casa Nova</h1>
        <p className="muted mb-6 mt-1 text-sm">Suas compras da mudança, organizadas e de olho nos preços.</p>
        <label htmlFor="pw" className="label">
          Senha
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <input id="pw" type="password" autoComplete="current-password" className="input pl-9" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </div>
        <div className="mt-4">
          <ErrorBox error={error} />
        </div>
        <button className="btn-primary mt-4 w-full" disabled={busy || !password}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Entrar
        </button>
      </form>
    </main>
  )
}
