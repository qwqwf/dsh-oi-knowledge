// 第三轮代码审查的回归用例（不联网、临时目录，不碰真实 kb.json）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-knowledge-r3-'))
const store = new KbStore({ dir })
const service = new KnowledgeService(store)
service.seed()

console.log('\n[P1-1] 判定失败后重试不得吞掉第 2 轮')
const quiz = service.addProblem({
  platform: 'codeforces',
  key: '1000A',
  title: 'Retry Test',
  rating: 1500,
  pool: 'quiz',
  verdict: 'unsolved',
  essence: '用前缀和把区间查询降成 O(1)。',
  insights: [
    { kind: 'observation', text: '区间贡献可以拆到端点上。' },
    { kind: 'direction', text: '先看答案对什么单调，再决定二分还是双指针。' },
  ],
})
const quizKey = quiz.problem.key
service.trainAttempt({ problem: quizKey, text: '完全不相关的废话。', ms: 1000 })
const judge1 = service.trainJudge({ problem: quizKey, text: '完全不相关的废话。', round: 1 })
check('第一轮未命中不揭示', judge1.revealed === false, JSON.stringify(judge1).slice(0, 120))
const attemptsAfter1 = store.load().training.attempts.filter((item) => item.problemKey === quizKey).length
service.trainJudge({ problem: quizKey, text: '完全不相关的废话。', round: 1 })
const attemptsAfter2 = store.load().training.attempts.filter((item) => item.problemKey === quizKey).length
check('重试判定不新增 attempt', attemptsAfter1 === attemptsAfter2, `${attemptsAfter1} → ${attemptsAfter2}`)
const judge2 = service.trainJudge({ problem: quizKey, text: '完全不相关的废话。', round: 2 })
check('显式第二轮才揭示', judge2.revealed === true)
check('未判分的 attempt 仍在（不丢记录）', attemptsAfter2 >= 1)

console.log('\n[P1-3] 没有陌生候选时不硬推，分位方向正确')
const sharedNode = store.load().nodes.find((node) => node.name.includes('贪心'))
if (!sharedNode) throw new Error('seed 里找不到「贪心」节点，测试无法覆盖 P1-3')
service.addProblem({
  platform: 'codeforces',
  key: '1000D',
  title: 'Baseline',
  rating: 1500,
  verdict: 'solved',
  essence: '用前缀和把区间查询降成 O(1)。',
  insights: [
    { kind: 'observation', text: '区间贡献可以拆到端点上。', nodes: [sharedNode.name] },
  ],
})
const twin = service.addProblem({
  platform: 'codeforces',
  key: '1000B',
  title: 'Twin',
  rating: 1500,
  verdict: 'solved',
  essence: '用前缀和把区间查询降成 O(1)。',
  insights: [
    { kind: 'observation', text: '区间贡献可以拆到端点上。', nodes: [sharedNode.name] },
  ],
})
const novel = service.recommendNovel({ candidates: [twin.problem.id], threshold: 0.1 })
check('相似度高于阈值时不输出「最终推荐」', !String(novel.summary).includes('最终推荐'))
check('percentile 为 null', novel.percentile === null)
check('仍保留「都不算陌生」的结论', String(novel.summary).includes('都不算陌生'))

console.log('\n[P2-6/P2-7] 数值入参与中文门槛')
const emptyRating = service.addProblem({
  platform: 'codeforces',
  key: '1000C',
  title: 'Empty Rating',
  rating: '',
  verdict: 'unsolved',
})
const emptyRatingStored = store.load().problems.find((item) => item.key === '1000C')
check(
  'rating 空串存成 null 而不是 0',
  emptyRatingStored && emptyRatingStored.rating === null,
  String(emptyRatingStored && emptyRatingStored.rating),
)

console.log('\n[P2-4] findAccount 不再用空 handle 通配')
service.addAccount({ platform: 'codeforces', handle: 'QwQwf' })
const kbNow = store.load()
check('空 handle 不匹配账号', service.findAccount(kbNow, 'codeforces', '') === null)
check('显式 allowEmpty 才允许', service.findAccount(kbNow, 'codeforces', '', { allowEmpty: true })?.handle === 'QwQwf')

console.log('\n[P2-8] trainReview 默认轮次与 trainJudge 同口径')
const reviewKey = quizKey
const review = service.trainReview({ problem: reviewKey, hit: true })
check('人工复核命中时按待判轮次揭示', review.revealed === true, JSON.stringify(review).slice(0, 120))

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}：${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
