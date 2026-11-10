import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const pluginDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const kb = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json'), 'utf8'))
const outDir = path.join(pluginDir, 'dev', 'digest', 'formal')
fs.mkdirSync(outDir, { recursive: true })

const batches = Number(process.argv[2] || 8)
const problems = kb.problems
  .filter((p) => p.pool !== 'quiz')
  .map((p) => ({
    key: p.key,
    title: p.title || '',
    rating: p.rating || null,
    essence: p.essence || '',
    insights: (p.insights || []).map((i) => ({ id: i.id || '', kind: i.kind || '', text: i.text || '' })),
  }))
  .sort((a, b) => (b.rating || 0) - (a.rating || 0))

const per = Math.ceil(problems.length / batches)
let total = 0
for (let i = 0; i < batches; i += 1) {
  const slice = problems.slice(i * per, (i + 1) * per)
  const file = path.join(outDir, `in-${i + 1}.json`)
  fs.writeFileSync(file, JSON.stringify(slice, null, 2), 'utf8')
  total += slice.length
  console.log(`${file}  ${slice.length} problems  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
}
console.log(`total ${total} problems, ${batches} batches`)
