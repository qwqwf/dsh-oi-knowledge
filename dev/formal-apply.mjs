import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const pluginDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const formalDir = path.join(pluginDir, 'dev', 'digest', 'formal')
const kbPath = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'))
const byKey = new Map(kb.problems.map((p) => [p.key, p]))

let files = 0
let problems = 0
let essences = 0
let insights = 0
const missing = []
const unknownInsight = []

for (const name of fs.readdirSync(formalDir).filter((n) => /^out-\d+\.json$/.test(n))) {
  const items = JSON.parse(fs.readFileSync(path.join(formalDir, name), 'utf8'))
  files += 1
  for (const item of items) {
    const problem = byKey.get(item.key)
    if (!problem) {
      missing.push(item.key)
      continue
    }
    problems += 1
    if (item.essence && item.essence !== problem.essence) {
      problem.essence = item.essence
      essences += 1
    }
    const byId = new Map((problem.insights || []).map((i) => [i.id, i]))
    for (const next of item.insights || []) {
      const insight = byId.get(next.id)
      if (!insight) {
        unknownInsight.push(`${item.key}#${next.id}`)
        continue
      }
      if (next.text && next.text !== insight.text) {
        insight.text = next.text
        insights += 1
      }
    }
  }
}

const tmp = kbPath + '.tmp'
fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
fs.renameSync(tmp, kbPath)
console.log(JSON.stringify({ files, problems, essences, insights, missing, unknownInsight: unknownInsight.slice(0, 10) }, null, 2))
