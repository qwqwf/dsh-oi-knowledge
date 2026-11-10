import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const file = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const kb = JSON.parse(fs.readFileSync(file, 'utf8'))
const fixed = []

function fixText(text) {
  if (!text || typeof text !== 'string') return text
  let out = text
  const before = out
  // 0) explicit leftovers that the generic rules cannot recover
  out = out
    .split('Σ $k\\cdot C(n,k) = n\\cdot 2^(n−1)$；Σ $C(n,k)$² $= C($2n$,n)$')
    .join('$\\sum_k k\\cdot C(n,k)=n\\cdot 2^{n-1}$；$\\sum_k C(n,k)^2=C(2n,n)$')
  out = out
    .split('$((u+v)$/$2, (u−v)$/$2)$')
    .join('$((u+v)/2,(u-v)/2)$')
  // 1) caret + parenthesized exponent inside math: 2^(n−1) / 2^(n
  out = out.replace(/\^\(\s*([^()]*?)\s*\)/g, (m, inner) => `^{${inner.replace(/[−–]/g, '-')}}`)
  // 2) fragment "$A$/$B$" left by earlier wrapping: merge into one formula
  out = out.replace(/\$([^$\n]{1,40})\$\/\$([^$\n]{1,40})\$/g, (m, left, right) => `$${left}/${right}$`)
  // 3) "$2^(n$/$2)$" style leftovers
  out = out.replace(/\$([A-Za-z0-9]+)\^\(([^$\n]{1,20})\$\/\$([^$\n]{1,40})\)/g, (m, base, first, second) => `$${base}^{${first}/${second}}$`)
  if (out !== before) fixed.push({ before, after: out })
  return out
}

for (const node of kb.obsNodes || []) {
  for (const pattern of node.patterns || []) {
    if (typeof pattern === 'string') continue
    pattern.text = fixText(pattern.text)
  }
  node.summary = fixText(node.summary)
}
for (const node of kb.nodes || []) {
  for (const pattern of node.patterns || []) {
    if (typeof pattern === 'string') continue
    pattern.text = fixText(pattern.text)
  }
  node.summary = fixText(node.summary)
}
for (const problem of kb.problems) {
  problem.essence = fixText(problem.essence)
  problem.statement = fixText(problem.statement)
  problem.solution = fixText(problem.solution)
  for (const insight of problem.insights || []) insight.text = fixText(insight.text)
}

console.log('changed fields:', fixed.length)
for (const item of fixed.slice(0, 10)) {
  console.log('--- before:', item.before.slice(0, 160))
  console.log('    after :', item.after.slice(0, 160))
}
if (process.argv.includes('--write')) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2))
  fs.renameSync(tmp, file)
  console.log('written', file)
}
