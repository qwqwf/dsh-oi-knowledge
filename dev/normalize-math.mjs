// 全库数学文本归一化：按中文/标点切段，段内去掉旧 $，能整体解析的包成一段 $…$，
// 不能解析的把 LaTeX 命令降级成 Unicode 文本。
// 用法：node dev/normalize-math.mjs [--dry] [--write]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const DRY = process.argv.includes('--dry') || !process.argv.includes('--write')
const sandbox = { module: { exports: {} }, exports: {}, console }
sandbox.window = sandbox
sandbox.self = sandbox
sandbox.globalThis = sandbox
vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), 'assets', 'katex', 'katex.min.js'), 'utf8'), sandbox)
const katex = sandbox.katex || (sandbox.module.exports && sandbox.module.exports.katex) || sandbox.module.exports

const parses = (latex) => {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false, output: 'html' })
    return true
  } catch {
    return false
  }
}

const UNICODE = [
  [/\\ge\b/g, '≥'], [/\\le\b/g, '≤'], [/\\ne\b/g, '≠'], [/\\equiv\b/g, '≡'],
  [/\\times\b/g, '×'], [/\\div\b/g, '÷'], [/\\cdot\b/g, '·'], [/\\pm\b/g, '±'],
  [/\\infty\b/g, '∞'], [/\\to\b/g, '→'], [/\\Rightarrow\b/g, '⇒'], [/\\Leftrightarrow\b/g, '⇔'],
  [/\\in\b/g, '∈'], [/\\subseteq\b/g, '⊆'], [/\\subsetneq\b/g, '⊊'], [/\\supsetneq\b/g, '⊋'],
  [/\\int\b/g, '∫'], [/\\sum\b/g, '∑'], [/\\prod\b/g, '∏'], [/\\partial\b/g, '∂'],
  [/\\dots\b/g, '…'], [/\\cdots\b/g, '…'], [/\\ldotp\b/g, '.'], [/\\log\b/g, 'log'],
  [/\\ln\b/g, 'ln'], [/\\min\b/g, 'min'], [/\\max\b/g, 'max'], [/\\gcd\b/g, 'gcd'],
  [/\\lfloor\b/g, '⌊'], [/\\rfloor\b/g, '⌋'], [/\\lceil\b/g, '⌈'], [/\\rceil\b/g, '⌉'],
  [/\\text\{([^{}]*)\}/g, '$1'], [/\\mathrm\{([^{}]*)\}/g, '$1'], [/\\mathbf\{([^{}]*)\}/g, '$1'],
  [/\\mathcal\{([^{}]*)\}/g, '$1'], [/\\operatorname\{([^{}]*)\}/g, '$1'],
  [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2'],
  [/\\sqrt\{([^{}]*)\}/g, '√$1'],
  [/\\binom\{([^{}]*)\}\{([^{}]*)\}/g, 'C($1,$2)'],
  [/\\pmod\{([^{}]*)\}/g, ' (mod $1)'],
  [/\\(?:left|right|big|Big|bigg|Bigg)\b/g, ''],
  [/\\[{}]/g, (m) => (m === '\\{' ? '{' : '}')],
]

function humanize(run) {
  let out = run
  for (const [re, rep] of UNICODE) out = out.replace(re, rep)
  return out.replace(/\s+/g, ' ').trim()
}

const MATHISH = /[A-Za-z0-9_^()[\]{}<>=+\-−×÷·≤≥≠≡⇒⇔±∞∫∑∏∂]/

function normRun(raw) {
  const run = raw.replace(/\$/g, '').trim()
  if (!run) return { text: run, math: false }
  if (!MATHISH.test(run)) return { text: run, math: false }
  const hasOperator = /[<>=+\-−×÷·≤≥≠≡⇒⇔^_/]/.test(run)
  const singleLetter = /^[A-Za-z]$/.test(run)
  const bracketIdent = /^[A-Za-z][A-Za-z0-9]*(?:\[[^[\]]*\])+$/.test(run)
  const command = /\\/.test(run)
  if (!hasOperator && !singleLetter && !bracketIdent && !command) return { text: run, math: false }
  if (!/[\u4e00-\u9fff]/.test(run) && parses(run)) return { text: `$${run}$`, math: true }
  return { text: humanize(run), math: false }
}

// 按中文与中文标点切段，中文原样保留，其余段尝试数学化
function normalize(text) {
  if (typeof text !== 'string') return text
  const chunks = text.split(/([\u4e00-\u9fff，。；：！？、「」『』（）]+)/g)
  return chunks.map((chunk) => {
    if (!chunk) return chunk
    if (/[\u4e00-\u9fff，。；：！？、「」『』（）]/.test(chunk)) return chunk
    if (chunk.startsWith('`')) return chunk
    const r = normRun(chunk)
    return r.text
  }).join('')
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let changed = 0
const samples = []
function handle(where, obj, field) {
  const before = obj[field]
  if (typeof before !== 'string' || !before) return
  const after = normalize(before)
  if (after !== before) {
    changed += 1
    if (samples.length < 8) samples.push({ where, before: before.slice(0, 120), after: after.slice(0, 140) })
    if (!DRY) obj[field] = after
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
console.log(`变更 ${changed} 处${DRY ? '（dry-run）' : ''}`)
for (const s of samples) {
  console.log('\n' + s.where)
  console.log('  before:', s.before)
  console.log('  after :', s.after)
}
if (!DRY) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回')
}
