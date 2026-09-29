import './client.jsx'
import './interact.jsx'
import './existing.jsx'

const total = globalThis.__bad || 0
console.log(total === 0
  ? '\n== DAYPAY UI CHECK: ALL GREEN =='
  : `\n== DAYPAY UI CHECK: ${total} FAILURE(S) ==`)
process.exit(total === 0 ? 0 : 1)
