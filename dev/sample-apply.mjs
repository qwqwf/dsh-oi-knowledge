/**
 * 把「反套路推荐」候选题的消化结果写进库，标记 sample=true：
 * 它们只作为候选项参与相似度比较，不进基线、不进统计。
 *
 * 输入：dev/digest/out/sample-*.json（数组，格式同 batch-*.json）
 * 用法：node dev/sample-apply.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_DIR = path.join(ROOT, 'dev', 'digest', 'out')
const DATA_DIR = process.env.OI_KB_DIR || path.join(os.homedir(), '.dsh', 'oi-knowledge')

const store = new KbStore({ dir: DATA_DIR })
const service = new KnowledgeService(store)

const files = fs.existsSync(OUT_DIR)
  ? fs.readdirSync(OUT_DIR).filter((name) => /^sample-.*\.json$/.test(name)).sort()
  : []

let added = 0
let skipped = 0
let failed = 0
for (const name of files) {
  const data = JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8'))
  const items = Array.isArray(data) ? data : data?.items || []
  for (const item of items) {
    const key = String(item.key || '').trim()
    if (!key) continue
    const contest = key.slice(0, key.indexOf('_'))
    try {
      service.addProblem({
        platform: 'atcoder',
        key,
        title: item.title,
        rating: item.rating,
        url: `https://atcoder.jp/contests/${contest}/tasks/${key}`,
        verdict: 'unsolved',
        essence: item.essence,
        insights: item.insights || [],
        sample: true,
      })
      added += 1
      console.log(`✓ ${key}（候选）`)
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
console.log(`\n候选写入 ${added} 道，跳过 ${skipped} 道，失败 ${failed} 道。`)
console.log('别忘了重载插件，让运行中的进程重新读 kb.json。')
