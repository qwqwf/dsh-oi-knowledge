import fs from 'node:fs'
import vm from 'node:vm'
const sandbox = { window: {}, document: {} }
vm.runInNewContext(fs.readFileSync('assets/katex/katex.min.js','utf8'), sandbox)
const katex = sandbox.katex || (sandbox.window && sandbox.window.katex)
const files = fs.readdirSync('dev/digest/formal').filter(n => /^out-\d+\.json$/.test(n))
let problems = 0, insights = 0, bad = []
for (const f of files) {
  const arr = JSON.parse(fs.readFileSync('dev/digest/formal/' + f, 'utf8'))
  for (const item of arr) {
    problems++
    const texts = [{where: item.key + ':essence', t: item.essence}]
    for (const ins of item.insights || []) { insights++; texts.push({where: item.key + ':' + ins.id, t: ins.text}) }
    for (const {where, t} of texts) {
      const segs = String(t).split('$')
      if (segs.length % 2 === 0) { bad.push(where + ' unbalanced $'); continue }
      for (let i = 1; i < segs.length; i += 2) {
        try { katex.renderToString(segs[i], { throwOnError: true, strict: 'ignore' }) }
        catch (e) { bad.push(where + ' :: ' + segs[i].slice(0, 40) + ' :: ' + e.message.slice(0, 60)) }
      }
    }
  }
}
console.log(JSON.stringify({files: files.length, problems, insights, bad: bad.length, sample: bad.slice(0, 5)}, null, 2))
