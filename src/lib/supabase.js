/* DayPay — Know what your work is worth.
   Copyright © 2026 Akaninyene. All rights reserved.
   Unauthorized copying, modification, or distribution is prohibited. */

import { createClient } from '@supabase/supabase-js'

/* Config resolution.

   Two naming conventions get pasted interchangeably: Vite's VITE_* and
   Next.js's NEXT_PUBLIC_*. Only VITE_* is exposed to a Vite bundle, so a
   NEXT_PUBLIC_ value alone would leave the app silently unconfigured — no
   error, just no cloud. Accept both so the mistake can't happen quietly.

   Supabase also renamed the "anon" key to "publishable" (sb_publishable_…).
   Both work identically at runtime; both are listed below. */

const env = import.meta.env || {}

function pick(...names) {
  for (const name of names) {
    const v = env[name]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export const supabaseUrl = pick(
  'VITE_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
)

export const supabaseKey = pick(
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
)

export const isSupabaseConfigured = !!(supabaseUrl && supabaseKey)

/* Guard against a secret key reaching the browser. A service_role key skips
   RLS entirely; if one is ever mis-inlined, fail loudly instead of shipping
   it. The payload is base64url, so decode the middle JWT segment and check
   the role claim. Opaque sb_secret_ keys are caught by prefix. */
function assertNotSecretKey(key) {
  if (key.startsWith('sb_secret_')) {
    throw new Error('DayPay: a secret key was supplied to the browser client. Use the publishable key.')
  }
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
      )
      if (payload.role === 'service_role') {
        throw new Error('DayPay: a service_role key was supplied to the browser client. Use the publishable key.')
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('DayPay:')) throw e
      // Not a decodable JWT — the opaque key formats land here, which is fine.
    }
  }
}

if (isSupabaseConfigured) assertNotSecretKey(supabaseKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null

/* Exposed for the connection-check page and for error messages. Never
   returns the full key. */
export function describeConfig() {
  if (!isSupabaseConfigured) {
    return { configured: false, url: null, keyHint: null, keyKind: null }
  }
  const keyKind = supabaseKey.startsWith('sb_publishable_')
    ? 'publishable (new format)'
    : supabaseKey.startsWith('eyJ')
      ? 'anon JWT (legacy format)'
      : 'unrecognised format'
  return {
    configured: true,
    url: supabaseUrl,
    keyHint: `${supabaseKey.slice(0, 22)}…${supabaseKey.slice(-4)}`,
    keyKind,
    keyLength: supabaseKey.length,
  }
}
