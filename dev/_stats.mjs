import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const kb = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json'), 'utf8'))
const real = kb.problems.filter(p => p.pool !== 'quiz')
console.log(JSON.stringify({ problems: real.length, withEssence: real.filter(p=>p.essence).length, insights: real.reduce((s,p)=>s+(p.insights||[]).length,0), nodes: kb.nodes.length, obsNodes: kb.obsNodes.length }, null, 2))
