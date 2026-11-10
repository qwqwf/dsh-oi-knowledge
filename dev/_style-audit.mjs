import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const kb = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json'), 'utf8'))
const checks = [
  ['oral', /这题|本题|我们|搞定|就好|就行|别忘了|看一下|搞一下/],
  ['unicode-op', /[≥≤×⇒⇔∑∏∫±∞≈≠]/],
  ['array', /(?<![A-Za-z\\])[A-Za-z]{1,4}\[/],
  ['space-inline', /[\u4e00-\u9fff]\s+\$|\$\s+[\u4e00-\u9fff]/],
  ['brace', null],
]
const hits = Object.fromEntries(checks.map(([n]) => [n, 0]))
const samples = Object.fromEntries(checks.map(([n]) => [n, []]))
function scan(where, text) {
  const t = String(text || '')
  for (const [name, re] of checks) {
    if (name === 'brace') {
      let depth = 0, bad = false
      for (const ch of t) { if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth < 0) { bad = true; break } } }
      if (bad || depth !== 0) { hits.brace++; if (samples.brace.length < 3) samples.brace.push(where) }
      continue
    }
    if (re.test(t)) { hits[name]++; if (samples[name].length < 3) samples[name].push(where) }
  }
}
for (const p of kb.problems) {
  if (p.pool === 'quiz') continue
  scan(p.key + ':essence', p.essence)
  for (const i of p.insights || []) scan(p.key + ':' + i.id, i.text)
}
for (const n of kb.nodes || []) {
  scan('node:' + n.name + ':summary', n.summary)
  for (const pat of n.patterns || []) scan('node:' + n.name + ':pattern', typeof pat === 'string' ? pat : pat.text)
}
for (const n of kb.obsNodes || []) for (const pat of n.patterns || []) scan('obs:' + n.name + ':pattern', typeof pat === 'string' ? pat : pat.text)
console.log(JSON.stringify({ hits, samples }, null, 2))
