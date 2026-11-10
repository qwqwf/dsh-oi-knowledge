// 逐个 $…$ 段做严格 KaTeX 校验；失败的段尝试常见修复，修不好就降级成可读文本。
// 用法：node dev/fix-tex-errors.mjs [--write]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const WRITE = process.argv.includes('--write')
const sandbox = { module: { exports: {} }, exports: {}, console }
sandbox.window = sandbox
sandbox.self = sandbox
sandbox.globalThis = sandbox
vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), 'assets', 'katex', 'katex.min.js'), 'utf8'), sandbox)
const katex = sandbox.katex || (sandbox.module.exports && sandbox.module.exports.katex) || sandbox.module.exports

const parses = (tex) => {
  try {
    katex.renderToString(tex, { throwOnError: true, strict: 'ignore', trust: false })
    return true
  } catch {
    return false
  }
}

const UNICODE = [
  [/\\ge\b/g, '≥'], [/\\le\b/g, '≤'], [/\\ne\b/g, '≠'], [/\\equiv\b/g, '≡'],
  [/\\times\b/g, '×'], [/\\cdot\b/g, '·'], [/\\pm\b/g, '±'], [/\\infty\b/g, '∞'],
  [/\\to\b/g, '→'], [/\\Rightarrow\b/g, '⇒'], [/\\in\b/g, '∈'], [/\\subseteq\b/g, '⊆'],
  [/\\int\b/g, '∫'], [/\\sum\b/g, '∑'], [/\\prod\b/g, '∏'], [/\\partial\b/g, '∂'],
  [/\\dots\b/g, '…'], [/\\cdots\b/g, '…'], [/\\log\b/g, 'log'], [/\\min\b/g, 'min'],
  [/\\max\b/g, 'max'], [/\\gcd\b/g, 'gcd'], [/\\lfloor\b/g, '⌊'], [/\\rfloor\b/g, '⌋'],
  [/\\text\{([^{}]*)\}/g, '$1'], [/\\mathrm\{([^{}]*)\}/g, '$1'], [/\\mathbf\{([^{}]*)\}/g, '$1'],
  [/\\operatorname\{([^{}]*)\}/g, '$1'], [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)'],
  [/\\binom\{([^{}]*)\}\{([^{}]*)\}/g, 'C($1,$2)'], [/\\pmod\{([^{}]*)\}/g, ' (mod $1)'],
]
const humanize = (s) => {
  let out = s
  for (const [re, rep] of UNICODE) out = out.replace(re, rep)
  return out.replace(/\\[A-Za-z]+/g, '').replace(/\$/g, '').replace(/\s+/g, ' ').trim()
}

function candidates(tex) {
  const list = []
  list.push(tex.replace(/\$/g, ''))
  list.push(tex.replace(/\\log(?=[A-Za-z])/g, '\\log '))
  list.push(tex.replace(/\\{([^{}$\\]{1,24})\}/g, (m, body) => `\\{${body}\\}`))
  list.push(tex.replace(/\$/g, '').replace(/\\log(?=[A-Za-z])/g, '\\log '))
  list.push(
    tex
      .replace(/\$/g, '')
      .replace(/\\log(?=[A-Za-z])/g, '\\log ')
      .replace(/\\text\{([^{}]*)\}/g, (m, body) => `\\text{${body.replace(/[{}]/g, '')}}`),
  )
  return list
}

function fixSegment(tex) {
  if (!tex.trim()) return { tex, ok: false }
  if (parses(tex)) return { tex: `$${tex}$`, ok: true }
  for (const candidate of candidates(tex)) {
    if (candidate && candidate !== tex && parses(candidate)) return { tex: `$${candidate}$`, ok: true }
  }
  return { tex: humanize(tex), ok: false }
}

let repaired = 0
let degraded = 0
const samples = []

function fixText(text) {
  if (typeof text !== 'string' || !text.includes('$')) return text
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '$') {
      out += text[i]
      i += 1
      continue
    }
    const end = text.indexOf('$', i + 1)
    if (end < 0) {
      i += 1
      continue
    }
    const tex = text.slice(i + 1, end)
    const result = fixSegment(tex)
    if (result.ok) repaired += 1
    else degraded += 1
    if (samples.length < 6 && !result.ok) samples.push({ tex, out: result.tex })
    out += result.tex
    i = end + 1
  }
  return out
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let changed = 0
function handle(obj, field) {
  const before = obj[field]
  if (typeof before !== 'string') return
  const after = fixText(before)
  if (after !== before) {
    changed += 1
    if (WRITE) obj[field] = after
  }
}
for (const problem of kb.problems || []) {
  for (const field of ['essence', 'statement', 'solution']) handle(problem, field)
  for (const insight of problem.insights || []) handle(insight, 'text')
}
for (const node of [...(kb.nodes || []), ...(kb.obsNodes || [])]) {
  handle(node, 'summary')
  for (const pattern of node.patterns || []) if (pattern && typeof pattern === 'object') handle(pattern, 'text')
}

console.log(`变更 ${changed} 段文本；可修复 ${repaired} 段，降级 ${degraded} 段`)
for (const s of samples) console.log('DEGRADE:', s.tex.slice(0, 90), '→', s.out.slice(0, 90))
if (WRITE) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回')
}
