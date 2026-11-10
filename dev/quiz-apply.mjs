import fs from 'node:fs'
import path from 'node:path'
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'

const source = path.resolve('dev/digest/out/quiz-b.json')
if (!fs.existsSync(source)) {
  console.error('缺少 dev/digest/out/quiz-b.json')
  process.exit(1)
}
const items = JSON.parse(fs.readFileSync(source, 'utf8'))
const store = new KbStore({})
const service = new KnowledgeService(store)
let written = 0
let skipped = 0
const failed = []
for (const item of items) {
  const kb = service.kb()
  if (kb.problems.some((problem) => problem.key === item.key && problem.platform === 'atcoder')) {
    skipped += 1
    continue
  }
  try {
    const result = service.addProblem({
      platform: 'atcoder',
      key: item.key,
      title: item.title || item.key,
      rating: item.rating,
      verdict: 'unsolved',
      pool: 'quiz',
      statementZh: item.statementZh || '',
      essence: item.essence || '',
      insights: item.insights || [],
    })
    if (!result || result.ok === false) throw new Error(result && result.summary)
    written += 1
  } catch (error) {
    failed.push(`${item.key}: ${error && error.message}`)
  }
}
console.log(`写入 ${written} 道，跳过 ${skipped} 道，失败 ${failed.length} 道`)
for (const line of failed) console.log('-', line)
console.log('别忘了重载插件，让运行中的进程重新读 kb.json。')
