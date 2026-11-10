// 修中文题面里的“假数学”：翻译服务把 \ldots 写成 \ ldots，且公式没有 $ 包裹。
// 只处理 statementZh / essence：按 $…$ 保护已有数学，再按 CJK 切块；非中文块若含 LaTeX 命令，
// 整块规范空格并包成 $…$（KaTeX 校验通过才替换），不做跨句合并。
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

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/
const CMD_SPACE = /\\\s+([A-Za-z]+)/g

function normalizeMath(raw) {
  return raw
    .replace(CMD_SPACE, '\\$1')
    .replace(/\\(le|ge)\s+q\b/g, '\\$1')
    .replace(/\s*\^\s*/g, '^')
    .replace(/\s*_\s*/g, '_')
    .replace(/\s*([{}])\s*/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function wrapChunk(chunk) {
  if (!chunk || !/\\\s*[A-Za-z]/.test(chunk)) return chunk
  const lead = chunk.match(/^\s*/)[0]
  const trail = chunk.match(/\s*$/)[0]
  let core = chunk.trim()
  const tailPunct = core.match(/[，。；：、,;:.]+$/)
  if (tailPunct) core = core.slice(0, -tailPunct[0].length)
  const latex = normalizeMath(core)
  if (!latex || !/[\\_^]/.test(latex) || !parses(latex)) return chunk
  return `${lead}$${latex}$${trail}${tailPunct ? tailPunct[0] : ''}`
}

export function fixText(text) {
  if (!text) return text
  return String(text)
    .split(/(\$[^$]*\$)/)
    .map((part) => {
      if (part.startsWith('$')) return part
      return part
        .split(/([\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+)/)
        .map((piece) => {
          if (CJK.test(piece)) return piece
          // 按行处理，避免一个 $…$ 跨多行把好几段数字都卷进去
          return piece
            .split(/(\n+)/)
            .map((line) => (/^\n+$/.test(line) ? line : wrapChunk(line)))
            .join('')
        })
        .join('')
    })
    .join('')
}

// 英文题面：只把孤立的 LaTeX 命令（如 \ldots、\le）包成行内公式，避免动到整句。
function wrapLoneCommands(text) {
  if (!text || !/\\[A-Za-z]+/.test(text)) return text
  return String(text)
    .split(/(\$[^$]*\$)/)
    .map((part) => {
      if (part.startsWith('$')) return part
      return part.replace(/(\\[A-Za-z]+)/g, (match) => (parses(match) ? `$${match}$` : match))
    })
    .join('')
}

function main() {
  const write = process.argv.includes('--write')
  const file = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
  const kb = JSON.parse(fs.readFileSync(file, 'utf8'))
  let problems = 0
  let fields = 0
  for (const problem of kb.problems) {
    let changed = false
    for (const key of ['statementZh', 'essence']) {
      const before = problem[key] || ''
      const after = fixText(before)
      if (after !== before) {
        if (!write && fields < 10) {
          console.log(`--- ${problem.platform}:${problem.key} ${key}`)
          console.log(after.slice(0, 300).replace(/\n/g, '⏎'))
        }
        if (write) problem[key] = after
        fields += 1
        changed = true
      }
    }
    // Codeforces 的题面用 $$$…$$$ 表示行内公式，统一成 $…$
    for (const key of ['statement', 'solution']) {
      const before = problem[key] || ''
      if (!before.includes('$$$')) continue
      const after = before.replace(/\$\$\$/g, '$')
      if (write) problem[key] = after
      fields += 1
      changed = true
    }
    if (changed) problems += 1
  }
  console.log(`\n${write ? 'written' : 'preview'} problems=${problems} fields=${fields}`)
  if (write) {
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) main()
