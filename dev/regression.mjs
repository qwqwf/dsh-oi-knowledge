// 回归测试：覆盖代码审查里的 P0（removeNode reparent / store.mutate 回滚 / 统计过滤）。
import { removeNode } from '../lib/tree.js'
import { KbStore, emptyKb } from '../lib/store.js'
import { collectSolved, collectStruggle } from '../lib/analysis.js'
import { KnowledgeService } from '../lib/service.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let failed = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${extra}`}`)
  if (!ok) failed += 1
}

// ── F-01 removeNode reparent ───────────────────────────────────────────────
{
  const kb = emptyKb()
  kb.nodes = [
    { id: 'p', parent: null, name: 'p' },
    { id: 'x', parent: 'p', name: 'x' },
    { id: 'c1', parent: 'x', name: 'c1' },
    { id: 'c2', parent: 'c1', name: 'c2' },
  ]
  const problem = { id: 'p1', nodes: ['x', 'c1', 'c2'], insights: [{ id: 'i1', nodes: ['c1', 'x'] }] }
  kb.problems = [problem]
  kb.meta.tagMap = { t1: 'x', t2: 'c1' }
  const res = removeNode(kb, kb.nodes[1], 'reparent')
  check('reparent: 子节点改挂到父', kb.nodes.find((n) => n.id === 'c1').parent === 'p')
  check('reparent: 删除节点引用被清', !problem.nodes.includes('x') && !problem.insights[0].nodes.includes('x'))
  check('reparent: 保留子节点引用仍在', problem.nodes.includes('c1') && problem.nodes.includes('c2'))
  check('reparent: tagMap 只清被删节点', !('t1' in kb.meta.tagMap) && kb.meta.tagMap.t2 === 'c1')
  check('reparent: removed=1 / reparented=2', res.removed === 1 && res.reparented === 2, JSON.stringify(res))
}

// ── F-01 subtree ───────────────────────────────────────────────────────────
{
  const kb = emptyKb()
  kb.nodes = [
    { id: 'p', parent: null, name: 'p' },
    { id: 'x', parent: 'p', name: 'x' },
    { id: 'c1', parent: 'x', name: 'c1' },
  ]
  const problem = { id: 'p1', nodes: ['x', 'c1'], insights: [] }
  kb.problems = [problem]
  const res = removeNode(kb, kb.nodes[1], 'subtree')
  check('subtree: 全删且引用清空', kb.nodes.length === 1 && problem.nodes.length === 0 && res.removed === 2)
}

// ── F-02 mutate 回滚 ───────────────────────────────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-kb-reg-'))
  const store = new KbStore({ dir })
  store.load()
  store.mutate((kb) => {
    kb.meta.tagMap.tmp = 'dirty'
  })
  let threw = false
  try {
    store.mutate((kb) => {
      kb.meta.tagMap.half = 'dirty'
      throw new Error('boom')
    })
  } catch (_) {
    threw = true
  }
  check('mutate: 异常抛出', threw)
  // 再写一次，确认半改状态没有落盘
  store.mutate((kb) => {
    kb.meta.tagMap.ok = 'fine'
  })
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'kb.json'), 'utf8'))
  check('mutate: 半改字段没有落盘', !('half' in onDisk.meta.tagMap) && onDisk.meta.tagMap.ok === 'fine')
  fs.rmSync(dir, { recursive: true, force: true })
}

// ── F-03 sample/quiz 不进 solved 统计 ──────────────────────────────────────
{
  const kb = emptyKb()
  kb.problems = [
    { id: 'a', platform: 'codeforces', key: '1A', verdict: 'solved', sample: false, pool: null, tags: [] },
    { id: 'b', platform: 'codeforces', key: '2B', verdict: 'solved', sample: true, pool: null, tags: [] },
    { id: 'c', platform: 'codeforces', key: '3C', verdict: 'solved', sample: false, pool: 'quiz', tags: [] },
    { id: 'd', platform: 'codeforces', key: '4D', verdict: 'unsolved', sample: true, tags: [] },
  ]
  const solved = collectSolved(kb)
  const struggle = collectStruggle(kb)
  check('统计: sample/quiz 不算 solved', solved.length === 1 && solved[0].key === '1A')
  check('统计: sample 不算 struggle', struggle.every((item) => item.key !== '4D'))
}

// ── F-04 洛谷镜像题跨平台桶的计数/删除 ─────────────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-kb-reg-'))
  const store = new KbStore({ dir })
  store.load()
  store.mutate((kb) => {
    kb.accounts = [{ id: 'a1', platform: 'luogu', handle: 'v', lastSyncAt: '2026-01-01T00:00:00.000Z' }]
    kb.solved = {
      luogu: { v: { L1: {} } },
      codeforces: { v: { '1000A': {}, '1000B': {} } },
      atcoder: { v: { abc100_a: {} } },
    }
  })
  const service = new KnowledgeService(store)
  check('账号题量: 跨平台求和', service.listAccounts().summary.includes('已同步 4 题'))
  service.removeAccount({ platform: 'luogu', handle: 'v' })
  const left = store.load()
  check(
    '删账号: 清掉所有平台同名桶',
    !left.solved.codeforces?.v && !left.solved.atcoder?.v && !left.solved.luogu?.v,
  )
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exitCode = failed ? 1 : 0
