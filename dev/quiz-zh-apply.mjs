// 把子代理产出的中文题意写回 quiz 题：只改 statementZh / titleZh，不挂树、不动统计。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const asset = path.join(here, '..', 'assets', 'katex', 'katex.min.js')
const sandbox = {}
vm.runInNewContext(fs.readFileSync(asset, 'utf8'), sandbox)
const katex = sandbox.katex

function parses(latex) {
  try {
    katex.renderToString(latex, { throwOnError: true, displayMode: false, strict: 'ignore' })
    return true
  } catch (_) {
    return false
  }
}

function cleanZh(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function badMath(text) {
  const parts = String(text).split(/(\$[^$]*\$)/).filter((p) => p.startsWith('$') && p.endsWith('$') && p.length > 2)
  return parts.some((part) => {
    const inner = part.slice(1, -1)
    return !parses(inner)
  })
}

const dir = path.join(here, 'quiz-zh')
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^out-\d+\.json$/.test(f)).sort() : []
if (!files.length) {
  console.error('no out-*.json in dev/quiz-zh')
  process.exit(1)
}

const write = process.argv.includes('--write')
const kbFile = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const kb = JSON.parse(fs.readFileSync(kbFile, 'utf8'))
const index = new Map()
for (const problem of kb.problems) index.set(`${problem.platform}:${problem.key}`, problem)

let entries = 0
let applied = 0
let skipped = 0
const problems = new Set()
for (const file of files) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
  for (const row of rows) {
    entries += 1
    const problem = index.get(row.key) || index.get(row.key.replace(/^atcoder:/, 'atcoder:').replace(/^codeforces:/, 'codeforces:'))
    if (!problem) {
      console.log('missing problem', row.key)
      skipped += 1
      continue
    }
    const zh = cleanZh(row.zh)
    if (!zh || !/[\u4e00-\u9fff]/.test(zh) || badMath(zh)) {
      console.log('reject', row.key, 'zh?', Boolean(zh), 'chinese?', /[\u4e00-\u9fff]/.test(zh), 'badmath?', badMath(zh))
      skipped += 1
      continue
    }
    if (write) {
      problem.statementZh = zh
      if (row.titleZh && !/[\u4e00-\u9fff]/.test(String(problem.titleZh || ''))) problem.titleZh = cleanZh(row.titleZh)
      problem.updatedAt = new Date().toISOString()
    }
    applied += 1
    problems.add(row.key)
  }
}

console.log(`${write ? 'applied' : 'preview'} entries=${entries} applied=${applied} skipped=${skipped} problems=${problems.size}`)
if (write) {
  const tmp = `${kbFile}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, kbFile)
}
