/**
 * Supabase `signInWithPassword` expects an email. Optional `VITE_AUTH_EMAIL_DOMAIN`
 * lets reviewers type a short login (e.g. `dr_smith`) that becomes `dr_smith@your.domain`.
 */
export function loginIdentifierToEmail(input: string): string {
  const trimmed = input.trim()
  const domain = import.meta.env.VITE_AUTH_EMAIL_DOMAIN as string | undefined
  if (domain && trimmed && !trimmed.includes('@')) {
    return `${trimmed}@${domain}`
  }
  return trimmed
}
