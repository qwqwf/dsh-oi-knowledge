// 生成 dev/digest/node-list.md：给「题解消化」子代理用的节点清单（UTF-8）。
// 三棵树：算法（knowledge）、思路（idea）、观察（obs）。观察节点可以写进 insights[].nodes。
import fs from 'node:fs'
import path from 'node:path'
import { KbStore } from '../lib/store.js'

const store = new KbStore()
const kb = store.read()

const byId = new Map(kb.nodes.map((node) => [node.id, node]))
function pathOf(node) {
  const parts = []
  let cur = node
  while (cur) {
    parts.unshift(cur.name)
    cur = cur.parent ? byId.get(cur.parent) : null
  }
  return parts.join('/')
}

const algo = []
const idea = []
for (const node of kb.nodes) {
  const p = pathOf(node)
  if (node.tree === 'idea') idea.push(p)
  else algo.push(p)
}
algo.sort((a, b) => a.localeCompare(b, 'zh'))
idea.sort((a, b) => a.localeCompare(b, 'zh'))

const obsById = new Map(kb.obsNodes.map((node) => [node.id, node]))
function obsPath(node) {
  const parts = []
  let cur = node
  while (cur) {
    parts.unshift(cur.name)
    cur = cur.parent ? obsById.get(cur.parent) : null
  }
  return parts.join('/')
}
const obs = kb.obsNodes
  .filter((node) => node.parent)
  .map((node) => ({ path: obsPath(node), patterns: (node.patterns || []).length }))
  .sort((a, b) => a.path.localeCompare(b.path, 'zh'))

const lines = []
lines.push('# 节点清单（insights[].nodes 只能用这些名字；路径最后一段即可）', '')
lines.push(`共 ${algo.length} 个算法节点、${idea.length} 个思路节点、${obs.length} 个观察节点。`, '')
lines.push('## 算法树（知识节点）', '')
for (const p of algo) lines.push(`- ${p}`)
lines.push('', '## 思路树（套路/思考方向）', '')
for (const p of idea) lines.push(`- ${p}`)
lines.push('', '## 观察树（精髓观察；可直接写进 nodes，会归到 obsNodes）', '')
for (const row of obs) lines.push(`- ${row.path}（${row.patterns} 条句式）`)
lines.push('')

const out = path.join(import.meta.dirname, 'digest', 'node-list.md')
fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf8')
console.log(`wrote ${out}: ${algo.length} algo / ${idea.length} idea / ${obs.length} obs, ${Buffer.byteLength(lines.join('\n'), 'utf8')} bytes`)
