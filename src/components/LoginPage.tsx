import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { loginIdentifierToEmail } from '@/lib/auth-email'
import { supabase } from '@/lib/supabase'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Reviewer sign in</h1>
          <p className="text-sm text-muted-foreground">
            Dental Caries Annotation Validation Platform
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="login-username">
              Username
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
            <p className="text-xs text-muted-foreground">
              Same identifier you configured under Supabase → Authentication → Users (full email, or
              short name if <code className="rounded bg-muted px-1">VITE_AUTH_EMAIL_DOMAIN</code> is
              set).
            </p>
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
      </div>
    </main>
  )
}
