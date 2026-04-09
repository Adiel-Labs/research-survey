import { type FormEvent, useState } from 'react'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { loginIdentifierToEmail } from '@/lib/auth-email'
import { supabase } from '@/lib/supabase'

/** Maps Supabase OTP errors to reviewer-friendly copy (unknown email + shouldCreateUser: false). */
function friendlyOtpError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('signups not allowed') || lower.includes('user not found')) {
    return 'No account exists for this email. Your administrator must invite you or create your user in Supabase first.'
  }
  return message
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setIsSubmitting(true)
    const address = loginIdentifierToEmail(email)
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          shouldCreateUser: false,
        },
      })
      if (otpError) {
        setError(friendlyOtpError(otpError.message))
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

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div
            role="note"
            className="flex items-center justify-center gap-3 overflow-x-auto rounded-lg border border-amber-500/40 bg-amber-500/[0.09] px-3 py-2.5 dark:border-amber-400/35 dark:bg-amber-400/[0.1]"
          >
            <Info
              className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400"
              aria-hidden
            />
            <p className="whitespace-nowrap text-sm font-medium leading-none text-foreground">
              Use only the email you were invited with.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="you@clinic.org"
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
      </div>
    </main>
  )
}
