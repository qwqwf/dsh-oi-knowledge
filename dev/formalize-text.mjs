import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const kbPath = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const write = process.argv.includes('--write')
const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'))

// 口语/排版统一：只改措辞与符号，不动事实与公式
const RULES = [
  [/就好(?![像似])/g, '即可'],
  [/就行(?!了)/g, '即可'],
  [/就完事/g, '即可'],
  [/就完了/g, '即可'],
  [/完事/g, '完成'],
  [/搞定/g, '处理'],
  [/咱们/g, '我们'],
  [/咋/g, '如何'],
  [/这样干/g, '这样做'],
  [/特别/g, '尤其'],
  [/超级/g, '非常'],
  [/贼/g, '很'],
  [/{-}{-}/g, '-1'],
  [/\\text\{([^{}]*[\u4e00-\u9fff][^{}]*)\}/g, '\\text{$1}'],
]

function normalize(text) {
  let out = String(text || '')
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out
}

const changes = []
let touched = 0

for (const problem of kb.problems) {
  if (problem.essence) {
    const next = normalize(problem.essence)
    if (next !== problem.essence) {
      changes.push({ key: problem.key, field: 'essence', before: problem.essence, after: next })
      problem.essence = next
      touched += 1
    }
  }
  for (const insight of problem.insights || []) {
    const next = normalize(insight.text)
    if (next !== insight.text) {
      changes.push({ key: problem.key, field: insight.id || 'insight', before: insight.text, after: next })
      insight.text = next
      touched += 1
    }
  }
}

for (const node of kb.nodes || []) {
  if (node.summary) {
    const next = normalize(node.summary)
    if (next !== node.summary) {
      changes.push({ key: node.name, field: 'summary', before: node.summary, after: next })
      node.summary = next
      touched += 1
    }
  }
}

console.log(JSON.stringify({ touched, samples: changes.slice(0, 6).map((c) => ({ key: c.key, field: c.field, after: c.after.slice(0, 120) })) }, null, 2))

if (write) {
  const tmp = kbPath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, kbPath)
  console.log('written: ' + kbPath)
}
