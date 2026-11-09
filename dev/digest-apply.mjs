/**
 * 把模型产出的题解摘要写回知识库。
 *
 * 输入：dev/digest/out/*.json（每个文件是数组）
 *   [{ key, title?, rating?, essence, insights: [{ kind, text, nodes? }] }]
 *
 * 写入走 KnowledgeService（与插件同一套校验）；已存在的题跳过，
 * 跑完需要重载插件（plugin_manager set_plugin ...）让运行中的进程重新读盘。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_DIR = path.join(ROOT, 'dev', 'digest', 'out')
const DATA_DIR = process.env.OI_KB_DIR || path.join(os.homedir(), '.dsh', 'oi-knowledge')

function loadFiles() {
  if (!fs.existsSync(OUT_DIR)) return []
  return fs
    .readdirSync(OUT_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, data: JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8')) }))
}

function main() {
  const store = new KbStore({ dir: DATA_DIR })
  const service = new KnowledgeService(store)
  let added = 0
  let skipped = 0
  let failed = 0
  const seen = new Set()
  for (const file of loadFiles()) {
    const items = Array.isArray(file.data) ? file.data : file.data?.items || []
    for (const item of items) {
      const key = String(item.key || '').trim()
      if (key === '') continue
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const result = service.addProblem({
          platform: 'atcoder',
          key,
          title: item.title,
          rating: item.rating,
          url: `https://atcoder.jp/contests/${key.slice(0, key.indexOf('_'))}/tasks/${key}`,
          verdict: 'solved',
          essence: item.essence,
          insights: item.insights || [],
        })
        added += 1
        console.log(`✓ ${key} ${result.problem.insights} 条洞察 · ${result.problem.nodes.length} 个节点`)
      } catch (error) {
        const message = String(error?.message || error)
        if (message.includes('已经在库里')) {
          skipped += 1
          console.log(`- ${key} 已存在，跳过`)
        } else {
          failed += 1
          console.log(`✗ ${key} ${message}`)
        }
      }
    }
  }
  console.log(`\n写入 ${added} 道，跳过 ${skipped} 道，失败 ${failed} 道。`)
  console.log('别忘了重载插件，让运行中的进程重新读 kb.json。')
}

main()
