import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const kbPath = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'))
let n = 0
for (const p of kb.problems) {
  if (p.key !== 'agc040_e') continue
  for (const i of p.insights) {
    if (i.id === 'i1zz') { i.text = i.text.replace('$=#\\{i:A_i>A_{i+1}\\}$', '$=\\left|\\{i:A_i>A_{i+1}\\}\\right|$'); n++ }
    if (i.id === 'i200') { i.text = i.text.replace('$#\\{i:A_i<A_{i+1}\\}$', '$\\left|\\{i:A_i<A_{i+1}\\}\\right|$'); n++ }
  }
}
const tmp = kbPath + '.tmp'
fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
fs.renameSync(tmp, kbPath)
console.log('patched', n)
