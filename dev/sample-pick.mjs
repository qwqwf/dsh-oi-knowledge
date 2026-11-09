/**
 * 随机抽一批「账号没做过」的 AtCoder 题，作为反套路推荐的候选。
 * 用法：node dev/sample-pick.mjs --count 5 --min 2600 --max 3400
 * 只打印题号，不写任何文件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const CACHE = path.join(ROOT, 'dev', 'digest', 'atcoder-resources.json')
const KB_FILE = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const count = Number(arg('count', 5))
const minRating = Number(arg('min', 2600))
const maxRating = Number(arg('max', 3400))

if (!fs.existsSync(CACHE)) {
  console.error('缺少 dev/digest/atcoder-resources.json，先跑一次 atcoder-digest-fetch.mjs --stats')
  process.exit(1)
}
if (!fs.existsSync(KB_FILE)) {
  console.error('缺少 kb.json，先初始化知识库')
  process.exit(1)
}

const resources = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
const kb = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'))

const known = new Set()
for (const problem of kb.problems || []) {
  if (problem.platform === 'atcoder') known.add(problem.key)
}
for (const handles of Object.values(kb.solved?.atcoder || {})) {
  for (const key of Object.keys(handles)) known.add(key)
}

const pool = resources.problems.filter(
  (item) =>
    item.difficulty != null &&
    item.difficulty >= minRating &&
    item.difficulty <= maxRating &&
    !known.has(item.id) &&
    !item.id.startsWith('_'),
)

for (let i = pool.length - 1; i > 0; i -= 1) {
  const j = Math.floor(Math.random() * (i + 1))
  ;[pool[i], pool[j]] = [pool[j], pool[i]]
}

const picked = pool.slice(0, Math.max(1, count))
console.log(picked.map((item) => item.id).join(' '))
console.error(`从 ${pool.length} 道未做过的题里抽了 ${picked.length} 道：${picked.map((item) => `${item.id}(${item.difficulty})`).join(', ')}`)
