import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'
import { setHostGenerate, setHostTranslate } from '../lib/sync.js'

let passed = 0
let failed = 0
function check(name, ok, extra) {
  if (ok) {
    passed += 1
    console.log('  ok  ', name)
  } else {
    failed += 1
    console.log('  FAIL', name, extra === undefined ? '' : extra)
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-knowledge-r5-'))
const store = new KbStore({ dir })
const service = new KnowledgeService(store)
service.seed()

const englishStatement =
  'You are given an array A of N integers. In one operation you may choose an index i and increase A_i by one. ' +
  'Find the minimum number of operations needed to make all adjacent differences equal. The answer may be large, so output it modulo 998244353.'
const solution = 'Let d_i = A_{i+1} - A_i. The answer only depends on the number of negative and positive differences.'

setHostTranslate(async (text) => {
  if (!text) return ''
  return '给定一个长度为 $N$ 的整数序列，每次可以把一个数加一，求让所有相邻差相等的最少操作次数。'
})
setHostGenerate(async () => [
  '精髓：答案只与相邻两项的差分有关，把差分统一到同一个值即可。',
  '观察：所有相邻差最终都相等，等价于差分数组只有一种非零值。',
  '套路：把区间操作转成差分数组上的单点修改。',
  '思路：先算出每个位置的差分，再分别统计正负差的数量。',
  '方向：看到「相邻差」先写差分，再看操作在差分上长什么样。',
  '坑点：差分可以为负，统计时不要漏掉负方向。',
].join('\n'))

const created = await service.digestProblem({
  platform: 'atcoder',
  key: 'abc999_q',
  title: 'Adjacent Differences',
  rating: 2400,
  statement: englishStatement,
  solution,
})

check('录入后题目存在', Boolean(created.problem && created.problem.id))
const saved = store.load()
const problem = saved.problems.find((item) => item.platform === 'atcoder' && item.key === 'abc999_q')
check('题目按 solved 入库', Boolean(problem) && problem.verdict === 'solved')
check('题面与题解都保存', Boolean(problem) && problem.statement.length > 100 && problem.solution.length > 20)
check('精髓已写入', Boolean(problem) && problem.essence.includes('差分'))
check('洞察至少 2 条', Boolean(problem) && problem.insights.length >= 2)
check('洞察类型齐全', Boolean(problem) && problem.insights.some((i) => i.kind === 'observation') && problem.insights.some((i) => i.kind === 'direction'))
check('洞察带 id', Boolean(problem) && problem.insights.every((i) => Boolean(i.id)))
check('英文题面自动补中文题意', Boolean(problem) && problem.statementZh.length >= 40)
check('洞察挂到知识点/思路/观察', Boolean(problem) && problem.insights.some((i) => (i.nodes || []).length > 0 || (i.obsNodes || []).length > 0) && problem.nodes.length > 0)

let duplicate = ''
try {
  await service.digestProblem({ platform: 'atcoder', key: 'abc999_q', title: 'x', statement: englishStatement })
} catch (error) {
  duplicate = String(error && error.message ? error.message : error)
}
check('重复录入会被拒绝', duplicate.includes('已经在库里'))

let tooShort = ''
try {
  await service.digestProblem({ platform: 'other', key: 'tiny', statement: 'short' })
} catch (error) {
  tooShort = String(error && error.message ? error.message : error)
}
check('题面太短时明确报错', tooShort.includes('题面太短') || tooShort.includes('题面'))

setHostTranslate(async () => '')
setHostGenerate(async () => '')
let noModel = ''
try {
  await service.digestProblem({
    platform: 'other',
    key: 'no-model',
    statement: englishStatement,
    solution,
  })
} catch (error) {
  noModel = String(error && error.message ? error.message : error)
}
check('模型没返回时给出原因', noModel.includes('精髓没提炼出来'))

console.log(`\n${failed ? `${failed} 项失败` : 'ALL PASS'}  (${passed} 项通过)`)
if (failed) process.exitCode = 1
