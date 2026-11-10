/**
 * 本地自测：不联网，全部走临时数据目录。
 * 用 DSH 自带 node 跑：node dev/smoke.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'
import { recommendProblems } from '../lib/analysis.js'
import { TAXONOMY } from '../lib/taxonomy.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-kb-smoke-'))
const store = new KbStore({ dir })
const service = new KnowledgeService(store)
let failures = 0

function check(label, condition, extra = '') {
  if (condition) {
    console.log(`PASS  ${label}`)
  } else {
    failures += 1
    console.log(`FAIL  ${label} ${extra}`)
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`)
}

// ── seed ────────────────────────────────────────────────────────────────
section('seed')
const seedResult = service.seed()
const kb0 = service.kb()
console.log(seedResult.summary.split('\n').slice(0, 2).join('\n'))
check('算法树根节点数 = 领域数', kb0.nodes.filter((node) => node.parent === null && node.tree !== 'idea').length === TAXONOMY.filter(([p]) => !p.includes('/')).length)
const allTags = new Set()
for (const [, spec] of TAXONOMY) for (const tag of spec.tags || []) allTags.add(tag)
check('tag 映射覆盖全部内置 tag', Object.keys(kb0.meta.tagMap).length === allTags.size, `${Object.keys(kb0.meta.tagMap).length}/${allTags.size}`)
check('tag 映射到具体节点（非领域节点）', kb0.nodes.find((node) => node.id === kb0.meta.tagMap['brute force'])?.parent !== null)
const seededNodes = kb0.nodes.length
const seedAgain = service.seed()
check('seed 幂等（节点数不变）', service.kb().nodes.length === seededNodes, `${seededNodes} -> ${service.kb().nodes.length}`)
check('第二次 seed 不再新建', seedAgain.created.length === 0, JSON.stringify(seedAgain.created.slice(0, 3)))

const ideaRoot = kb0.nodes.find((node) => node.tree === 'idea' && node.parent === null)
check('思路树根节点存在', Boolean(ideaRoot) && ideaRoot.name === '思路', ideaRoot && ideaRoot.name)
const ideaNodes = kb0.nodes.filter((node) => node.tree === 'idea')
check('思路树至少 40 个节点', ideaNodes.length >= 40, String(ideaNodes.length))
check('思路节点都是 idea 树', ideaNodes.every((node) => node.tree === 'idea'))
const ideaTree = service.tree({ tree: 'idea', depth: 2 })
check('tree tree=idea 输出思路树', ideaTree.summary.includes('思路树'), ideaTree.summary.split('\n')[0])

// ── tree / show ─────────────────────────────────────────────────────────
section('tree')
const tree = service.tree({ depth: 2 })
console.log(tree.summary.split('\n').slice(0, 12).join('\n'))
check('树里有动态规划', tree.summary.includes('动态规划'))

section('show node')
const showGraphs = service.showNode({ node: '图论' })
console.log(showGraphs.summary.split('\n').slice(0, 5).join('\n'))
check('节点含熟练度行', showGraphs.summary.includes('75 分位') && /非常熟练|熟练|还行|不熟练|非常不熟练|空白/.test(showGraphs.summary))

// ── 节点增删改 ───────────────────────────────────────────────────────────
section('node CRUD')
const created = service.addNode({ parent: '动态规划/背包', name: '树上背包', summary: '把子树当物品合并，复杂度 O(n²)。', signals: ['子树内选 k 个点'] })
check('新建节点成功', created.path === '动态规划/背包/树上背包', created.path)
service.updateNode({ node: '树上背包', summary: '合并子树时枚举两边各选多少个。', note: '别忘了先合并再清空临时数组。', mastery: 'weak' })
check('更新节点成功', service.kb().nodes.find((node) => node.name === '树上背包').note.includes('临时数组'))
service.moveNode({ node: '树上背包', parent: '动态规划' })
check('移动节点成功', service.showNode({ node: '树上背包' }).path === '动态规划/树上背包')
service.removeNode({ node: '树上背包' })
check('删除节点成功', !service.kb().nodes.some((node) => node.name === '树上背包'))

// ── 题目 ────────────────────────────────────────────────────────────────
section('add problem')
const p1 = service.addProblem({
  platform: 'codeforces',
  key: '1879D',
  title: 'Sum of XOR Functions',
  rating: 2200,
  tags: ['bitmasks', 'dp', 'math'],
  verdict: 'solved',
  essence: '异或求和先拆位，每一位独立算区间贡献。',
  solution: '按位拆开，每一位统计区间异或为 1 的贡献。',
  insights: [
    { kind: 'observation', text: '把异或按位拆开后，答案变成每一位上「区间异或为 1」的子数组计数。' },
    { kind: '套路', text: '位运算求和题：先拆位，再算每个位置 0/1 的贡献。' },
    { kind: 'direction', text: '遇到 Σf(异或) 先想拆位；遇到计数先想前缀和相减。' },
    { kind: 'trick', text: '把总答案拆成每个元素/每一段的贡献再分别累加。', nodes: ['贡献拆分'] },
  ],
})
console.log(p1.summary)
check('题目已录入', p1.problem.key === '1879D')
check('按 tag 自动挂节点', p1.problem.nodes.length >= 2, JSON.stringify(p1.problem.nodes))
check('洞察数量正确', service.kb().problems[0].insights.length === 4)
check('洞察都有 id', service.kb().problems[0].insights.every((insight) => insight.id.startsWith('i')))
check('精髓已保存', service.kb().problems[0].essence.includes('拆位'), service.kb().problems[0].essence)
const ideaShow = service.showNode({ node: '贡献拆分' })
check('洞察挂上思路节点', ideaShow.summary.includes('贡献拆分'), ideaShow.summary.split('\n').slice(0, 3).join(' | '))
const ideaAnalysis = service.analysis()
const contributionRow = ideaAnalysis.ideaRows.find((row) => row.name === '贡献拆分')
check('思路节点统计到关联题与洞察', contributionRow && contributionRow.insightCount === 1 && contributionRow.linkedProblems === 1,
  contributionRow ? `ins=${contributionRow.insightCount}, linked=${contributionRow.linkedProblems}` : 'missing')
check('ideaTop 有内容', Array.isArray(ideaAnalysis.ideaTop) && ideaAnalysis.ideaTop.length > 0)

section('problem operations')
const addInsight = service.addInsight({ problem: 'codeforces:1879D', kind: '坑点', text: '前缀异或的下标要和原数组错开一位，n=1 时容易越界。' })
console.log(addInsight.summary)
check('新增洞察', service.kb().problems[0].insights.length === 5)
service.updateProblem({ problem: '1879D', patch: { difficulty: 'CF2200', verdict: 'solved' } })
check('更新题目字段', service.kb().problems[0].difficulty === 'CF2200')
const stuck = service.markStuck({ problem: '1879D', stage: 'observe' })
check('记录卡点', service.kb().problems[0].stuckStage === 'observe' && stuck.summary.includes('没找到观察'))
check('卡点进入总览', service.analysis().overview.stuck.observe === 1)
service.markStuck({ problem: '1879D', stage: '' })
check('清除卡点', service.kb().problems[0].stuckStage === null)
const list = service.listProblems({ platform: 'codeforces' })
check('列表过滤', list.total === 1)
const showProblem = service.showProblem({ problem: '1879D' })
check('题目详情含洞察分组', showProblem.summary.includes('### 观察') && showProblem.summary.includes('### 坑点'))

service.addProblem({
  platform: 'atcoder',
  key: 'abc300_f',
  title: 'More Holidays',
  rating: 1800,
  tags: ['binary search', 'prefix sums'],
  verdict: 'attempted',
  insightText: '',
})
check('第二道题录入', service.kb().problems.length === 2)

service.addProblem({
  platform: 'atcoder',
  key: 'abc999_z',
  title: 'Quiz Only Sample',
  rating: 2600,
  verdict: 'unsolved',
  pool: 'quiz',
  essence: '只进未通过出题池',
  insights: [{ kind: 'observation', text: '观察句式只给判分用，不挂知识树。' }],
})
const quizProblem = service.kb().problems.find((problem) => problem.key === 'abc999_z')
check('quiz 不挂知识点', quizProblem && quizProblem.pool === 'quiz' && quizProblem.nodes.length === 0)
check('quiz 不计入总览', service.analysis().overview.manualProblems === 2)
check('quiz 出现在面板数据', service.state().problems.some((problem) => problem.pool === 'quiz'))
service.removeProblem({ problem: 'atcoder:abc999_z' })
check('quiz 可移除', !service.kb().problems.some((problem) => problem.key === 'abc999_z'))

// ── 模拟账号同步 ─────────────────────────────────────────────────────────
section('simulated sync')
service.mutate((kb) => {
  kb.accounts.push({
    id: 'a1',
    platform: 'codeforces',
    handle: 'tester',
    cookie: '',
    createdAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
    lastResult: null,
  })
  const bucket = {}
  const rows = [
    ['1842E', 2400, ['dp', 'data structures']],
    ['1805E', 2400, ['trees', 'data structures']],
    ['1500C', 2200, ['graphs', 'sortings']],
    ['1400E', 2100, ['greedy', 'math']],
    ['1300E', 2000, ['greedy']],
    ['1200E', 2000, ['string suffix structures', 'hashing']],
    ['1100F', 2200, ['data structures', 'bitmasks']],
    ['1000F', 2300, ['dp', 'matrices']],
    ['900F', 1900, ['dfs and similar', 'graphs']],
    ['800F', 1800, ['binary search', 'two pointers']],
    ['700F', 1700, ['brute force', 'implementation']],
    ['600F', 1600, ['math', 'number theory']],
    ['500F', 1500, ['implementation']],
    ['400F', 1500, ['greedy', 'sortings']],
    ['300F', 1400, ['constructive algorithms']],
    ['200F', 1300, ['implementation']],
    ['100F', 1200, ['brute force']],
    ['1900F', 2500, ['dp', 'divide and conquer']],
    ['1700F', 2400, ['graphs', 'shortest paths']],
    ['1600F', 2300, ['combinatorics', 'dp']],
  ]
  for (const [key, rating, tags] of rows) bucket[key] = { key, title: key, rating, tags, url: '' }
  kb.solved.codeforces = { tester: bucket }
})
service.invalidate()
const analysis = service.analysis()
console.log(`覆盖 ${analysis.overview.covered}/${analysis.overview.nodes}，强 ${analysis.overview.strong}，空白 ${analysis.overview.blank}`)
check('同步数据有被分析到', analysis.overview.syncedSolved >= 20, `${analysis.overview.syncedSolved}`)
check('手工录的两道题被计入 solved 索引（1879D 也算）', analysis.solved.some((item) => item.key === '1879D'))

// ── 分析输出 ─────────────────────────────────────────────────────────────
section('report')
const report = service.report({ limit: 8 })
console.log(report.summary.split('\n').slice(0, 20).join('\n'))
check('报告含总览与待补项', report.summary.includes('总览') && report.summary.includes('最该补'))
check('报告含思路树一节', report.summary.includes('思路树'), (report.summary.match(/思路树/g) || []).length + ' 次')
check('报告识别出未分类题', report.summary.includes('未分类') || analysis.unclassified.length === 0)

section('gaps')
const gaps = service.gaps()
console.log(gaps.summary.split('\n').slice(0, 6).join('\n'))
check('gaps 有内容', gaps.summary.includes('tag 覆盖'))

section('recommend')
const fakePool = []
const fakeTags = [...allTags]
for (let i = 0; i < 240; i += 1) {
  const rating = 800 + (i % 16) * 150
  fakePool.push({
    contestId: 1000 + i,
    index: 'A',
    key: `${1000 + i}A`,
    name: `Fake ${i}`,
    rating,
    tags: [fakeTags[i % fakeTags.length], fakeTags[(i * 7 + 3) % fakeTags.length]],
    url: `https://codeforces.com/problemset/problem/${1000 + i}/A`,
  })
}
const rec = recommendProblems(service.kb(), fakePool, { analysis, limit: 5 })
console.log(`targetTags: ${rec.targetTags.join(', ')}`)
console.log(rec.items.map((item) => `${item.key} ${item.rating} ${item.hitTags.join('/')}`).join('\n'))
check('推荐有条目', rec.items.length > 0)
check('推荐不包含已通过的题', rec.items.every((item) => !kb0.solved?.codeforces?.tester?.[item.key]))

// ── 路径解析 ─────────────────────────────────────────────────────────────
section('parse')
const p2 = service.addProblem({ url: 'https://codeforces.com/contest/1900/problem/F', tags: ['dp'], verdict: 'unsolved' })
check('从链接解析平台与题号', p2.problem.platform === 'codeforces' && p2.problem.key === '1900F', `${p2.problem.platform}:${p2.problem.key}`)
const p3 = service.addProblem({ url: 'https://www.luogu.com.cn/problem/P1002', verdict: 'unknown' })
check('洛谷链接解析', p3.problem.platform === 'luogu' && p3.problem.key === 'P1002', `${p3.problem.platform}:${p3.problem.key}`)

// ── 观察树与相似度 ───────────────────────────────────────────────────────
section('observation tree')
const obs = service.obsTree({ depth: 3 })
check('观察树有根', obs.summary.includes('观察树（'))
const obsNodes = service.kb().obsNodes
check('观察树节点数 >= 40', obsNodes.length >= 40, String(obsNodes.length))
check('观察树节点都标 tree=obs', obsNodes.every((node) => node.tree === 'obs'))
check('精髓观察已算出', (service.kb().problems[0].keyObservations || []).length > 0)
const patternTotal = obsNodes.reduce((sum, node) => sum + (node.patterns || []).length, 0)
check('观察句式已写入', patternTotal >= 150, String(patternTotal))
const patternList = service.obsPatterns({ query: '二分' })
check('obs_patterns 可按关键词过滤', patternList.count > 0 && patternList.rows.length > 0, String(patternList.count))
const unassigned = service.obsUnassigned({ limit: 5 })
check('未归类观察可列出', Array.isArray(unassigned.rows) && unassigned.count >= unassigned.rows.length)

section('similarity')
const simPair = service.similar({ a: '1879D', b: 'abc300_f' })
check('相似度有总分与分项', typeof simPair.score === 'number' && simPair.parts && simPair.parts.obs !== undefined)
const ranked = service.similar({ candidates: ['1879D', 'abc300_f'], threshold: 0.35 })
check('候选排序返回阈值与行', ranked.threshold === 0.35 && ranked.rows.length === 2)
check('推荐结果带最近题解释', ranked.rows.every((row) => row.problem && 'minSimilarity' in row))
const rankedDefault = service.similar({ candidates: ['1879D'] })
check('阈值默认 0.3', rankedDefault.threshold === 0.3, String(rankedDefault.threshold))

// ── 持久化 ───────────────────────────────────────────────────────────────
section('persistence')
const store2 = new KbStore({ dir })
const kb2 = store2.read()
check('换实例能读到数据', kb2.nodes.length === service.kb().nodes.length && kb2.problems.length === service.kb().problems.length)
check('没有残留 tmp 文件', !fs.readdirSync(dir).some((name) => name.endsWith('.tmp')))

section('state payload')
const state = service.state()
check('state 有 nodes/problems/accounts', Array.isArray(state.nodes) && Array.isArray(state.problems) && Array.isArray(state.accounts))
check('state 里的问题节点不含 insights 原始数组', state.nodes.every((node) => node.insights === undefined))
check('state 可 JSON 序列化', typeof JSON.stringify(state) === 'string')
check('风险榜/思路榜已瘦身', (state.top || []).every((row) => row.insights === undefined))
check('题目洞察只留展示字段', state.problems.every((problem) => (problem.insights || []).every((insight) =>
  Object.keys(insight).every((key) => ['id', 'kind', 'text', 'nodes', 'obsNodes', 'key'].includes(key)),
)))
check('overview 带观察统计', typeof state.overview.obsUnassigned === 'number' && typeof state.overview.keyObservations === 'number')

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}  (data: ${dir})`)
process.exit(failures === 0 ? 0 : 1)
