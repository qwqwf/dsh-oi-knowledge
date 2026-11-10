// 把数学段里的数组写法 dp[i]、dp[i][j]、dp[next(i,c)] 改成下标写法 dp_{i}、dp_{i,j}、dp_{next(i,c)}。
// 用法：node dev/subscript-math.mjs [--write]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const WRITE = process.argv.includes('--write')

const ARRAY_RE = /(?<![\\A-Za-z])([A-Za-z][A-Za-z0-9]*)((?:\s*\[[^\[\]]*\])+)/g
const INDEX_RE = /\[([^\[\]]*)\]/g

export function toSubscript(math) {
  return math.replace(ARRAY_RE, (whole, base, groups) => {
    const indices = []
    let m
    INDEX_RE.lastIndex = 0
    while ((m = INDEX_RE.exec(groups))) indices.push(m[1].trim())
    if (!indices.length) return whole
    // 已经有下标的（如 a_i[j]）不动，避免语义错乱
    if (base.endsWith('_')) return whole
    return `${base}_{${indices.join(',')}}`
  })
}

function fixText(text) {
  if (typeof text !== 'string' || !text) return { text, changed: 0 }
  let changed = 0
  const parts = text.split(/(\$[^$]*\$)/g)
  const next = parts.map((part) => {
    if (!(part.startsWith('$') && part.endsWith('$') && part.length > 2)) return part
    const inner = part.slice(1, -1)
    const converted = toSubscript(inner)
    if (converted !== inner) changed += 1
    return `$${converted}$`
  })
  return { text: next.join(''), changed }
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let total = 0
let touched = 0
const samples = []
for (const problem of kb.problems || []) {
  let changed = 0
  for (const field of ['essence', 'statement', 'solution']) {
    const r = fixText(problem[field])
    if (r.changed) { problem[field] = r.text; changed += r.changed }
  }
  for (const insight of problem.insights || []) {
    const r = fixText(insight.text)
    if (r.changed) { insight.text = r.text; changed += r.changed }
  }
  if (changed) {
    touched += 1
    total += changed
    if (samples.length < 5) samples.push({ key: problem.key, text: problem.essence })
  }
}
for (const node of [...(kb.nodes || []), ...(kb.obsNodes || [])]) {
  const r = fixText(node.summary)
  if (r.changed) { node.summary = r.text; total += r.changed }
  for (const pattern of node.patterns || []) {
    if (pattern && typeof pattern === 'object') {
      const p = fixText(pattern.text)
      if (p.changed) { pattern.text = p.text; total += p.changed }
    }
  }
}

console.log(`题目 ${touched} 道，转换 ${total} 处`)
for (const s of samples) console.log(s.key, '|', s.text.slice(0, 160))
if (WRITE) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回')
}
