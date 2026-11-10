/**
 * 第二轮审查回归：P1-1/P1-2/P1-3/P1-5、P2-1、P2-11。
 * 不联网，全部走临时目录：node dev/regression2.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'

let failures = 0
function check(label, condition, extra = '') {
  if (condition) console.log(`PASS  ${label}`)
  else {
    failures += 1
    console.log(`FAIL  ${label} ${extra}`)
  }
}

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-kb-reg2-'))
  const store = new KbStore({ dir })
  const service = new KnowledgeService(store)
  service.seed()
  return { dir, store, service }
}

// ── P1-2：seed 出来的 patterns 必须是对象 ────────────────────────────────
{
  const { store, service } = fresh()
  const kb = service.kb()
  const withPatterns = kb.obsNodes.filter((node) => (node.patterns || []).length)
  check('P1-2 观察节点有句式', withPatterns.length > 0)
  check(
    'P1-2 句式全部是对象',
    withPatterns.every((node) => node.patterns.every((item) => item && typeof item === 'object' && typeof item.text === 'string')),
  )
  const card = service.trainCard({ kind: 'pattern' })
  check('P1-2 新装即可抽到句式卡', Boolean(card.card && card.card.cardId), JSON.stringify(card).slice(0, 120))
  const node = withPatterns.find((item) => item.parent)
  const nodePath = service.obsPath(service.kb(), node.id)
  const nodeCard = service.trainCard({ kind: 'pattern', node: nodePath })
  check('P1-1 带 node 抽题不抛错', Boolean(nodeCard.card && nodeCard.card.cardId), nodePath)
  store.mutate(() => {})
}

// ── P1-3：损坏的 kb.json 拒绝写盘 ────────────────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-kb-reg2-broken-'))
  fs.writeFileSync(path.join(dir, 'kb.json'), '{"nodes": [', 'utf8')
  const store = new KbStore({ dir })
  const service = new KnowledgeService(store)
  const status = service.status()
  check('P1-3 损坏时可读但不健康', status.healthy === false && String(status.summary).includes('只读保护'))
  let refused = false
  try {
    service.seed()
  } catch (error) {
    refused = /停止写入|损坏/.test(String(error.message))
  }
  check('P1-3 写操作被拒绝', refused)
  check('P1-3 原文件未被覆盖', fs.readFileSync(path.join(dir, 'kb.json'), 'utf8') === '{"nodes": [')
  check('P1-3 备份存在', fs.readdirSync(dir).some((name) => name.startsWith('kb.json.broken-')))
}

// ── P2-1：训练轮次口径统一 ──────────────────────────────────────────────
{
  const { service } = fresh()
  service.addProblem({
    platform: 'atcoder',
    key: 'abc999_a',
    title: 'A. Test',
    verdict: 'unsolved',
    pool: 'quiz',
    statementZh: '给定一个整数 $N$，输出它本身。',
  })
  const r1 = service.trainAttempt({ problem: 'atcoder:abc999_a', text: '第一轮方向' })
  const r2 = service.trainAttempt({ problem: 'atcoder:abc999_a', text: '第二轮方向' })
  const r3 = service.trainAttempt({ problem: 'atcoder:abc999_a', text: '第三轮方向' })
  check('P2-1 前两次轮次 1、2', r1.attempt.round === 1 && r2.attempt.round === 2, `${r1.attempt.round}/${r2.attempt.round}`)
  check('P2-1 第三次被 clamp 到 2', r3.attempt.round === 2, String(r3.attempt.round))
  service.trainJudge({ problem: 'atcoder:abc999_a', text: '第一轮方向', round: 1 })
  const r4 = service.trainAttempt({ problem: 'atcoder:abc999_a', text: '第一轮判完后的第二轮' })
  check('P2-1 判完第一轮后是第 2 轮', r4.attempt.round === 2, String(r4.attempt.round))
  service.trainJudge({ problem: 'atcoder:abc999_a', text: '第二轮方向', round: 2 })
  const r5 = service.trainAttempt({ problem: 'atcoder:abc999_a', text: '两轮判完后的新一题' })
  check('P2-1 两轮判完后重新从 1 开始', r5.attempt.round === 1, String(r5.attempt.round))
}

// ── P2-11 + P1-5：apply_zh 真成功才出队；队列可持久化 ───────────────────
{
  const { dir, store, service } = fresh()
  service.addProblem({
    platform: 'atcoder',
    key: 'abc999_b',
    title: 'B. Test',
    verdict: 'unsolved',
    pool: 'quiz',
    statement: 'Given an integer N, print N.',
  })
  store.mutate((kb) => {
    kb.training.translateQueue = ['atcoder:abc999_b']
  })
  const short = service.applyTranslations({ items: [{ ref: 'atcoder:abc999_b', zh: '太短' }] })
  const kbAfterShort = service.kb()
  check('P2-11 太短不计数', short.applied === 0 && short.rejected.length === 1)
  check('P2-11 太短不出队', (kbAfterShort.training.translateQueue || []).includes('atcoder:abc999_b'))
  const long = service.applyTranslations({
    items: [{ ref: 'atcoder:abc999_b', titleZh: 'B. 测试', zh: '给定一个整数 $N$，输出 $N$ 本身，作为回填校验文本。' }],
  })
  check('P2-11 合格中文写入并出队', long.applied === 1 && (service.kb().training.translateQueue || []).length === 0)
  check('P2-11 题面已写回', service.kb().problems.find((p) => p.key === 'abc999_b').statementZh.includes('输出'))
  // P1-5：重新加载后队列仍在
  store.mutate((kb) => {
    kb.training.translateQueue = ['atcoder:abc999_b']
  })
  const reloaded = new KbStore({ dir })
  check('P1-5 队列落盘后可重载', (reloaded.read().training.translateQueue || []).includes('atcoder:abc999_b'))
}

if (failures) {
  console.log(`\n${failures} FAILED`)
  process.exitCode = 1
} else {
  console.log('\nALL PASS  (regression2)')
}
