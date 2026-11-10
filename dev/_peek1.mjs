import fs from 'node:fs'
const p = 'dev/digest/formal/part1.json'
const s = fs.readFileSync(p, 'utf8')
try {
  const a = JSON.parse(s)
  console.log('array', a.length, 'keys:', a.slice(0,3).map(x=>x.key).join(','), '...', a.slice(-2).map(x=>x.key).join(','))
} catch (e) { console.log('parse fail:', e.message.slice(0,120), 'len', s.length) }
const in1 = JSON.parse(fs.readFileSync('dev/digest/formal/in-1.json','utf8'))
console.log('in-1 problems:', in1.length)
