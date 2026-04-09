/**
 * Normalizes sign-in email (trim). Optional `VITE_AUTH_EMAIL_DOMAIN` maps a local part
 * without `@` to `local@domain` (only if you use a plain text field; the login UI uses `type="email"`).
 */
export function loginIdentifierToEmail(input: string): string {
  const trimmed = input.trim()
  const domain = import.meta.env.VITE_AUTH_EMAIL_DOMAIN as string | undefined
  if (domain && trimmed && !trimmed.includes('@')) {
    return `${trimmed}@${domain}`
  }
  return trimmed
}
