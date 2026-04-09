import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

/** Call once before React mounts when the invite/confirm link uses ?code= (PKCE). */
export async function exchangeAuthCodeFromUrl(): Promise<void> {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('code')) return

  const { error } = await supabase.auth.exchangeCodeForSession(window.location.href)
  if (error) {
    console.error('[auth] exchangeCodeForSession:', error.message)
    return
  }

  url.searchParams.delete('code')
  const search = url.searchParams.toString()
  const path = url.pathname + (search ? `?${search}` : '') + url.hash
  window.history.replaceState({}, document.title, path)
}
