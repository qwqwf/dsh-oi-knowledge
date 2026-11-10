// 从已消化的题目反推「观察」候选：哪些观察节点有真题撑腰、哪些观察还没有归处。
// 只读 kb.json，输出 dev/digest/obs-candidates.md。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const dir = path.join(os.homedir(), '.dsh', 'oi-knowledge')
const kb = JSON.parse(fs.readFileSync(path.join(dir, 'kb.json'), 'utf8'))
const outDir = path.join(process.cwd(), 'dev', 'digest')
fs.mkdirSync(outDir, { recursive: true })

const obsById = new Map((kb.obsNodes || []).map((n) => [n.id, n]))
const obsName = (id) => obsById.get(id)?.name || id

// 1) 每个观察节点被多少道题真正用到（直接挂载）
const nodeProblems = new Map()
const unassigned = []
for (const p of kb.problems || []) {
  if (p.sample || p.pool === 'quiz') continue
  for (const ins of p.insights || []) {
    if (ins.kind !== 'observation') continue
    const ids = (ins.obsNodes || []).filter((id) => obsById.has(id))
    if (!ids.length) {
      unassigned.push({ text: ins.text, title: p.title, key: p.key, rating: p.rating || 0 })
      continue
    }
    for (const id of new Set(ids)) {
      if (!nodeProblems.has(id)) nodeProblems.set(id, new Set())
      nodeProblems.get(id).add(p.id)
    }
  }
}

const rows = [...nodeProblems.entries()]
  .map(([id, set]) => ({ id, name: obsName(id), count: set.size }))
  .sort((a, b) => b.count - a.count)

// 2) 未挂载的观察做粗聚类（字符 bigram Jaccard），找出反复出现的句式
const bigrams = (s) => {
  const clean = s.replace(/[\s$\\{}_^()（），。、；：！？“”"'’\-+=<>[\]|]/g, '')
  const set = new Set()
  for (let i = 0; i + 1 < clean.length; i++) set.add(clean.slice(i, i + 2))
  return set
}
const jaccard = (a, b) => {
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

const clusters = []
for (const item of unassigned) {
  const grams = bigrams(item.text)
  let best = null
  let bestScore = 0
  for (const c of clusters) {
    const score = jaccard(grams, c.grams)
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  if (best && bestScore >= 0.34) best.items.push(item)
  else clusters.push({ grams, items: [item] })
}
const big = clusters.filter((c) => c.items.length >= 3).sort((a, b) => b.items.length - a.items.length)

const lines = []
lines.push('# 观察候选（从已消化题目反推）', '')
lines.push(`- 正式题：${(kb.problems || []).filter((p) => !p.sample && p.pool !== 'quiz').length} 道`)
lines.push(`- 有归处的观察：${((kb.problems || []).reduce((n, p) => n + (p.sample ? 0 : (p.insights || []).filter((i) => i.kind === 'observation' && (i.obsNodes || []).length).length), 0))} 条`)
lines.push(`- 没有归处的观察：${unassigned.length} 条`, '')
lines.push('## 有真题撑腰的节点（前 25）', '')
for (const r of rows.slice(0, 25)) lines.push(`- ${r.name}：${r.count} 道`)
lines.push('', '## 撑不起来 / 没有题的空节点', '')
const empty = (kb.obsNodes || []).filter((n) => n.parent && !nodeProblems.has(n.id)).map((n) => n.name)
lines.push(empty.length ? empty.map((n) => `- ${n}`).join('\n') : '- （无）')
lines.push('', `## 未归类观察的重复簇（≥3 条，共 ${big.length} 簇）`, '')
for (const c of big.slice(0, 20)) {
  const sample = c.items.slice(0, 3)
  lines.push(`### 簇 ${c.items.length} 条`)
  for (const s of sample) lines.push(`- 《${s.title}》${s.text.slice(0, 140)}`)
  lines.push('')
}
lines.push('## 逐条未归类观察（前 80 条）', '')
for (const s of unassigned.slice(0, 80)) lines.push(`- [${s.rating}]《${s.title}》${s.text.slice(0, 160)}`)

const file = path.join(outDir, 'obs-candidates.md')
fs.writeFileSync(file, lines.join('\n'), 'utf8')
console.log(`写好了：${file}`)
console.log(`节点行数 ${rows.length}，空节点 ${empty.length}，未归类 ${unassigned.length}，重复簇 ${big.length}`)
console.log('前 10 个节点：')
for (const r of rows.slice(0, 10)) console.log(`  ${r.count}  ${r.name}`)
console.log('前 5 个簇：')
for (const c of big.slice(0, 5)) console.log(`  ${c.items.length} 条：《${c.items[0].title}》${c.items[0].text.slice(0, 60)}`)
