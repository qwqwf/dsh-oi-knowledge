import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const kbPath = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'))
let n = 0
for (const node of kb.nodes || []) {
  if (node.summary && node.summary.includes('这题能不能做')) { node.summary = node.summary.replace('往往决定这题能不能做。', '往往决定解法走向。'); n++ }
}
for (const node of kb.obsNodes || []) {
  for (const pat of node.patterns || []) {
    if (typeof pat !== 'object' || !pat.text) continue
    if (pat.text.includes('期望 = Σ 取值')) { pat.text = '期望$=\\sum_x x\\cdot P(X=x)$，即各取值按方案数加权。'; n++ }
    if (pat.text.includes('只需分别看 $x$ 和 $y$ 方向的极差') && pat.text.includes('⇒')) {
      pat.text = '距离为$\\max(|\\Delta x|,|\\Delta y|)$时旋转$45^\\circ$化为曼哈顿距离，分别看两方向极差。'; n++
    }
  }
}
const tmp = kbPath + '.tmp'
fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
fs.renameSync(tmp, kbPath)
console.log('patched', n)
