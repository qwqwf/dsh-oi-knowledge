// 收尾修复：普通文本里裸露的 LaTeX 命令降级成 Unicode（如 \ge → ≥、\frac{a}{b} → a/b），
// 已包在 $…$ 里的数学段保持原样。用法：node dev/fix-text-math.mjs [--write]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const WRITE = process.argv.includes('--write')

const UNICODE = [
  [/\\ge\b/g, '≥'], [/\\le\b/g, '≤'], [/\\ne\b/g, '≠'], [/\\equiv\b/g, '≡'],
  [/\\times\b/g, '×'], [/\\cdot\b/g, '·'], [/\\pm\b/g, '±'], [/\\infty\b/g, '∞'],
  [/\\to\b/g, '→'], [/\\Rightarrow\b/g, '⇒'], [/\\Leftrightarrow\b/g, '⇔'],
  [/\\in\b/g, '∈'], [/\\subseteq\b/g, '⊆'], [/\\subsetneq\b/g, '⊊'], [/\\supsetneq\b/g, '⊋'],
  [/\\int\b/g, '∫'], [/\\sum\b/g, '∑'], [/\\prod\b/g, '∏'], [/\\partial\b/g, '∂'],
  [/\\dots\b/g, '…'], [/\\cdots\b/g, '…'], [/\\ldots\b/g, '…'],
  [/\\log\b/g, 'log'], [/\\ln\b/g, 'ln'], [/\\min\b/g, 'min'], [/\\max\b/g, 'max'], [/\\gcd\b/g, 'gcd'],
  [/\\lfloor\b/g, '⌊'], [/\\rfloor\b/g, '⌋'], [/\\lceil\b/g, '⌈'], [/\\rceil\b/g, '⌉'],
  [/\\text\{([^{}]*)\}/g, '$1'], [/\\mathrm\{([^{}]*)\}/g, '$1'], [/\\mathbf\{([^{}]*)\}/g, '$1'],
  [/\\operatorname\{([^{}]*)\}/g, '$1'],
  [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)'],
  [/\\sqrt\{([^{}]*)\}/g, '√($1)'],
  [/\\binom\{([^{}]*)\}\{([^{}]*)\}/g, 'C($1,$2)'],
  [/\\pmod\{([^{}]*)\}/g, ' (mod $1)'],
  [/\\(?:left|right|big|Big|bigg|Bigg)\b/g, ''],
  [/\\[{}]/g, (m) => (m === '\\{' ? '{' : '}')],
]

function humanize(part) {
  let out = part
  for (const [re, rep] of UNICODE) out = out.replace(re, rep)
  return out.replace(/\\[A-Za-z]+/g, '').replace(/\\/g, '')
}

function fixText(text) {
  if (typeof text !== 'string' || !text.includes('\\')) return text
  const parts = text.split(/(\$[^$]*\$)/g)
  return parts.map((part) => {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) return part
    return humanize(part)
  }).join('')
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let changed = 0
const samples = []
function handle(where, obj, field) {
  const before = obj[field]
  if (typeof before !== 'string' || !before.includes('\\')) return
  const after = fixText(before)
  if (after !== before) {
    changed += 1
    if (samples.length < 6) samples.push({ where, before: before.slice(0, 110), after: after.slice(0, 130) })
    if (WRITE) obj[field] = after
  }
}
for (const problem of kb.problems || []) {
  for (const field of ['essence', 'statement', 'solution']) handle(problem.key, problem, field)
  for (const insight of problem.insights || []) handle(`${problem.key}#${insight.id}`, insight, 'text')
}
for (const node of [...(kb.nodes || []), ...(kb.obsNodes || [])]) {
  handle(node.name, node, 'summary')
  for (const pattern of node.patterns || []) if (pattern && typeof pattern === 'object') handle(`${node.name} pattern`, pattern, 'text')
}
console.log(`变更 ${changed} 处${WRITE ? '' : '（dry-run）'}`)
for (const s of samples) {
  console.log('\n' + s.where)
  console.log('  before:', s.before)
  console.log('  after :', s.after)
}
if (WRITE) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回')
}
