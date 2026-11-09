// 相似度模型自测：用合成数据覆盖「同构题=1」「难度打折」「泛节点降权」「文本兜底」「样例不进基线」「阈值范围」。
import {
  buildObsIndex,
  calibrate,
  compareFeatures,
  nearestProblem,
  problemFeatures,
  rankCandidates,
} from '../lib/similarity.js'

const mkObs = (id, parent, name, aliases = []) => ({ id, parent, name, aliases, patterns: [] })
const obsNodes = [
  mkObs('oRoot', null, '观察'),
  mkObs('oRare', 'oRoot', '稀有观察', ['特别技巧']),
  mkObs('oGeneric', 'oRoot', '泛观察', ['常见词']),
  // 真实观察树里存在的路径，用来测「文本兜底匹配」：观察/结构性质/单调性
  mkObs('oStruct', 'oRoot', '结构性质'),
  mkObs('oMono', 'oStruct', '单调性', ['单调', '随参数单调', '可二分']),
]
const nodes = [
  { id: 'aRoot', parent: null, name: '基础与实现' },
  { id: 'aGreedy', parent: 'aRoot', name: '贪心' },
  { id: 'aDp', parent: 'aRoot', name: '动态规划' },
]

let seq = 0
function problem(opts = {}) {
  seq += 1
  const id = opts.id || `p${seq}`
  const insight = {
    id: `${id}-i1`,
    kind: 'observation',
    text: opts.text || '观察到某种结构',
    nodes: [],
    obsNodes: opts.obsNodes || [],
  }
  return {
    id,
    platform: 'atcoder',
    key: opts.key || id,
    title: opts.title || id,
    url: '',
    rating: opts.rating ?? 2000,
    tags: [],
    verdict: 'solved',
    difficulty: '',
    essence: '',
    nodes: opts.nodes || [],
    keyObservations: [insight.id],
    insights: [insight],
    sample: opts.sample === true,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

// 12 道只用「泛观察」的题，用来把该节点压成高频泛节点。
const fillers = Array.from({ length: 12 }, (_, index) => problem({ obsNodes: ['oGeneric'], text: `常见词 ${index}` }))
const library = [
  problem({ id: 'pRare', obsNodes: ['oRare'], nodes: ['aGreedy'], rating: 2000 }),
  problem({ id: 'pTwin', obsNodes: ['oRare'], nodes: ['aGreedy'], rating: 2000 }),
  problem({ id: 'pHigh', obsNodes: ['oRare'], nodes: ['aGreedy'], rating: 3400 }),
  problem({ id: 'pFar', obsNodes: ['oGeneric'], nodes: [], rating: 2000 }),
  problem({ id: 'pText', text: '关键在于单调性，答案可二分', nodes: ['aGreedy'], rating: 2000 }),
  ...fillers,
]
const kb = { obsNodes, nodes, problems: library }

const obsIndex = buildObsIndex(kb)
const feat = (name) => problemFeatures(kb, kb.problems.find((item) => item.id === name), obsIndex)

const results = []
function check(name, fn) {
  try {
    const detail = fn()
    results.push(`PASS  ${name}${detail ? `（${detail}）` : ''}`)
  } catch (error) {
    results.push(`FAIL  ${name} — ${error.message}`)
    process.exitCode = 1
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message)
}

check('同构题相似度为 1', () => {
  const { score } = compareFeatures(feat('pRare'), feat('pTwin'))
  expect(Math.abs(score - 1) < 1e-9, `score=${score}`)
  return score.toFixed(3)
})

check('互不相干的观察不该被判像', () => {
  const { score, parts } = compareFeatures(feat('pRare'), feat('pFar'))
  expect(score < 0.05, `score=${score}`)
  expect(parts.obs === 0, `obs=${parts.obs}`)
  return score.toFixed(3)
})

check('难度差 1400 分打约六二折', () => {
  const { score, parts } = compareFeatures(feat('pRare'), feat('pHigh'))
  const expected = 1 - 0.4 * Math.min(1, 1400 / 1500)
  expect(Math.abs(parts.level - expected) < 1e-9, `level=${parts.level} 期望 ${expected}`)
  expect(Math.abs(score - expected) < 1e-6, `score=${score}`)
  return `×${parts.level.toFixed(3)}`
})

check('只共享高频泛节点时观察分被压低', () => {
  const { parts } = compareFeatures(feat('pFar'), feat(fillers[0].id))
  expect(parts.obs != null && parts.obs < 0.8, `obs=${parts.obs}`)
  expect(parts.obs > 0.2, `obs=${parts.obs}`)
  return `obs=${parts.obs.toFixed(3)}`
})

check('没写 obsNodes 时用别名兜底匹配（权重打折）', () => {
  const features = feat('pText')
  expect(features.obs.has('oMono'), '没有兜底匹配到「单调性」')
  expect(features.obs.get('oMono') < 1, `权重=${features.obs.get('oMono')}`)
  return `权重=${features.obs.get('oMono').toFixed(2)}`
})

check('nearestProblem 找到同构的那道', () => {
  const best = nearestProblem(kb, kb.problems.find((item) => item.id === 'pTwin'))
  expect(best && best.problem.id === 'pRare', `nearest=${best && best.problem.id}`)
  return best.problem.id
})

check('样例题不进反套路基线', () => {
  const sampleKb = {
    obsNodes,
    nodes,
    problems: [problem({ id: 'sTwin', obsNodes: ['oRare'], nodes: ['aGreedy'], sample: true }), kb.problems.find((item) => item.id === 'pFar')],
  }
  const candidate = problem({ id: 'cand', obsNodes: ['oRare'], nodes: ['aGreedy'], rating: 2000 })
  const ranked = rankCandidates(sampleKb, [candidate], { threshold: 0.3 })
  expect(ranked.rows[0].minSimilarity < 0.05, `minSimilarity=${ranked.rows[0].minSimilarity}`)
  expect(ranked.rows[0].nearest.id === 'pFar', `nearest=${ranked.rows[0].nearest.id}`)
  expect(ranked.rows[0].recommended === true, '低于阈值应推荐')
  return `min=${ranked.rows[0].minSimilarity}`
})

check('校准阈值落在 [0.10, 0.45]', () => {
  const result = calibrate(kb)
  expect(result.recommendedThreshold >= 0.1 && result.recommendedThreshold <= 0.45, `阈值=${result.recommendedThreshold}`)
  expect(result.values.length === kb.problems.length, `样本数=${result.values.length}`)
  return `阈值=${result.recommendedThreshold}`
})

for (const line of results) console.log(line)
console.log(results.every((line) => line.startsWith('PASS')) ? '\nALL PASS' : '\nSOME FAILED')
