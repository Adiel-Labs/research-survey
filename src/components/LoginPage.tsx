import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { loginIdentifierToEmail } from '@/lib/auth-email'
import { supabase } from '@/lib/supabase'

export function LoginPage() {
  const [mode, setMode] = useState<'password' | 'magiclink'>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setIsSubmitting(true)
    const email = loginIdentifierToEmail(username)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) {
        setError(signInError.message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleMagicLinkSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setIsSubmitting(true)
    const email = loginIdentifierToEmail(username)
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          shouldCreateUser: false,
        },
      })
      if (otpError) {
        setError(otpError.message)
      } else {
        setInfo('Check your email for the sign-in link. Open it on this device to continue.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Reviewer sign in</h1>
          <p className="text-sm text-muted-foreground">
            Dental Caries Annotation Validation Platform
          </p>
        </div>

        <div className="flex gap-2 rounded-lg border bg-muted/40 p-1">
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'password'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => {
              setMode('password')
              setError(null)
              setInfo(null)
            }}
          >
            Password
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'magiclink'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => {
              setMode('magiclink')
              setError(null)
              setInfo(null)
            }}
          >
            Email link
          </button>
        </div>

        {mode === 'password' ? (
          <form className="space-y-4" onSubmit={handlePasswordSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="login-username">
                Email or username
              </label>
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
                disabled={isSubmitting}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={handleMagicLinkSubmit}>
            <p className="text-sm text-muted-foreground">
              We’ll email you a link to sign in. Use the same address as your invite or account.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="login-email-link">
                Email or username
              </label>
              <input
                id="login-email-link"
                name="email"
                type="text"
                autoComplete="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
                disabled={isSubmitting}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {info ? <p className="text-sm text-muted-foreground">{info}</p> : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Sending…' : 'Send sign-in link'}
            </Button>
          </form>
        )}
      </div>
    </main>
  )
}
