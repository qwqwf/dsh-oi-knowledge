// 修复 $ 个数为奇数的文本：尝试删掉任意一个 $，使剩余数学段全部能被 KaTeX 解析。
// 用法：node dev/rebalance-math.mjs [--write]
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

const parses = (latex) => {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false, output: 'html' })
    return true
  } catch {
    return false
  }
}

function segmentsOk(text) {
  const parts = text.split('$')
  if (parts.length % 2 === 0) return false // 应为奇数段：text math text math ... text
  for (let i = 1; i < parts.length; i += 2) {
    const latex = parts[i]
    if (!latex.trim() || !parses(latex)) return false
  }
  return true
}

function rebalance(text) {
  const count = (text.match(/\$/g) || []).length
  if (count % 2 === 0 || count === 0) return { text, changed: 0 }
  let best = null
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '$') continue
    const candidate = text.slice(0, i) + text.slice(i + 1)
    if (segmentsOk(candidate)) {
      best = candidate
      break
    }
  }
  if (best) return { text: best, changed: 1 }
  return { text: text, changed: 0, failed: true }
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let fixed = 0
let failed = 0
const samples = []
function handle(where, obj, field) {
  const before = obj[field]
  if (typeof before !== 'string' || !before.includes('$')) return
  const r = rebalance(before)
  if (r.changed) {
    obj[field] = r.text
    fixed += 1
    if (samples.length < 5) samples.push({ where, text: r.text.slice(0, 140) })
  } else if (r.failed) {
    failed += 1
    console.log('FAILED', where)
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
console.log(`修复 ${fixed}，失败 ${failed}`)
for (const s of samples) console.log(s.where, '|', s.text)
if (WRITE) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回')
}
