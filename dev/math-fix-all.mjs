// 全库数学渲染体检 + 修复：
// 1) 扫描所有文本字段，列出「$ 外面还有数学片段」的情况
// 2) 用保守规则把这些片段包进 $…$，每段先用 KaTeX 验证，失败就保持原样
// 3) --write 原子写回 kb.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const katexSource = fs.readFileSync(
  path.join(process.cwd(), 'assets', 'katex', 'katex.min.js'),
  'utf8',
)
const sandbox = { window: {}, console, module: { exports: {} } }
vm.runInNewContext(katexSource, sandbox)
const katex = sandbox.katex || sandbox.module.exports

function parses(latex) {
  if (!latex || !latex.trim()) return false
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'ignore', displayMode: false })
    return true
  } catch (_) {
    return false
  }
}

const UNICODE = {
  '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '∞': '\\infty ', '∑': '\\sum ',
  '√': '\\surd ', '×': '\\times ', '÷': '\\div ', '≈': '\\approx ',
  '→': '\\to ', '⇒': '\\Rightarrow ', '∈': '\\in ', '⊆': '\\subseteq ',
  '⋅': '\\cdot ', '±': '\\pm ', '∅': '\\varnothing ',
}

// 按 $…$ 与 `…` 切段，只处理普通文本段
function splitProtected(text) {
  const parts = []
  let buf = ''
  let mode = 'text' // text | math | code
  let fence = null
  for (const ch of String(text || '')) {
    if (mode === 'text' && (ch === '$' || ch === '`')) {
      if (buf) parts.push({ mode, text: buf })
      buf = ch
      mode = ch === '$' ? 'math' : 'code'
      fence = ch
      continue
    }
    if (mode !== 'text' && ch === fence) {
      buf += ch
      parts.push({ mode, text: buf })
      buf = ''
      mode = 'text'
      fence = null
      continue
    }
    buf += ch
  }
  if (buf) parts.push({ mode, text: buf })
  return parts
}

const RULES = [
  ['cmd', /\\[A-Za-z]+(?:\{[^{}]*\})*/g],
  ['bigO', /\bO\([^()]{1,48}\)/g],
  ['pow', /\b[A-Za-z0-9]+\s*\^\s*(?:\{[^{}]+\}|[A-Za-z0-9]+)/g],
  ['sub', /\b[A-Za-z]\s*_\s*(?:\{[^{}]+\}|[A-Za-z0-9]+)/g],
  ['array', /\b[A-Za-z][A-Za-z0-9]*\[[^\[\]]+\](?:\[[^\[\]]+\])*/g],
  ['cmp', /[A-Za-z0-9]+\s*[≤≥<>]\s*[A-Za-z0-9]+/g],
  ['expr', /(?<![\w$\\])(?:[A-Za-z0-9]+(?:\s*[-+*/=<>]\s*[A-Za-z0-9]+)+)(?![\w$\\])/g],
  ['unicode', /[≤≥≠∞∑√×÷≈→⇒∈⊆⋅±∅]/g],
  ['var', /(?<![\w$\\])[A-Za-z](?![\w$\\])/g],
]

const CJK = /[\u4e00-\u9fff]/

function cleanMath(source) {
  let body = String(source).trim().replace(/^\$+|\$+$/g, '').trim()
  // dp[i][j] → dp_{i,j}；map[S] 这类长单词保留方括号
  body = body.replace(/\b([A-Za-z][A-Za-z0-9]*)((?:\[[^\[\]]+\])+)/g, (_m, base, bracket) => {
    const inner = [...bracket.matchAll(/\[([^\[\]]+)\]/g)].map((item) => item[1].trim()).join(',')
    if (base.length <= 3) return `${base}_{${inner}}`
    return `\\mathrm{${base}}${bracket.replace(/\[([^\[\]]+)\]/g, '[$1]')}`
  })
  body = body.replace(/\s*\^\s*\{([^{}]*)\}/g, '^{$1}').replace(/\s*\^\s*([A-Za-z0-9]+)/g, '^{$1}')
  body = body.replace(/\s*_\s*\{([^{}]*)\}/g, '_{$1}').replace(/\s*_\s*([A-Za-z0-9]+)/g, '_{$1}')
  for (const [from, to] of Object.entries(UNICODE)) body = body.split(from).join(to.trim())
  // 多字母单词（不是命令）套 \mathrm，避免被当成一串变量
  body = body.replace(/(?<!\\)\b([A-Za-z]{2,})\b/g, (m) => `\\mathrm{${m}}`)
  body = body.replace(/\\mathrm\{([^{}]*)\}_/g, '\\mathrm{$1}_')
  return body
}

// 像 hockey-stick、DFS/BFS、output-only 这种是英文复合词，不该当公式
function isWordCompound(match) {
  const bare = match.trim().replace(/\s+/g, '')
  if (/^[A-Za-z]{2,}(?:[-/][A-Za-z]{2,})+$/.test(bare)) return true
  if (/^\d+-[A-Za-z]{2,}$/.test(bare)) return true // 1-based
  return false
}

function applyRule(text, rule, options = {}) {
  const parts = splitProtected(text)
  return parts
    .map((part) => {
      if (part.mode !== 'text') return part.text
      return part.text.replace(rule, (match) => {
        if (isWordCompound(match)) return match
        const body = cleanMath(match)
        if (!parses(body)) return match
        return `$${body}$`
      })
    })
    .join('')
}

function wrapSegment(segment, options = {}) {
  let text = segment
  const hasCjk = CJK.test(segment)
  for (const [name, re] of RULES) {
    if (name === 'var' && (!hasCjk || options.skipVar)) continue
    text = applyRule(text, re)
  }
  // 相邻的两个数学段之间只有空格时，并成一段（$n$ $\le$ 20 → $n \le$ 20）
  let merged = text
  for (let i = 0; i < 4; i += 1) {
    const next = merged
      .replace(/\$([^$]+)\$\s+\$([^$]+)\$/g, '$$$1 $2$$')
      .replace(/\[\$([A-Za-z0-9]+)\$,\$([A-Za-z0-9]+)\$\]/g, '$$[$1,$2]$$')
    if (next === merged) break
    merged = next
  }
  return merged
}

function fixText(text, options = {}) {
  if (!text || typeof text !== 'string') return { text, changed: false, notes: [] }
  const parts = splitProtected(text)
  const notes = []
  const fixed = parts.map((part) => {
    if (part.mode !== 'text') return part.text
    const before = part.text
    const after = wrapSegment(before, options)
    if (after !== before) {
      const samples = after.match(/\$[^$]{1,40}\$/g) || []
      notes.push(...samples.slice(0, 3))
    }
    return after
  }).join('')
  const normalized = fixed
    .replace(/\[\$([A-Za-z0-9]+)\$,\$([A-Za-z0-9]+)\$\]/g, '$$[$1,$2]$$')
    .replace(/\[\$([A-Za-z0-9]+)\$\s*,\s*\$([A-Za-z0-9]+)\$\]/g, '$$[$1,$2]$$')
  return { text: normalized, changed: normalized !== text, notes }
}

const useWrite = process.argv.includes('--write')
const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
const changes = []
const examples = []

function touch(label, owner, obj, field) {
  const value = obj[field]
  const options = label === 'problem.titleZh' ? { skipVar: true } : {}
  const result = fixText(value, options)
  if (!result.changed) return
  obj[field] = result.text
  changes.push({ label, owner, field })
  if (examples.length < 12) examples.push({ label, owner, field, before: value, after: result.text, notes: result.notes.slice(0, 2) })
}

function touchArray(label, owner, arr, options = {}) {
  if (!Array.isArray(arr)) return
  for (let i = 0; i < arr.length; i += 1) {
    const before = arr[i]
    const result = fixText(arr[i], options)
    if (result.changed) {
      arr[i] = result.text
      changes.push({ label, owner, field: `[${i}]` })
      if (examples.length < 12) examples.push({ label, owner, field: `[${i}]`, before, after: result.text, notes: result.notes.slice(0, 2) })
    }
  }
}

for (const problem of kb.problems || []) {
  const owner = `${problem.platform}:${problem.key}`
  for (const field of ['essence', 'statementZh', 'titleZh']) touch(`problem.${field}`, owner, problem, field)
  for (const insight of problem.insights || []) touch('insight', owner, insight, 'text')
}
for (const node of kb.nodes || []) {
  touch('node.summary', node.name, node, 'summary')
  touchArray('node.signal', node.name, node.signals)
  for (const pattern of node.patterns || []) touch('node.pattern', node.name, pattern, 'text')
}
for (const node of kb.obsNodes || []) {
  touch('obs.summary', node.name, node, 'summary')
  touchArray('obs.signal', node.name, node.signals)
  for (const pattern of node.patterns || []) touch('obs.pattern', node.name, pattern, 'text')
}

console.log(`待改 ${changes.length} 处`)
for (const ex of examples) {
  console.log('-', ex.label, ex.owner, ex.field)
  console.log('  before:', JSON.stringify(ex.before))
  console.log('  after :', JSON.stringify(ex.after))
}

if (!useWrite) {
  console.log('（dry-run，加 --write 写回）')
} else {
  const tmp = `${KB_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回', KB_PATH)
}
