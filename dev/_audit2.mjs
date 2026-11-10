import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const kb = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json'), 'utf8'))
const dir = 'dev/digest/formal'
const applied = new Set()
for (const f of fs.readdirSync(dir).filter(n => /^out-\d+\.json$/.test(n))) for (const it of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) applied.add(it.key)
const checks = [
  ['oral', /这题|本题|我们|搞定|就好|就行|别忘了|看一下|搞一下/],
  ['unicode-op', /[≥≤×⇒⇔∑∏∫±∞≈≠]/],
  ['space-inline', /[\u4e00-\u9fff]\s+\$|\$\s+[\u4e00-\u9fff]/],
]
const hits = { applied: {}, rest: {} }
function scan(bucket, text) {
  for (const [name, re] of checks) if (re.test(String(text||''))) hits[bucket][name] = (hits[bucket][name]||0) + 1
}
for (const p of kb.problems) {
  if (p.pool === 'quiz') continue
  const bucket = applied.has(p.key) ? 'applied' : 'rest'
  scan(bucket, p.essence)
  for (const i of p.insights || []) scan(bucket, i.text)
}
for (const n of kb.nodes || []) { scan('rest', n.summary); for (const pat of n.patterns || []) scan('rest', typeof pat === 'string' ? pat : pat.text) }
for (const n of kb.obsNodes || []) for (const pat of n.patterns || []) scan('rest', typeof pat === 'string' ? pat : pat.text)
console.log(JSON.stringify({ problems: kb.problems.length, applied: applied.size, hits }, null, 2))
