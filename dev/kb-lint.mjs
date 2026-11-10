// 全库体检：脏字符、$ 不配对、KaTeX 解析失败、裸 LaTeX 残留。
// 用法：node dev/kb-lint.mjs [--fix]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const KATEX_PATH = path.resolve(import.meta.dirname, '..', 'assets', 'katex', 'katex.min.js')
const sandbox = {}
vm.runInNewContext(fs.readFileSync(KATEX_PATH, 'utf8'), sandbox, { filename: 'katex.min.js' })
const katex = sandbox.katex
const FIX = process.argv.includes('--fix')

const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
const MARK = '\u0003'

function segments(text) {
  const out = []
  let i = 0
  while (i < text.length) {
    if (text.startsWith('$$', i)) {
      const end = text.indexOf('$$', i + 2)
      if (end < 0) break
      out.push({ display: true, value: text.slice(i + 2, end) })
      i = end + 2
      continue
    }
    if (text[i] === '$') {
      const end = text.indexOf('$', i + 1)
      if (end < 0) break
      out.push({ display: false, value: text.slice(i + 1, end) })
      i = end + 1
      continue
    }
    i += 1
  }
  return out
}

function katexError(latex) {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false, output: 'html' })
    return null
  } catch (error) {
    return String(error && error.message ? error.message : error).slice(0, 160)
  }
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
const issues = []

function checkText(where, key, text, field) {
  if (typeof text !== 'string' || !text) return
  if (CTRL.test(text)) issues.push({ where, key, field, type: 'control-char', detail: JSON.stringify(text.match(CTRL)[0]) })
  if (text.split('$').length % 2 === 0) issues.push({ where, key, field, type: 'unbalanced-$', detail: `$${text.split('$').length - 1} 个` })
  for (const seg of segments(text)) {
    const err = katexError(seg.value)
    if (err) issues.push({ where, key, field, type: 'katex-error', detail: `${JSON.stringify(seg.value.slice(0, 70))} :: ${err}` })
  }
}

for (const problem of kb.problems || []) {
  checkText('problem', problem.key, problem.essence, 'essence')
  checkText('problem', problem.key, problem.statement, 'statement')
  checkText('problem', problem.key, problem.solution, 'solution')
  for (const insight of problem.insights || []) {
    checkText('insight', `${problem.key}#${insight.id || ''}`, insight.text, 'text')
  }
  if (problem.keyObservations && Array.isArray(problem.keyObservations)) {
    for (const obs of problem.keyObservations) {
      if (typeof obs === 'string') checkText('keyObs', problem.key, obs, 'keyObs')
      else checkText('keyObs', problem.key, obs.text, 'keyObs')
    }
  }
}
for (const node of kb.nodes || []) {
  checkText('node', node.name, node.summary, 'summary')
  for (const p of node.patterns || []) {
    checkText('pattern', node.name, typeof p === 'string' ? p : p.text, 'pattern')
  }
}
for (const node of kb.obsNodes || []) {
  checkText('obsNode', node.name, node.summary, 'summary')
  for (const p of node.patterns || []) {
    checkText('pattern', node.name, typeof p === 'string' ? p : p.text, 'pattern')
  }
}

const byType = {}
for (const issue of issues) byType[issue.type] = (byType[issue.type] || 0) + 1
console.log(`总问题 ${issues.length} 条`, byType)
for (const issue of issues.slice(0, 40)) {
  console.log(`- [${issue.type}] ${issue.where} ${issue.key} ${issue.field} :: ${issue.detail}`)
}

if (FIX) {
  let fixed = 0
  const clean = (text) => {
    if (typeof text !== 'string') return text
    let out = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    if (out !== text) fixed += 1
    return out
  }
  for (const problem of kb.problems || []) {
    problem.essence = clean(problem.essence)
    problem.statement = clean(problem.statement)
    problem.solution = clean(problem.solution)
    for (const insight of problem.insights || []) insight.text = clean(insight.text)
  }
  for (const node of [...(kb.nodes || []), ...(kb.obsNodes || [])]) {
    for (const p of node.patterns || []) {
      if (p && typeof p === 'object') p.text = clean(p.text)
    }
  }
  if (fixed) {
    const tmp = `${KB_PATH}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
    fs.renameSync(tmp, KB_PATH)
  }
  console.log(`已清理控制字符字段 ${fixed} 个`)
}
