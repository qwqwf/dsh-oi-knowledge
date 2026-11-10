// 把翻译好的中文标题写回 kb.json。
// 用法：node dev\titles-apply.mjs          预览
//       node dev\titles-apply.mjs --write  写回
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = path.resolve('dev', 'titles')
const write = process.argv.includes('--write')
const file = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
}

const wanted = new Map()
for (const name of fs.readdirSync(dir).filter((f) => /^out-\d+\.json$/.test(f)).sort()) {
  const rows = readJson(path.join(dir, name))
  if (!Array.isArray(rows)) {
    console.log(`跳过 ${name}：不是数组`)
    continue
  }
  for (const row of rows) {
    const key = String(row.key || '').trim()
    const titleZh = String(row.titleZh || '').trim()
    if (!key || !titleZh) continue
    wanted.set(key, titleZh)
  }
}

const kb = readJson(file)
let patched = 0
let skipped = 0
for (const problem of kb.problems) {
  const key = `${problem.platform}:${problem.key}`
  const titleZh = wanted.get(key)
  if (!titleZh) continue
  problem.titleZh = titleZh
  problem.updatedAt = new Date().toISOString()
  patched += 1
}

const problems = kb.problems
const formal = problems.filter((p) => p.pool !== 'quiz')
const missingTitleZh = formal.filter((p) => !/[\u4e00-\u9fff]/.test(String(p.titleZh || ''))).length
const missingStatementZh = problems.filter((p) => p.pool !== 'quiz' && !String(p.statementZh || '').trim()).length

console.log(
  `${write ? '写入' : '预览'}：候选 ${wanted.size} 条，命中 ${patched} 道，含英文跳过 ${skipped} 道`,
)
console.log(`正式题 ${formal.length} 道，缺中文标题 ${missingTitleZh} 道，缺中文题面 ${missingStatementZh} 道`)

if (write) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  console.log('已原子写回 kb.json，记得重载插件。')
}
