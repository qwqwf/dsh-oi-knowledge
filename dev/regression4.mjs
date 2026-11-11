// 三级提示阶梯的回归用例（不联网、临时目录，不碰真实 kb.json）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'
import { setHostGenerate } from '../lib/sync.js'

let failed = 0
let passed = 0
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-knowledge-r4-'))
const store = new KbStore({ dir })
const service = new KnowledgeService(store)
service.seed()

const longStatement =
  '给定一个长度为 $N$ 的数组 $A$。每次操作可以选择一个下标 $i$，把 $A_i$ 和 $A_{i+1}$ 同时加一或同时减一。' +
  '问最少多少次操作可以让所有元素相等。$2 \\le N \\le 2 \\times 10^5$，$|A_i| \\le 10^9$。'
service.addProblem({
  platform: 'atcoder',
  key: 'abc999_z',
  title: 'Hint Ladder Test',
  rating: 2400,
  pool: 'quiz',
  verdict: 'unsolved',
  statement: longStatement,
  essence: '差分数组只有 $N-1$ 个位置会变，答案是差分前缀和的正负号切换次数。',
  insights: [
    { kind: 'observation', text: '一次操作同时改两个相邻元素，等价于在差分数组上单点修改。' },
    { kind: 'direction', text: '把操作换到差分上，再看目标状态对差分的要求。' },
  ],
})

setHostGenerate(async () => [
  'L1：看相邻元素的差。',
  'L2：把一次操作换成差分数组上的加减。',
  'L3：答案只和差分前缀和的正负号变化有关。',
].join('\n'))

console.log('\n[提示] 逐级解锁')
const first = await service.hintProblem({ platform: 'atcoder', key: 'abc999_z', level: 1 })
check('L1 生成并解锁', first.unlocked === 1 && Boolean(first.hints.l1), JSON.stringify(first).slice(0, 160))
check('L1 不泄露 L2/L3', !first.hints.l2 && !first.hints.l3)
const second = await service.hintProblem({ platform: 'atcoder', key: 'abc999_z', level: 2 })
check('L2 解锁后带 L1+L2', second.unlocked === 2 && Boolean(second.hints.l1) && Boolean(second.hints.l2))
check('L2 仍不泄露 L3', !second.hints.l3)
const third = await service.hintProblem({ platform: 'atcoder', key: 'abc999_z', level: 3 })
check('L3 解锁后三级齐全', third.unlocked === 3 && Boolean(third.hints.l1) && Boolean(third.hints.l2) && Boolean(third.hints.l3))
const reread = await service.hintProblem({ platform: 'atcoder', key: 'abc999_z', level: 0 })
check('level=0 只读已解锁内容，不降级', reread.unlocked === 3 && Boolean(reread.hints.l3))
const saved = store.load()
check('解锁级别落盘', saved.training.hintUnlocks['atcoder:abc999_z'] === 3)
check('提示文本缓存落盘', Boolean(saved.training.hints['atcoder:abc999_z'] && saved.training.hints['atcoder:abc999_z'].l3))

console.log('\n[提示] 结果记录与零提示通过率')
service.recordHintOutcome({ platform: 'atcoder', key: 'abc999_z', outcome: 'hinted' })
const stats1 = service.hintStats()
check('记录一条看提示做出', stats1.total === 1 && stats1.hinted === 1)
check('看提示不计入零提示通过', stats1.soloZero === 0 && stats1.zeroHintRate === 0)

const soloDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-knowledge-r4b-'))
const soloStore = new KbStore({ dir: soloDir })
const soloService = new KnowledgeService(soloStore)
soloService.seed()
soloService.addProblem({ platform: 'atcoder', key: 'abc999_y', title: 'Solo', rating: 2400, pool: 'quiz', verdict: 'unsolved', statement: longStatement })
soloService.recordHintOutcome({ platform: 'atcoder', key: 'abc999_y', outcome: 'solo' })
const stats2 = soloService.hintStats()
check('零提示独立做出计入通过率', stats2.soloZero === 1 && stats2.zeroHintRate === 100)

console.log('\n[提示] 校验与异常')
let threw = ''
try {
  service.recordHintOutcome({ platform: 'atcoder', key: 'abc999_z', outcome: 'maybe' })
} catch (error) {
  threw = String(error && error.message ? error.message : error)
}
check('outcome 非法时报错', threw.includes('solo'))

console.log(`\n${failed ? `${failed} 项失败` : 'ALL PASS'}  (${passed} 项通过)`)
if (failed) process.exitCode = 1
