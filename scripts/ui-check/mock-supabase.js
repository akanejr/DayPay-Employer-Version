/* Stands in for the Supabase client, so the ui-check can drive the REAL
 * src/lib/kiosk.js and the REAL Kiosk.jsx rather than a paraphrase of either.
 *
 * The alternative — mocking lib/kiosk.js — would have been easier and much
 * weaker: it would have thrown away the error folding, the rpc names, the
 * argument names and every shape assumption, which is most of what the kiosk
 * client is. Here the module under test is untouched and only the socket is
 * fake.
 *
 * WHAT THE SERVER SAYS IS SCRIPTABLE. `globalThis.__kiosk.reply` holds the
 * answer the next rpc returns, so the walk can put the machine in front of a
 * refusal, an "already checked in", or a project that has not run migration
 * 019, without a database.
 *
 * Copyright © 2026 Akaninyene. All rights reserved.
 */

const state = {
  user: null,
  session: null,
  listeners: [],
  calls: [],
  reply: {},
  fault: null,
}

globalThis.__kiosk = state

const EMPTY = { data: null, error: null }

function replyFor(name) {
  if (state.fault) {
    const { code, message } = state.fault
    return { data: null, error: { code, message } }
  }
  if (Object.prototype.hasOwnProperty.call(state.reply, name)) {
    return { data: state.reply[name], error: null }
  }
  return EMPTY
}

export const supabase = {
  auth: {
    async getSession() {
      return { data: { session: state.session }, error: null }
    },
    async getUser() {
      return { data: { user: state.user }, error: null }
    },
    async signInWithPassword({ email }) {
      state.user = { id: 'kiosk-account', email }
      state.session = { user: state.user }
      state.listeners.forEach(fn => fn('SIGNED_IN', state.session))
      return { data: { user: state.user }, error: null }
    },
    async signOut() {
      state.user = null
      state.session = null
      state.listeners.forEach(fn => fn('SIGNED_OUT', null))
      return { error: null }
    },
    onAuthStateChange(fn) {
      state.listeners.push(fn)
      return { data: { subscription: { unsubscribe: () => {
        state.listeners = state.listeners.filter(f => f !== fn)
      } } } }
    },
  },

  async rpc(name, args) {
    state.calls.push([name, args])
    return replyFor(name)
  },
}

// ── helpers the walk uses ───────────────────────────────────────────────────

export function signInFixture(email = 'gate@site.example') {
  state.user = { id: 'kiosk-account', email }
  state.session = { user: state.user }
}

export function signedOutFixture() {
  state.user = null
  state.session = null
}

export function calls() { return state.calls }
export function lastCall() { return state.calls[state.calls.length - 1] }
export function resetCalls() { state.calls = [] }
export function clearFault() { state.fault = null }
export function setFault(code, message) { state.fault = { code, message } }
