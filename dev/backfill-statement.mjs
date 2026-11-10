import fs from 'node:fs'
import path from 'node:path'
import { KbStore } from '../lib/store.js'

const store = new KbStore({})
const kb = store.load()
const force = process.argv.includes('--force')
let filled = 0
let missing = 0
for (const problem of kb.problems) {
  if (!force && String(problem.statement || '').trim().length >= 120) continue
  const file = path.join('dev', 'digest', 'inbox', `${problem.key}.txt`)
  if (!fs.existsSync(file)) {
    missing += 1
    continue
  }
  const text = fs.readFileSync(file, 'utf8')
  let body = ''
  const english = text.indexOf('Problem Statement')
  if (english >= 0) {
    const tail = text.slice(english + 'Problem Statement'.length)
    const stop = tail.search(/\n(Input|Output|Constraints|Score:)/)
    body = (stop > 0 ? tail.slice(0, stop) : tail.slice(0, 1600)).trim()
  }
  if (body.length < 120) {
    const start = text.indexOf('## Statement')
    const end = text.indexOf('## Editorial')
    if (start >= 0) {
      const block = text.slice(start + '## Statement'.length, end > 0 ? end : text.length)
      const englishAt = block.indexOf('Problem Statement')
      body = (englishAt >= 0 ? block.slice(englishAt + 'Problem Statement'.length) : block).trim().slice(0, 1600)
    }
  }
  if (body.length < 120) {
    missing += 1
    continue
  }
  problem.statement = body.replace(/\n{3,}/g, '\n\n')
  problem.updatedAt = new Date().toISOString()
  filled += 1
}
store.write(kb)
console.log('filled', filled, 'missing', missing)
