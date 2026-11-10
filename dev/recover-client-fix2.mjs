import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const pluginDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const repo = path.resolve(pluginDir, '..', 'dsh-oi-knowledge')
const git = 'C:\\Program Files\\Git\\cmd\\git.exe'
const base = execFileSync(git, ['-C', repo, 'show', '0ee73e9:client.js'], { encoding: 'utf8' }).split('\n')
const raw = fs.readFileSync(path.join(pluginDir, 'client.proposed.js'), 'utf8').split('\n')

const isDamaged = (line) => {
  if (/\?[^'"]{0,3}(?=['",)\]])/.test(line) && /[\u4e00-\u9fff]/.test(line)) return true
  // 引号/反引号计数为奇
  const singles = (line.match(/'/g) || []).length
  const doubles = (line.match(/"/g) || []).length
  const ticks = (line.match(/`/g) || []).length
  return singles % 2 === 1 || doubles % 2 === 1 || ticks % 2 === 1
}

function score(a, b) {
  let p = 0
  const max = Math.min(a.length, b.length)
  while (p < max && (a[p] === b[p] || a[p] === '?')) p += 1
  let s = 0
  while (s < max - p && (a[a.length - 1 - s] === b[b.length - 1 - s] || a[a.length - 1 - s] === '?')) s += 1
  return p + s
}

const used = new Set()
const out = []
let replaced = 0
const unresolved = []

for (const line of raw) {
  if (!isDamaged(line)) {
    out.push(line)
    continue
  }
  let best = -1
  let bestScore = 0
  for (let i = 0; i < base.length; i += 1) {
    if (used.has(i)) continue
    const s = score(line, base[i])
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  }
  if (best >= 0 && bestScore >= Math.max(10, line.length * 0.55)) {
    used.add(best)
    out.push(base[best])
    replaced += 1
  } else {
    out.push(line)
    unresolved.push({ line: out.length, text: line.trim().slice(0, 150) })
  }
}

fs.writeFileSync(path.join(pluginDir, 'client.fixed.js'), out.join('\n'), 'utf8')
console.log(JSON.stringify({ lines: raw.length, replaced, unresolved: unresolved.length }, null, 2))
for (const u of unresolved.slice(0, 40)) console.log(u.line + ': ' + u.text)
