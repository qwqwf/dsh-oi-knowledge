// 最后一道清理：只保留真正合法的 $…$ 段（KaTeX 可解析、不含中文），
// 其余落单的 $ 直接去掉，避免面板出现裸 $ 或红方块。
// 用法：node dev/cleanup-math.mjs [--write]
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

function parses(latex) {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false, output: 'html' })
    return true
  } catch {
    return false
  }
}

function cleanText(text) {
  let out = ''
  let i = 0
  let changed = false
  while (i < text.length) {
    if (text[i] !== '$') {
      out += text[i]
      i += 1
      continue
    }
    const end = text.indexOf('$', i + 1)
    if (end < 0) {
      changed = true
      i += 1 // 落单的 $ 丢弃
      continue
    }
    const latex = text.slice(i + 1, end)
    const ok = latex.trim() && !/[\u4e00-\u9fff]/.test(latex) && parses(latex)
    if (ok) {
      out += `$${latex}$`
    } else {
      out += latex
      changed = true
    }
    i = end + 1
  }
  return { text: out, changed: changed || out !== text }
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let fixed = 0
const samples = []
function handle(where, obj, field) {
  const before = obj[field]
  if (typeof before !== 'string' || !before.includes('$')) return
  const r = cleanText(before)
  if (r.changed) {
    obj[field] = r.text
    fixed += 1
    if (samples.length < 6) samples.push({ where, text: r.text.slice(0, 150) })
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
console.log(`清理 ${fixed} 处`)
for (const s of samples) console.log(s.where, '|', s.text)
if (WRITE) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回')
}
