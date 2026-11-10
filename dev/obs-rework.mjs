// 观察树反转重做：给每条 pattern 找真实题目证据，≥2 道题才 verified。
// 只改 kb 里 obsNodes[].patterns 的对象形态，题目洞察原样保留。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const dir = path.join(os.homedir(), '.dsh', 'oi-knowledge')
const file = path.join(dir, 'kb.json')
const kb = JSON.parse(fs.readFileSync(file, 'utf8'))
const obsById = new Map((kb.obsNodes || []).map((n) => [n.id, n]))

const STOP = new Set([
  '如果', '那么', '可以', '一个', '这个', '那个', '我们', '需要', '所以', '因为', '就是', '不是', '没有', '所有', '每个',
  '答案', '问题', '观察', '考虑', '情况', '时候', '之后', '之前', '或者', '并且', '显然', '直接', '只需', '一定', '只会',
  '等价', '注意', '证明', '例如', '复杂度', '做法', '实现', '元素', '位置', '操作', '条件', '结论', '性质',
])
const terms = (s) => {
  const out = new Set()
  const re = /[A-Za-z]{2,}|[\u4e00-\u9fa5]{2,}/g
  for (const raw of s.match(re) || []) {
    if (raw.length <= 4 && !STOP.has(raw)) out.add(raw)
    else {
      for (let i = 0; i + 1 < raw.length; i++) {
        const chunk = raw.slice(i, i + 2)
        if (!STOP.has(chunk)) out.add(chunk)
      }
    }
  }
  return out
}
const sharedTerms = (pat, text) => {
  let hit = 0
  for (const term of pat) if (text.includes(term)) hit++
  return hit
}

// 每条 pattern 的证据：同节点 + 共享术语 ≥3 个
const stats = { nodes: 0, patterns: 0, verified: 0, empty: 0 }
const audit = []
const samples = []
for (const node of kb.obsNodes || []) {
  const list = Array.isArray(node.patterns) ? node.patterns : []
  if (!list.length) continue
  stats.nodes++
  const evidence = []
  for (const problem of kb.problems || []) {
    if (problem.sample || problem.pool === 'quiz') continue
    for (const ins of problem.insights || []) {
      if (ins.kind !== 'observation') continue
      if (!(ins.obsNodes || []).includes(node.id)) continue
      evidence.push({ problem, text: ins.text, terms: terms(ins.text) })
    }
  }
  const out = []
  for (const item of list) {
    const text = typeof item === 'string' ? item : item.text
    const pat = terms(text)
    const hits = []
    for (const cand of evidence) {
      if (sharedTerms(pat, cand.text) >= 3) {
        if (!hits.some((h) => h.id === cand.problem.id)) hits.push({ id: cand.problem.id, title: cand.problem.title })
      }
    }
    stats.patterns++
    const verified = hits.length >= 2
    if (verified) stats.verified++
    out.push({ text, examples: hits.slice(0, 5), verified })
    if (!verified) audit.push({ node: node.name, pattern: text })
    else if (samples.length < 4) samples.push({ node: node.name, pattern: text, hits: hits.slice(0, 2) })
  }
  node.patterns = out
  if (!evidence.length) stats.empty++
}
fs.writeFileSync(file, JSON.stringify(kb, null, 2), 'utf8')

const md = []
md.push('# 观察树句式审计', '')
md.push(`- 有句式的节点：${stats.nodes}`)
md.push(`- 句式总数：${stats.patterns}`)
md.push(`- 有 ≥2 题证据：${stats.verified}`)
md.push(`- 无证据：${audit.length}`)
md.push('', '## 无证据句式（已降级，不显示在树统计里）', '')
for (const row of audit.slice(0, 200)) md.push(`- ${row.node}：${row.pattern}`)
fs.mkdirSync(path.join(process.cwd(), 'dev', 'digest'), { recursive: true })
fs.writeFileSync(path.join(process.cwd(), 'dev', 'digest', 'obs-audit.md'), md.join('\n'), 'utf8')
console.log(JSON.stringify(stats))
console.log('audit 写好了')
