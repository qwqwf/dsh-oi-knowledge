/**
 * 题目相似度：只比"想法"，不比题面文字。
 *
 * 三个层面（权重可调）：
 *   1. obs   精髓观察 —— 每题 keyObservations 里那些观察洞察挂到的观察树节点（按树深度加权）
 *   2. other 其他洞察 —— trick / idea / direction / pitfall 挂到的思路/算法节点
 *   3. algo  算法节点 —— 题目直接挂的算法知识点
 *
 * 相似度是对应层面的（加权）Jaccard：交集 / 并集。
 * 题面、题解原文不参与计算——同样的做法换个背景故事，应该被算作"很像"。
 *
 * 两个防"虚高"的处理：
 *   - 观察节点按"稀有度"（IDF）打折：像「归约到已知模型」「单调性」这种几乎每题都挂的
 *     粗节点权重低，具体机制节点权重高，避免两题只共享两个泛节点就被判成很像。
 *   - 难度差越大，整体相似度越低（难度差 1500 分以上最多打六折）：3300 的题和 1100 的题
 *     即便骨架相似，也不该被当成"同一类熟题"。
 */
import { OBS_ROOT, matchObsNodes } from './observation.js'

export const WEIGHTS = { obs: 0.6, other: 0.22, algo: 0.18 }

function pathFrom(index, id) {
  const names = []
  let current = index.get(id)
  let guard = 0
  while (current && guard < 100) {
    names.unshift(current.name)
    current = current.parent ? index.get(current.parent) : null
    guard += 1
  }
  return names.join('/')
}

function weightedJaccard(left, right) {
  if (!left.size && !right.size) return null
  let inter = 0
  let union = 0
  for (const [id, weight] of left) {
    const other = right.get(id) || 0
    inter += Math.min(weight, other)
    union += Math.max(weight, other)
  }
  for (const [id, weight] of right) {
    if (!left.has(id)) union += weight
  }
  return union === 0 ? 0 : inter / union
}

function obsIndexSpecificity(feature, id) {
  return feature.specificity ? feature.specificity.get(id) : null
}

function plainJaccard(left, right) {
  if (!left.size && !right.size) return null
  let inter = 0
  for (const id of left) if (right.has(id)) inter += 1
  return inter / (left.size + right.size - inter)
}

export function buildObsIndex(kb) {
  const index = new Map((kb.obsNodes || []).map((node) => [node.id, node]))
  const depth = new Map()
  const maxDepth = Math.max(1, ...(kb.obsNodes || []).map((node) => {
    let current = node
    let value = 0
    const seen = new Set()
    while (current && current.parent && !seen.has(current.id)) {
      seen.add(current.id)
      current = index.get(current.parent)
      value += 1
    }
    return value
  }), 0)
  for (const node of kb.obsNodes || []) {
    let current = node
    let value = 0
    const seen = new Set()
    while (current && current.parent && !seen.has(current.id)) {
      seen.add(current.id)
      current = index.get(current.parent)
      value += 1
    }
    depth.set(node.id, value)
  }

  // 每个观察节点被多少道题的精髓观察用到——用得越多，越"泛"，权重越低。
  const freq = new Map()
  const total = Math.max(1, (kb.problems || []).length)
  for (const problem of kb.problems || []) {
    const keyIds = new Set(problem.keyObservations || [])
    const used = new Set()
    for (const insight of problem.insights || []) {
      if (!keyIds.has(insight.id)) continue
      for (const id of insight.obsNodes || []) used.add(id)
    }
    for (const id of used) freq.set(id, (freq.get(id) || 0) + 1)
  }
  const rawIdf = new Map()
  let maxIdf = 0
  for (const node of kb.obsNodes || []) {
    const value = Math.log((total + 1) / ((freq.get(node.id) || 0) + 1))
    rawIdf.set(node.id, value)
    if (value > maxIdf) maxIdf = value
  }
  // 归一化分母只取「真的被用过」的节点：最稀有的常用观察 specificity = 1，
  // 这样两道观察集合完全相同的题相似度才能达到 1，而不是被泛节点一起拖低。
  const usedIdf = [...rawIdf.entries()].filter(([id]) => (freq.get(id) || 0) > 0).map(([, value]) => value)
  const maxUsedIdf = Math.max(0, ...usedIdf)
  const specificity = new Map()
  for (const [id, value] of rawIdf) {
    const used = (freq.get(id) || 0) > 0
    const ratio = used && maxUsedIdf > 0 ? value / maxUsedIdf : 1
    specificity.set(id, 0.25 + 0.75 * ratio)
  }

  // path → id，供「文本兜底匹配」把 matchObsNodes 的路径映射回库内节点 id。
  const byPath = new Map()
  for (const node of kb.obsNodes || []) {
    const chain = []
    let cursor = node
    const seen = new Set()
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      chain.unshift(cursor.name)
      cursor = cursor.parent ? index.get(cursor.parent) : null
    }
    byPath.set(chain.join('/'), node.id)
  }

  return { index, depth, maxDepth: Math.max(1, maxDepth), freq, specificity, byPath }
}

/**
 * 精髓观察挂到的节点：优先用人工/消解时写好的 obsNodes；
 * 没写的话，用观察句式里的叶子名/别名在洞察正文里兜底匹配（自动匹配的可信度打 75 折）。
 */
function obsIdsOf(insight, obsIndex) {
  if ((insight.obsNodes || []).length) return { ids: insight.obsNodes, confidence: 1 }
  if (!obsIndex.byPath) return { ids: [], confidence: 0 }
  const hits = matchObsNodes(insight.text).map((path) => obsIndex.byPath.get(path)).filter(Boolean)
  return { ids: [...new Set(hits)], confidence: 0.75 }
}

export function problemFeatures(kb, problem, obsIndex = buildObsIndex(kb)) {
  const keyIds = new Set(problem.keyObservations || [])
  const algorithmIndex = new Map(kb.nodes.map((node) => [node.id, node]))
  const obs = new Map()
  const other = new Set()
  const algo = new Set(problem.nodes || [])
  let keyInsights = 0
  for (const insight of problem.insights || []) {
    if (keyIds.has(insight.id)) {
      keyInsights += 1
      const { ids, confidence } = obsIdsOf(insight, obsIndex)
      for (const id of ids) {
        const d = obsIndex.depth.get(id) || 0
        const depthFactor = 0.5 + (0.5 * d) / obsIndex.maxDepth
        const rare = obsIndex.specificity ? obsIndex.specificity.get(id) ?? 1 : 1
        const weight = depthFactor * rare * confidence
        obs.set(id, Math.max(obs.get(id) || 0, weight))
      }
    } else {
      for (const id of insight.nodes || []) other.add(id)
    }
  }
  return {
    id: problem.id,
    key: problem.key,
    platform: problem.platform,
    title: problem.title,
    rating: problem.rating,
    obs,
    other,
    algo,
    keyInsights,
    algorithmIndex,
    obsIndex: obsIndex.index,
    specificity: obsIndex.specificity,
  }
}

export function compareFeatures(a, b) {
  const rawObs = weightedJaccard(a.obs, b.obs)
  // 如果"共同观察"全是泛节点（归约到已知模型、单调性这种），只算弱证据。
  const obsSharedIds = [...a.obs.keys()].filter((id) => b.obs.has(id))
  const specAvg = obsSharedIds.length
    ? obsSharedIds.reduce((sum, id) => sum + (a.specificity?.get(id) ?? 1), 0) / obsSharedIds.length
    : 0
  const obsScore = rawObs == null ? null : rawObs * (0.35 + 0.65 * specAvg)
  const otherScore = plainJaccard(a.other, b.other)
  const algoScore = plainJaccard(a.algo, b.algo)

  const parts = [
    ['obs', obsScore, WEIGHTS.obs],
    ['other', otherScore, WEIGHTS.other],
    ['algo', algoScore, WEIGHTS.algo],
  ].filter(([, value]) => value != null)

  if (!parts.length) return { score: 0, parts: { obs: null, other: null, algo: null, level: null }, shared: {} }
  const weightSum = parts.reduce((sum, [, , weight]) => sum + weight, 0)
  const base = parts.reduce((sum, [, value, weight]) => sum + value * weight, 0) / weightSum

  // 难度差惩罚：同一套骨架，3300 的题和 1100 的题不是同一类"熟题"。
  const ratingGap = Number.isFinite(a.rating) && Number.isFinite(b.rating) ? Math.abs(a.rating - b.rating) : null
  const levelFactor = ratingGap == null ? 1 : 1 - 0.4 * Math.min(1, ratingGap / 1500)
  const score = base * levelFactor

  const sharedObs = [...a.obs.keys()].filter((id) => b.obs.has(id)).map((id) => ({
    path: pathFrom(a.obsIndex, id),
    weight: Math.min(a.obs.get(id) || 0, b.obs.get(id) || 0),
    generic: (obsIndexSpecificity(a, id) || 1) < 0.5,
  }))
  const shared = {
    obs: sharedObs.map((item) => item.path),
    obsDetail: sharedObs,
    other: [...a.other].filter((id) => b.other.has(id)).map((id) => pathFrom(a.algorithmIndex, id)),
    algo: [...a.algo].filter((id) => b.algo.has(id)).map((id) => pathFrom(a.algorithmIndex, id)),
  }
  return {
    score,
    base,
    parts: { obs: obsScore, other: otherScore, algo: algoScore, level: levelFactor, ratingGap },
    shared,
  }
}

/** 某个题目与库内其他题目的最高相似度（最像的那道题）。 */
export function nearestProblem(kb, problem, options = {}) {
  const obsIndex = buildObsIndex(kb)
  const features = problemFeatures(kb, problem, obsIndex)
  let best = null
  for (const other of kb.problems) {
    if (other.id === problem.id) continue
    const result = compareFeatures(features, problemFeatures(kb, other, obsIndex))
    if (!best || result.score > best.score) best = { problem: other, ...result }
  }
  return best
}

/**
 * 给一批题目（候选）按"与库内其余题目的最大相似度"升序排序。
 * 越低越陌生——越可能是没掌握的题型。
 */
export function rankCandidates(kb, candidates, options = {}) {
  const obsIndex = buildObsIndex(kb)
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.3
  const baseline = options.baseline || kb.problems.filter((problem) => !problem.sample && problem.pool !== 'quiz')
  const library = baseline.map((problem) => ({ problem, features: problemFeatures(kb, problem, obsIndex) }))
  const rows = []
  for (const candidate of candidates) {
    const features = problemFeatures(kb, candidate, obsIndex)
    let best = null
    let second = null
    for (const other of library) {
      if (other.problem.id === candidate.id) continue
      const result = compareFeatures(features, other.features)
      if (!best || result.score > best.score) {
        second = best
        best = { problem: other.problem, ...result }
      } else if (!second || result.score > second.score) {
        second = { problem: other.problem, ...result }
      }
    }
    rows.push({
      problem: candidate,
      minSimilarity: best ? Number(best.score.toFixed(4)) : 0,
      nearest: best ? best.problem : null,
      nearestScore: best ? Number(best.score.toFixed(4)) : 0,
      nearestParts: best ? best.parts : { obs: null, other: null, algo: null },
      shared: best ? best.shared : { obs: [], other: [], algo: [] },
      runnerUp: second ? { problem: second.problem, score: Number(second.score.toFixed(4)) } : null,
      recommended: best ? best.score < threshold : true,
      keyInsights: features.keyInsights,
      hasObservationFeatures: features.obs.size > 0,
    })
  }
  rows.sort((left, right) => left.minSimilarity - right.minSimilarity || (right.problem.rating || 0) - (left.problem.rating || 0))
  return {
    threshold,
    rows,
    recommended: rows.filter((row) => row.recommended),
    sampled: rows.length,
    distribution: rows.map((row) => row.minSimilarity),
  }
}

/** 已做题两两的"最近邻相似度"分布，用来校准阈值。 */
export function calibrate(kb, options = {}) {
  const obsIndex = buildObsIndex(kb)
  const pool = kb.problems.filter((problem) => !problem.sample && problem.pool !== 'quiz')
  const features = new Map(pool.map((problem) => [problem.id, problemFeatures(kb, problem, obsIndex)]))
  const nearest = []
  for (const problem of pool) {
    let best = 0
    for (const other of pool) {
      if (other.id === problem.id) continue
      const score = compareFeatures(features.get(problem.id), features.get(other.id)).score
      if (score > best) best = score
    }
    nearest.push(best)
  }
  nearest.sort((a, b) => a - b)
  const pick = (q) => (nearest.length ? nearest[Math.min(nearest.length - 1, Math.max(0, Math.round((nearest.length - 1) * q)))] : 0)
  return {
    count: nearest.length,
    p10: Number(pick(0.1).toFixed(4)),
    p25: Number(pick(0.25).toFixed(4)),
    median: Number(pick(0.5).toFixed(4)),
    p75: Number(pick(0.75).toFixed(4)),
    max: Number((nearest[nearest.length - 1] || 0).toFixed(4)),
    values: nearest.map((value) => Number(value.toFixed(4))),
    recommendedThreshold: Number(Math.max(0.1, Math.min(0.45, pick(0.25) * 0.9)).toFixed(2)),
  }
}

export { OBS_ROOT }
