// 把库里「裸写的 LaTeX / 数学记号」包成 $...$，让面板的 KaTeX 兜得住。
// 用法：node dev/fix-math.mjs          只报告，不改库
//       node dev/fix-math.mjs --write  写回 kb.json（原子写）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const WRITE = process.argv.includes('--write')

const TOKEN_RES = [
  // 命令：\mathrm{...}、\ge、\frac{a}{b}
  /\\[A-Za-z]+(?:\{[^{}]*\})*/g,
  // 带方括号的标识符：dp[i][j]、dp[i][A_i]（先于下标规则，避免拆开）
  /\b(?:dp|f|g|h|ans|sum|pre|suf|cnt|a|b|c|s|d|p|P|A|B|C|S|T)\[[A-Za-z0-9_+\-*/ ]+\](?:\[[A-Za-z0-9_+\-*/ ]+\])*/g,
  // 下标/上标链：A_{i+1}、a^b、10^L
  /[A-Za-z0-9]+(?:_\{[^{}]*\}|\^\{[^{}]*\}|_[A-Za-z0-9]|\^[A-Za-z0-9])+/g,
  // 复杂度：O(N log N)、O(n^2)
  /\bO\([^()\n]{1,40}\)/g,
  // 指数/幂：10^L-1 已在链里；这里兜 2^k
  /\b\d+\^[A-Za-z0-9]+\b/g,
  // 数字+单字母：2N、4k
  /\b\d+[NnKkMm]\b/g,
]

// 单个符号也值得进数学模式
const SYMBOLS = ['≡', '⇒', '⇔', '≤', '≥', '≠', '∈', '∉', '⊆', '∞', '∑', '∏', '⊕', '⊗', '∧', '∨']

const isWordChar = (ch) => /[A-Za-z0-9_]/.test(ch || '')

const MARK = '\u0003'

function wrapSegment(segment) {
  let out = segment
  let changed = 0
  const store = []
  for (const re of TOKEN_RES) {
    out = out.replace(re, (match, offset, whole) => {
      const before = whole[offset - 1]
      const after = whole[offset + match.length]
      // 两侧是字母/数字/下划线，或已经处在占位段里 → 跳过
      if (isWordChar(before) || isWordChar(after) || before === MARK || after === MARK) return match
      store.push(match)
      changed += 1
      return `${MARK}${store.length - 1}${MARK}`
    })
  }
  out = out.replace(/\u0003(\d+)\u0003/g, (_, index) => `$${store[Number(index)]}$`)
  return { text: out, changed }
}

export function wrapMath(text) {
  if (!text || typeof text !== 'string') return { text, changed: 0 }
  // 按 $...$ 分段：已包好的原样保留，只处理普通段
  const parts = text.split(/(\$[^$]*\$)/g)
  let changed = 0
  const next = parts.map((part) => {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) return part
    const result = wrapSegment(part)
    changed += result.changed
    return result.text
  })
  return { text: next.join(''), changed }
}

// 把「数组/构造序列」这类适合等宽显示的内容包进反引号，面板按代码渲染。
const CODE_RES = [
  // [1,2,3,4]、[3, 9, 6, 1]
  /\[\s*-?\d+(?:\s*,\s*-?\d+){2,}\s*\]/g,
  // 1,2,1,2,3,4,3,4,… 这种构造序列（至少 4 个数）
  /\b-?\d+(?:\s*,\s*-?\d+){3,}(?:\s*,?\s*…)?/g,
  // 空格分隔的数组行：1 2 3 4 5
  /\b-?\d+(?:\s+-?\d+){3,}\b/g,
]

function wrapCode(text) {
  if (!text || typeof text !== 'string') return { text, changed: 0 }
  if (!text.includes('`')) {
    // 没有代码段，直接处理
  }
  const parts = text.split(/(`[^`]*`)/g)
  let changed = 0
  const next = parts.map((part) => {
    if (part.startsWith('`') && part.endsWith('`')) return part
    let out = part
    const store = []
    for (const re of CODE_RES) {
      out = out.replace(re, (match, offset, whole) => {
        const before = whole[offset - 1]
        const after = whole[offset + match.length]
        if (before === MARK || after === MARK || before === '$' || after === '$') return match
        store.push(match)
        changed += 1
        return `${MARK}${store.length - 1}${MARK}`
      })
    }
    out = out.replace(/\u0003(\d+)\u0003/g, (_, index) => '`' + store[Number(index)] + '`')
    return out
  })
  return { text: next.join(''), changed }
}

function fixProblem(problem) {
  let changed = 0
  const fields = ['essence', 'statement', 'solution']
  for (const field of fields) {
    const result = wrapMath(problem[field])
    if (result.changed) {
      problem[field] = result.text
      changed += result.changed
    }
    const code = wrapCode(problem[field])
    if (code.changed) {
      problem[field] = code.text
      changed += code.changed
    }
  }
  for (const insight of problem.insights || []) {
    const result = wrapMath(insight.text)
    if (result.changed) {
      insight.text = result.text
      changed += result.changed
    }
    const code = wrapCode(insight.text)
    if (code.changed) {
      insight.text = code.text
      changed += code.changed
    }
  }
  return changed
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let total = 0
let touched = 0
const samples = []
for (const problem of kb.problems || []) {
  const before = problem.essence || ''
  const changed = fixProblem(problem)
  if (changed) {
    touched += 1
    total += changed
    if (samples.length < 5) samples.push({ key: problem.key, before, after: problem.essence })
  }
}
// 观察句式、节点说明也顺手处理
for (const node of [...(kb.nodes || []), ...(kb.obsNodes || [])]) {
  for (const field of ['summary']) {
    const result = wrapMath(node[field])
    if (result.changed) {
      node[field] = result.text
      total += result.changed
    }
  }
  for (const signal of node.signals || []) {
    void signal
  }
  for (const pattern of node.patterns || []) {
    if (pattern && typeof pattern === 'object' && typeof pattern.text === 'string') {
      const result = wrapMath(pattern.text)
      if (result.changed) {
        pattern.text = result.text
        total += result.changed
      }
    }
  }
}

console.log(`需要修补的题目 ${touched} 道，替换 ${total} 处`)
for (const sample of samples) {
  console.log('\n' + sample.key)
  console.log('  before:', sample.before.slice(0, 140))
  console.log('  after :', sample.after.slice(0, 180))
}

if (WRITE && total > 0) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log(`\n已写回 ${KB_PATH}`)
}
