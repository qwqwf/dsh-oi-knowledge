// 把中文正文里裸写的数学片段（变量、变量+数字、含算符/括号/符号的片段）包成 $…$，
// 并把常见 Unicode 运算符替换成 KaTeX 命令。
// 只处理不在 $…$ 与反引号里的普通文本段。
// 用法：node dev/inline-math.mjs [--write]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const WRITE = process.argv.includes('--write')

const CHAR = 'A-Za-z0-9()[\\]{}.,\\\\^_+\\-−×÷=<>≤≥≠≡⇒⇔±·∫∑∏√∂∞∈⊆≈→'
const SPAN_RE = new RegExp(`[${CHAR}]+(?:[ \\t]+[${CHAR}]+)*`, 'g')

const REPLACE = [
  [/−/g, '-'],
  [/∫/g, '\\int '],
  [/∑/g, '\\sum '],
  [/∏/g, '\\prod '],
  [/×/g, '\\times '],
  [/÷/g, '\\div '],
  [/≤/g, '\\le '],
  [/≥/g, '\\ge '],
  [/≠/g, '\\ne '],
  [/≡/g, '\\equiv '],
  [/⇒/g, '\\Rightarrow '],
  [/⇔/g, '\\Leftrightarrow '],
  [/±/g, '\\pm '],
  [/∞/g, '\\infty '],
  [/∈/g, '\\in '],
  [/⊆/g, '\\subseteq '],
  [/≈/g, '\\approx '],
  [/→/g, '\\to '],
  [/·/g, '\\cdot '],
]

function looksMath(span) {
  const hasLetter = /[A-Za-z]/.test(span)
  const hasDigit = /\d/.test(span)
  const hasOperator = /[+\-−×÷=<>≤≥≠≡⇒⇔±·^_()[\]{}∫∑∏√∂∞∈⊆≈→/.]/.test(span)
  const pureWord = /^[A-Za-z]{2,}$/.test(span)
  if (pureWord) return false
  if (!hasLetter && !hasDigit) return /^[≤≥≠≡⇒⇔±∞∫∑∏√∂∈⊆≈→]$/.test(span)
  if (hasOperator) return true
  if (/^[A-Za-z]$/.test(span)) return true
  if (/^[A-Za-z]\d+$/.test(span) || /^\d+[A-Za-z]$/.test(span)) return true
  return false
}

function wrapPlain(segment) {
  return segment.replace(SPAN_RE, (raw) => {
    const span = raw.trim()
    if (!span || !looksMath(span)) return raw
    let body = span
    for (const [re, rep] of REPLACE) body = body.replace(re, rep)
    body = body.replace(/[ \t]+/g, ' ').trim()
    return `$${body}$`
  })
}

function fixText(text) {
  if (typeof text !== 'string' || !text) return { text, changed: 0 }
  const parts = text.split(/(\$[^$]*\$|`[^`]*`)/g)
  let changed = 0
  const next = parts.map((part) => {
    if ((part.startsWith('$') && part.endsWith('$') && part.length > 2) || (part.startsWith('`') && part.endsWith('`'))) {
      if (part.startsWith('$')) {
        let body = part.slice(1, -1)
        const before = body
        for (const [re, rep] of REPLACE) body = body.replace(re, rep)
        body = body.replace(/[ \t]+/g, ' ').trim()
        if (body !== before) { changed += 1; return `$${body}$` }
      }
      return part
    }
    const out = wrapPlain(part)
    if (out !== part) changed += 1
    return out
  })
  return { text: next.join(''), changed }
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let total = 0
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
    total += changed
    if (samples.length < 5) samples.push({ key: problem.key, text: problem.essence || '' })
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

console.log(`修补 ${total} 处`)
for (const s of samples) console.log(s.key, '|', s.text.slice(0, 200))
if (WRITE) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回')
}
