import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const kb = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json'), 'utf8'))
const files = fs.readdirSync('dev/digest/formal').filter(n => /^out-\d+\.json$/.test(n)).sort()
const applied = new Set()
for (const f of files) for (const it of JSON.parse(fs.readFileSync('dev/digest/formal/' + f, 'utf8'))) applied.add(it.key)
const total = kb.problems.filter(p => p.pool !== 'quiz').length
console.log('out files:', files.join(', '))
console.log('formalized:', applied.size, '/', total)
