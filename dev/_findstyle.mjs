import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const kb = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json'), 'utf8'))
const re = /[≥≤×⇒⇔∑∏∫±∞≈≠]/
const oral = /这题|本题|我们|搞定|就好|就行|别忘了|看一下|搞一下/
function show(label, text) { if (re.test(String(text||'')) || oral.test(String(text||''))) console.log(label, '::', String(text).slice(0, 200).replace(/\n/g,' ')) }
for (const n of kb.nodes || []) { show('node:' + n.path, n.summary); (n.patterns||[]).forEach((p,i)=>show('node-pattern:' + n.path + '#' + i, typeof p === 'string' ? p : p.text)) }
for (const n of kb.obsNodes || []) { (n.patterns||[]).forEach((p,i)=>show('obs-pattern:' + n.path + '#' + i, typeof p === 'string' ? p : p.text)) }
