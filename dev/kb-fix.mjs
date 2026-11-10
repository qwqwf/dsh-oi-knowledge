// 定点修复库里已知的坏公式：占位符残留、\log 粘连、\{t} 未转义右侧。
// 用法：node dev/kb-fix.mjs [--write]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const KB_PATH = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const WRITE = process.argv.includes('--write')
const MARK = '\u0003'

const fixes = [
  // [problemKey, insightId 或 'essence', 旧串, 新串]
  ['abc226_h', 'i3v', `$O(${MARK}0${MARK})$ 降到 $O(${MARK}1${MARK})$`, '$O(N^2)$ 降到 $O(N)$'],
  ['agc030_e', 'essence', `$O(${MARK}0${MARK})$`, '$O(N^2)$'],
  ['agc030_e', 'i1ze', `$O(${MARK}0${MARK})$`, '$O(N^2)$'],
  ['agc031_e', 'essence', `$O(${MARK}2${MARK})$`, '$O(N\\cdot\\mathrm{flow})$'],
  ['agc036_f', 'essence', `$O(${MARK}6${MARK})$ 一次算完所有 k，总 $O(${MARK}7${MARK})$`, '$O(N^2)$ 一次算完所有 k，总 $O(N^3)$'],
  ['agc036_f', 'i1zw', `$O(${MARK}1${MARK})$ 一次得到所有 k 的答案`, '$O(N^2)$ 一次得到所有 k 的答案'],
  ['agc045_c', 'essence', `$O(${MARK}0${MARK})$，答案 = $2^N$`, '$O(N\\cdot B)$，答案 = $2^N$'],
  ['agc045_c', 'i208', `整体 $O(${MARK}0${MARK})$`, '整体 $O(N\\cdot B)$'],
  ['agc028_b', 'ik9', '$\\text{$j$ 被计入的次数}$', '$\\text{j 被计入的次数}$'],
]

const generic = [
  // \logN -> \log N（只处理数学段）
  [/\\log(?=[A-Za-z])/g, '\\log '],
  // \{t} -> \{t\}（右侧未转义的花括号）
  [/\\\{([^{}$\\]{1,24})\}/g, (m, body) => `\\{${body}\\}`],
]

function splitMath(text) {
  const parts = text.split(/(\$[^$]*\$)/g)
  return parts.map((part) => {
    let out = part
    for (const [re, rep] of generic) out = out.replace(re, rep)
    return out
  }).join('')
}

const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
let hits = 0
for (const problem of kb.problems || []) {
  for (const [key, target, from, to] of fixes) {
    if (problem.key !== key) continue
    if (target === 'essence') {
      if ((problem.essence || '').includes(from)) {
        problem.essence = problem.essence.replace(from, to)
        hits += 1
        console.log(`fixed ${key} essence`)
      }
    } else {
      for (const insight of problem.insights || []) {
        if (insight.id === target && (insight.text || '').includes(from)) {
          insight.text = insight.text.replace(from, to)
          hits += 1
          console.log(`fixed ${key} ${target}`)
        }
      }
    }
  }
}

// 观察句式里的占位符
for (const node of kb.obsNodes || []) {
  for (const pattern of node.patterns || []) {
    if (pattern && typeof pattern === 'object' && typeof pattern.text === 'string' && pattern.text.includes(MARK)) {
      pattern.text = pattern.text.replace(/O\(n·\u00032\u0003\)/, '$O(n\\cdot 2^n)$')
      if (!pattern.text.includes(MARK)) hits += 1
    }
  }
}

// 全库兜底：数学段做通用修复 + 清掉残留占位符
const leftovers = []
function repair(where, text) {
  if (typeof text !== 'string' || !text) return text
  let out = splitMath(text)
  const before = out
  out = out.replace(/[\u0003]\d*[\u0003]?/g, '')
  if (out !== before) leftovers.push(where)
  return out
}
for (const problem of kb.problems || []) {
  problem.essence = repair(`${problem.key} essence`, problem.essence)
  problem.statement = repair(`${problem.key} statement`, problem.statement)
  problem.solution = repair(`${problem.key} solution`, problem.solution)
  for (const insight of problem.insights || []) insight.text = repair(`${problem.key}#${insight.id}`, insight.text)
}
for (const node of [...(kb.nodes || []), ...(kb.obsNodes || [])]) {
  node.summary = repair(`${node.name} summary`, node.summary)
  for (const pattern of node.patterns || []) {
    if (pattern && typeof pattern === 'object') pattern.text = repair(`${node.name} pattern`, pattern.text)
  }
}

console.log(`定点修复 ${hits} 处；兜底清理 ${leftovers.length} 段`, leftovers.slice(0, 10))
if (WRITE) {
  const tmp = `${KB_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, KB_PATH)
  console.log('已写回')
}
