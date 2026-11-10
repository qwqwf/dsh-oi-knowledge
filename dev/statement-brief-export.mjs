import fs from 'node:fs'
import path from 'node:path'
import { KbStore } from '../lib/store.js'

const batches = Math.max(1, Number(process.argv[2] || 8))
const store = new KbStore({})
const kb = store.load()
const dir = path.join(process.cwd(), 'dev', 'digest', 'brief')
fs.mkdirSync(dir, { recursive: true })

const problems = (kb.problems || [])
  .filter((problem) => problem.pool !== 'quiz' && problem.essence)
  .map((problem) => ({
    key: problem.key,
    platform: problem.platform,
    title: problem.title || '',
    rating: problem.rating || null,
    statement: String(problem.statement || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
  }))
  .filter((problem) => problem.statement)

const size = Math.ceil(problems.length / batches)
let written = 0
for (let i = 0; i < batches; i += 1) {
  const chunk = problems.slice(i * size, (i + 1) * size)
  if (!chunk.length) continue
  const file = path.join(dir, `in-${i + 1}.json`)
  fs.writeFileSync(file, `${JSON.stringify(chunk, null, 1)}\n`, 'utf8')
  written += chunk.length
  console.log(`in-${i + 1}.json: ${chunk.length} problems, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
}
console.log(`total ${written} problems -> ${dir}`)
