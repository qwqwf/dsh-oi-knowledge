import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const pluginDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const corruptedPath = path.join(pluginDir, 'client.js')
const repo = path.resolve(pluginDir, '..', 'dsh-oi-knowledge')
const git = 'C:\\Program Files\\Git\\cmd\\git.exe'

const corrupted = fs.readFileSync(corruptedPath, 'utf8')
const base = execFileSync(git, ['-C', repo, 'show', '0ee73e9:client.js'], { encoding: 'utf8' })

const REPL = '\uFFFD'
const corruptedLines = corrupted.split('\n')
const baseLines = base.split('\n')

function score(a, b) {
  if (!a || !b) return -1
  let p = 0
  const max = Math.min(a.length, b.length)
  while (p < max && a[p] === b[p]) p += 1
  let s = 0
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1
  return p + s
}

const used = new Set()
let replaced = 0
const failures = []
const out = []

for (const line of corruptedLines) {
  if (!line.includes(REPL)) {
    out.push(line)
    continue
  }
  // 注释行：直接把替换字符删掉即可（不影响语法）
  const trimmed = line.trim()
  if (/^\s*(\/\/|\/\*|\*|\*\/)/.test(trimmed)) {
    out.push(line.split(REPL).join(''))
    replaced += 1
    continue
  }
  // 代码/字符串行：在基线里找最相似的一行
  let best = -1
  let bestScore = 0
  for (let i = 0; i < baseLines.length; i += 1) {
    if (used.has(i)) continue
    const s = score(line.replace(new RegExp(REPL, 'g'), '\u0000'), baseLines[i])
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  }
  const lineLen = line.length
  if (best >= 0 && bestScore >= Math.max(12, lineLen * 0.55)) {
    used.add(best)
    out.push(baseLines[best])
    replaced += 1
  } else {
    out.push(line.split(REPL).join(''))
    failures.push({ line: out.length, text: trimmed.slice(0, 160) })
  }
}

const proposedPath = path.join(pluginDir, 'client.proposed.js')
fs.writeFileSync(proposedPath, out.join('\n'), 'utf8')
console.log(JSON.stringify({ total: corruptedLines.length, replaced, failures: failures.length }, null, 2))
if (failures.length) {
  console.log('--- unresolved lines ---')
  for (const f of failures.slice(0, 60)) console.log(f.line + ': ' + f.text)
}
