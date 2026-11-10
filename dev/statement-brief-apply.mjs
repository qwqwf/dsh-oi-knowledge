import fs from 'node:fs'
import path from 'node:path'
import { KbStore } from '../lib/store.js'

const store = new KbStore({})
const dir = path.join(process.cwd(), 'dev', 'digest', 'brief')
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((name) => /^out-\d+\.json$/.test(name)).sort()
  : []
if (!files.length) {
  console.log('no out-*.json found in', dir)
  process.exit(0)
}

const entries = []
for (const name of files) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
  for (const row of rows) {
    if (!row || !row.key || !row.zh) continue
    entries.push({ key: String(row.key).trim(), zh: String(row.zh).trim() })
  }
}
console.log(`files ${files.length}, entries ${entries.length}`)

let applied = 0
let missing = 0
const result = store.mutate((kb) => {
  const byKey = new Map((kb.problems || []).map((problem) => [problem.key, problem]))
  for (const entry of entries) {
    const problem = byKey.get(entry.key)
    if (!problem) {
      missing += 1
      continue
    }
    if (problem.statementZh !== entry.zh) {
      problem.statementZh = entry.zh
      problem.updatedAt = new Date().toISOString()
      applied += 1
    }
  }
  return kb
})
console.log(`applied ${applied}, missing ${missing}, revision ${result.revision}`)
console.log('reload the plugin to pick up the new brief statements')
