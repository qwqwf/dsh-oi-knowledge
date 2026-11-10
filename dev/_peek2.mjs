import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const kb = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json'), 'utf8'))
const p = kb.problems.find(x => x.key === 'agc067_b')
console.log(JSON.stringify(p.essence))
console.log(JSON.stringify(p.insights[0].text).slice(0, 300))
const arr = kb.problems.find(x => x.key === 'abc226_h')
console.log(JSON.stringify(arr.essence).slice(0, 260))
