import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const kb = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json'), 'utf8'))
const p = kb.problems.find(x => x.key === 'agc040_e')
for (const i of p.insights) if (i.id === 'i1zz' || i.id === 'i200') console.log(i.id, '::', i.text)
let count = 0, samples = []
const re = /[\u4e00-\u9fff]\s+\$|\$\s+[\u4e00-\u9fff]/
for (const n of kb.obsNodes || []) for (const pat of n.patterns || []) {
  const t = typeof pat === 'string' ? pat : pat.text
  if (re.test(t)) { count++; if (samples.length < 3) samples.push((n.name||'') + ' :: ' + t.slice(0,80)) }
}
for (const n of kb.nodes || []) for (const pat of n.patterns || []) {
  const t = typeof pat === 'string' ? pat : pat.text
  if (re.test(t)) { count++; if (samples.length < 5) samples.push((n.name||'') + ' :: ' + t.slice(0,80)) }
}
console.log('pattern spaces:', count, JSON.stringify(samples, null, 1))
