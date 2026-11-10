// 修复 inline-math 误包造成的坏 $…$ 段：优先转义花括号，其次与后续文本合并到下一个 $，
// 仍不行就退回普通文本（去掉 $），保证 KaTeX 不再报错。
// 用法：node dev/repair-math.mjs [--write]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const WRITE = process.argv.includes('--write')
const KATEX_PATH = path.join(process.cwd(), 'assets', 'katex', 'katex.min.js')
const sandbox = { module: { exports: {} }, exports: {}, console }
sandbox.window = sandbox
sandbox.self = sandbox
sandbox.globalThis = sandbox
vm.runInNewContext(fs.readFileSync(KATEX_PATH, 'utf8'), sandbox)
const katex = sandbox.katex || (sandbox.module.exports && sandbox.module.exports.katex) || sandbox.module.exports

function parses(latex) {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false, output: 'html' })
    return true
  } catch {
    return false
  }
}
const escapeBraces = (latex) => latex.replace(/(?<!\\)\{/g, '\\{').replace(/(?<!\\)\}/g, '\\}')

function repairText(input) {
  let out = ''
  let i = 0
  let changed = false
  while (i < input.length) {
    if (input[i] !== '$') {
      out += input[i]
      i += 1
      continue
    }
    const end = input.indexOf('$', i + 1)
    if (end < 0) {
      out += input.slice(i)
      break
    }
    const latex = input.slice(i + 1, end)
    if (!latex.trim() || parses(latex)) {
      out += `$${latex}$`
      i = end + 1
      continue
    }
    const escaped = escapeBraces(latex)
    if (parses(escaped)) {
      out += `$${escaped}$`
      i = end + 1
      changed = true
      continue
    }
    const nextEnd = input.indexOf('$', end + 1)
    if (nextEnd > end) {
      const merged = escapeBraces(input.slice(i + 1, nextEnd))
      if (parses(merged)) {
        out += `$${merged}$`
        i = nextEnd + 1
        changed = true
        continue
      }
    }
    // 兜底：当普通文本，去掉这对 $
    out += latex
    i = end + 1
    changed = true
  }
  return { text: out, changed: changed || out !== input }
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let total = 0
const samples = []
function handle(where, obj, field) {
  const before = obj[field]
  if (typeof before !== 'string' || !before.includes('$')) return
  const r = repairText(before)
  if (r.changed) {
    obj[field] = r.text
    total += 1
    if (samples.length < 8) samples.push({ where, text: r.text.slice(0, 150) })
  }
}
for (const problem of kb.problems || []) {
  for (const field of ['essence', 'statement', 'solution']) handle(problem.key, problem, field)
  for (const insight of problem.insights || []) handle(`${problem.key}#${insight.id}`, insight, 'text')
}
for (const node of [...(kb.nodes || []), ...(kb.obsNodes || [])]) {
  handle(node.name, node, 'summary')
  for (const pattern of node.patterns || []) {
    if (pattern && typeof pattern === 'object') handle(`${node.name} pattern`, pattern, 'text')
  }
}
console.log(`修复 ${total} 处`)
for (const s of samples) console.log(s.where, '|', s.text)
if (WRITE) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回')
}
