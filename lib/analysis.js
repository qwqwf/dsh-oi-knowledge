/**
 * 训练弱点分析。
 *
 * 输入是「已解决题目集合」+「知识点树」，输出每个节点的掌握度、最该补的节点与理由。
 *
 * 三条计分证据：
 *   coverage  做过多少道与该节点相关的题（边际递减）
 *   depth     做到什么难度（取 rating 75 分位，避免一道神题撑起整个节点）
 *   insight   沉淀了多少条观察/套路/思路（这才是「真的懂了」的证据）
 *
 * 一个已解决题目会同时记到「tag 对应的节点」和「它的所有祖先」上，
 * 所以父节点天然是子树题目的并集；子树之间的去重按 platform:key 做。
 */
import { ancestorIds, nodeIndex, pathOf } from './tree.js'

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value)

function quantile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function problemUid(problem) {
  return `${problem.platform}:${problem.key}`
}

export function collectSolved(kb) {
  const byUid = new Map()
  for (const problem of kb.problems) {
    if (problem.verdict !== 'solved') continue
    const uid = problemUid(problem)
    if (byUid.has(uid)) continue
    byUid.set(uid, {
      uid,
      platform: problem.platform,
      key: problem.key,
      title: problem.title,
      url: problem.url,
      rating: problem.rating,
      tags: problem.tags || [],
      managed: problem,
    })
  }
  for (const [platform, handles] of Object.entries(kb.solved || {})) {
    for (const map of Object.values(handles || {})) {
      for (const [key, item] of Object.entries(map || {})) {
        const uid = `${platform}:${key}`
        const previous = byUid.get(uid)
        if (previous) {
          if (previous.rating == null && item.rating != null) previous.rating = item.rating
          if ((!previous.tags || previous.tags.length === 0) && item.tags && item.tags.length) previous.tags = item.tags
          if (!previous.title || previous.title === previous.key) previous.title = item.title || previous.title
          continue
        }
        byUid.set(uid, {
          uid,
          platform,
          key,
          title: item.title || key,
          url: item.url || '',
          rating: item.rating ?? null,
          tags: item.tags || [],
          managed: null,
        })
      }
    }
  }
  return [...byUid.values()]
}

export function collectStruggle(kb) {
  const byUid = new Map()
  for (const problem of kb.problems) {
    if (problem.verdict !== 'attempted' && problem.verdict !== 'unsolved') continue
    byUid.set(`${problem.platform}:${problem.key}`, problem)
  }
  // 账号同步来的「提交过但从没 AC」的题，是比手填更硬的证据
  for (const [platform, handles] of Object.entries(kb.attempted || {})) {
    for (const map of Object.values(handles || {})) {
      for (const [key, item] of Object.entries(map || {})) {
        const uid = `${platform}:${key}`
        if (byUid.has(uid)) continue
        byUid.set(uid, {
          id: `attempted:${uid}`,
          platform,
          key,
          title: item.title || key,
          url: item.url || '',
          rating: item.rating ?? null,
          tags: item.tags || [],
          verdict: 'attempted',
          nodes: [],
          insights: [],
          synced: true,
        })
      }
    }
  }
  return [...byUid.values()]
}

/** 一个题目能落到哪些节点：tag → 映射节点，外加手工挂在题目上的节点。 */
function targetNodes(kb, problem) {
  const byId = nodeIndex(kb)
  const ids = new Set()
  for (const tag of problem.tags || []) {
    const mapped = kb.meta.tagMap[tag]
    if (mapped && byId.has(mapped)) ids.add(mapped)
  }
  for (const id of problem.nodes || []) {
    if (byId.has(id)) ids.add(id)
  }
  return [...ids]
}

export function analyze(kb) {
  const byId = nodeIndex(kb)
  const solved = collectSolved(kb)
  const struggle = collectStruggle(kb)

  const credit = new Map()
  const ratings = new Map()
  const insightMap = new Map()
  const struggleMap = new Map()
  for (const node of kb.nodes) {
    credit.set(node.id, new Set())
    ratings.set(node.id, [])
    insightMap.set(node.id, new Map())
    struggleMap.set(node.id, new Map())
  }

  const itemByUid = new Map()
  for (const item of solved) itemByUid.set(item.uid, item)

  for (const item of solved) {
    const targets = targetNodes(kb, item.managed || item)
    const touched = new Set()
    for (const id of targets) for (const ancestor of ancestorIds(kb, id)) touched.add(ancestor)
    for (const id of touched) credit.get(id)?.add(item.uid)
  }

  for (const problem of struggle) {
    const targets = targetNodes(kb, problem)
    const touched = new Set()
    for (const id of targets) for (const ancestor of ancestorIds(kb, id)) touched.add(ancestor)
    for (const id of touched) struggleMap.get(id)?.set(problem.id, problem.verdict)
  }

  for (const problem of kb.problems) {
    for (const insight of problem.insights || []) {
      const ids = new Set()
      for (const id of insight.nodes || []) for (const ancestor of ancestorIds(kb, id)) ids.add(ancestor)
      for (const id of ids) {
        const bucket = insightMap.get(id)
        if (!bucket) continue
        const key = `${problem.id}:${insight.kind}:${insight.text.slice(0, 40)}`
        if (!bucket.has(key)) {
          bucket.set(key, {
            key,
            kind: insight.kind,
            text: insight.text,
            problemId: problem.id,
            problemTitle: problem.title,
            platform: problem.platform,
            problemKey: problem.key,
            url: problem.url,
            insights: insight.id,
          })
        }
      }
    }
  }

  const linkedMap = new Map(kb.nodes.map((node) => [node.id, new Set()]))
  for (const problem of kb.problems) {
    const direct = new Set(problem.nodes || [])
    for (const insight of problem.insights || []) for (const id of insight.nodes || []) direct.add(id)
    const touched = new Set()
    for (const id of direct) for (const ancestor of ancestorIds(kb, id)) touched.add(ancestor)
    for (const id of touched) linkedMap.get(id)?.add(problem.id)
  }

  const stats = new Map()
  for (const node of kb.nodes) {
    const creditSet = credit.get(node.id) || new Set()
    const nodeRatings = []
    for (const uid of creditSet) {
      const rating = itemByUid.get(uid)?.rating
      if (rating != null) nodeRatings.push(rating)
    }
    ratings.set(node.id, nodeRatings)
    const insights = [...(insightMap.get(node.id)?.values() || [])]
    const kinds = new Set(insights.map((insight) => insight.kind))
    const struggles = [...(struggleMap.get(node.id)?.values() || [])]
    const unsolvedCount = struggles.filter((verdict) => verdict === 'unsolved').length
    const attemptedCount = struggles.filter((verdict) => verdict === 'attempted').length
    const solvedCount = creditSet.size

    const coverage = 1 - Math.exp(-solvedCount / 2.5)
    const p75 = quantile(nodeRatings, 0.75)
    const maxRating = nodeRatings.length ? Math.max(...nodeRatings) : null
    const depth = p75 == null ? 0 : clamp01((p75 - 1100) / 1500)
    const insightScore = clamp01(insights.length * 0.5 + kinds.size * 0.35)

    let score = 0.45 * coverage + 0.3 * depth + 0.25 * insightScore
    switch (node.mastery) {
      case 'expert':
        score = Math.max(score, 0.92)
        break
      case 'strong':
        score = Math.max(score, 0.75)
        break
      case 'ok':
        score = Math.min(Math.max(score, 0.4), 0.68)
        break
      case 'weak':
        score = Math.min(score, 0.32)
        break
      case 'poor':
        score = Math.min(score, 0.15)
        break
      case 'unknown':
        score = Math.min(score, 0.15)
        break
      default:
        break
    }
    score = clamp01(score)
    const dataScore = clamp01((0.45 * coverage + 0.3 * depth) / 0.75)
    // 五档熟练度：既看「做穿过的峰值难度」，也看「做过多少题」。
    // 单看 score 在题量上千后会全部饱和到 1，分不出层次。
    const peak = p75 == null ? 0 : p75
    const level =
      node.mastery !== 'auto'
        ? node.mastery
        : solvedCount === 0 && insights.length === 0
          ? 'unknown'
          : peak >= 2900 && solvedCount >= 30
            ? 'expert'
            : peak >= 2500 && solvedCount >= 15
              ? 'strong'
              : solvedCount >= 8
                ? 'ok'
                : solvedCount >= 2
                  ? 'weak'
                  : 'poor'

    stats.set(node.id, {
      id: node.id,
      solvedCount,
      attemptedCount,
      unsolvedCount,
      insightCount: insights.length,
      insightKinds: [...kinds],
      linkedProblems: linkedMap.get(node.id)?.size || 0,
      p75,
      maxRating,
      coverage,
      depth,
      insightScore,
      score,
      dataScore,
      level,
      insights: insights.slice(0, 40).sort((a, b) => a.kind.localeCompare(b.kind)),
      topProblems: [...creditSet]
        .map((uid) => itemByUid.get(uid))
        .filter(Boolean)
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, 8),
      reasons: [],
      risk: 0,
    })
  }

  // 只有「自己或子树认领了 tag」或「有手工题目/洞察」的节点，才真的能从账号数据测出来。
  // 否则（比如 CF 只有粗标签 data structures 时的「线段树」）不该被当成弱项。
  const childrenOf = new Map()
  for (const node of kb.nodes) {
    const list = childrenOf.get(node.parent) || []
    list.push(node.id)
    childrenOf.set(node.parent, list)
  }
  const taggedIds = new Set(Object.values(kb.meta.tagMap))
  const subtreeHasTag = (id) => {
    const stack = [id]
    while (stack.length) {
      const current = stack.pop()
      if (taggedIds.has(current)) return true
      for (const child of childrenOf.get(current) || []) stack.push(child)
    }
    return false
  }
  const measuredIds = new Set()
  for (const node of kb.nodes) {
    const stat = stats.get(node.id)
    if (!stat) continue
    if (subtreeHasTag(node.id) || stat.solvedCount > 0 || stat.insightCount > 0) measuredIds.add(node.id)
  }

  const globalP75 = quantile(
    solved.map((item) => item.rating).filter((value) => value != null),
    0.75,
  )

  for (const node of kb.nodes) {
    const stat = stats.get(node.id)
    if (!stat) continue
    const parent = node.parent ? byId.get(node.parent) : null
    const parentStat = parent ? stats.get(parent.id) : null
    const ratedOf = (stat, node) =>
      node.mastery && node.mastery !== 'auto' ? stat.score : stat.dataScore
    const parentRated = parentStat && parent ? ratedOf(parentStat, parent) : 0.5
    const hasChildren = kb.nodes.some((other) => other.parent === node.id)
    const struggleFactor =
      1 + (0.8 * Math.min(stat.unsolvedCount, 3)) / 3 + (0.4 * Math.min(stat.attemptedCount, 3)) / 3
    const measured = measuredIds.has(node.id)
    const ceilingGap =
      measured &&
      stat.solvedCount >= 4 &&
      stat.maxRating != null &&
      globalP75 != null &&
      stat.maxRating < globalP75 - 150
    const risk =
      (1 - ratedOf(stat, node)) *
      (0.3 + 0.7 * parentRated) *
      struggleFactor *
      (hasChildren ? 1 : 1.15) *
      (ceilingGap ? 1.2 : 1)
    stat.measured = measured
    stat.ceilingGap = ceilingGap
    stat.risk = measured ? Number(risk.toFixed(4)) : 0
    if (!measured) {
      stat.level = 'unmeasured'
      stat.score = 0
    }

    const reasons = []
    if (!measured) {
      reasons.push('账号数据只有粗标签，这一支测不到；录几道题或给 tag 补映射后才能判断')
      if (parentStat && parentStat.solvedCount > 0) {
        reasons.push(`父节点「${parent.name}」的 ${parentStat.solvedCount} 题用的是粗标签，不等于这一支练过`)
      }
    } else {
      if (stat.unsolvedCount > 0) reasons.push(`${stat.unsolvedCount} 道标为「未解决」的题落在这里`)
      else if (stat.attemptedCount > 0) reasons.push(`${stat.attemptedCount} 道试过但没过`)
      if (stat.solvedCount === 0 && parentStat && parentStat.solvedCount > 0) {
        reasons.push(`父节点「${parent.name}」已有 ${parentStat.solvedCount} 题积累，这一支是空白`)
      }
      if (stat.solvedCount === 0 && stat.insightCount === 0 && !reasons.length) reasons.push('完全没有接触记录')
      if (ceilingGap) {
        reasons.push(`最高只做到 ${stat.maxRating} 分，低于你整体 75 分位 ${Math.round(globalP75)}`)
      }
      if (stat.solvedCount > 0 && stat.p75 != null && stat.depth < 0.3) {
        reasons.push(`只练到 ${Math.round(stat.p75)} 分难度，深度不够`)
      }
      if (stat.solvedCount >= 3 && stat.insightCount === 0) reasons.push('有题量但没沉淀观察/套路')
      if (stat.solvedCount > 0 && stat.insightCount === 0 && reasons.length === 0) reasons.push('缺少可复用的总结')
    }
    stat.reasons = reasons
  }

  const nodeRows = kb.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    parent: node.parent,
    kind: node.kind,
    summary: node.summary,
    signals: node.signals,
    aliases: node.aliases,
    cfTags: node.cfTags,
    note: node.note,
    mastery: node.mastery,
    tree: node.tree === 'idea' ? 'idea' : null,
    path: pathOf(kb, node),
    depth: ancestorIds(kb, node.id).length - 1,
    ...stats.get(node.id),
  }))
  const rowsById = new Map(nodeRows.map((row) => [row.id, row]))

  const algoRows = nodeRows.filter((row) => row.tree !== 'idea')
  const ideaRows = nodeRows.filter((row) => row.tree === 'idea')

  // 思路节点用「沉淀了多少洞察」定级，而不是刷题数：算法名不等于思考方式。
  for (const row of ideaRows) {
    const ideaScore = clamp01((Math.min(row.insightCount, 8) / 8) * 0.7 + (Math.min(row.linkedProblems, 12) / 12) * 0.3)
    row.score = ideaScore
    row.dataScore = ideaScore
    row.level =
      row.insightCount >= 8
        ? 'expert'
        : row.insightCount >= 6
          ? 'strong'
          : row.insightCount >= 3
            ? 'ok'
            : row.insightCount >= 1
              ? 'weak'
              : 'unknown'
    row.measured = row.insightCount > 0
    row.risk = 0
    row.reasons =
      row.insightCount === 0
        ? ['这道思路还没有任何洞察']
        : row.insightCount < 3
          ? [`只有 ${row.insightCount} 条洞察，还不足以形成套路`]
          : []
  }

  const nonRoot = algoRows.filter((row) => row.parent !== null)
  const root = algoRows.filter((row) => row.parent === null)
  const covered = nonRoot.filter((row) => row.level !== 'unknown' && row.level !== 'unmeasured')

  const ideaInsightKeys = new Set()
  for (const problem of kb.problems) {
    for (const insight of problem.insights || []) {
      if ((insight.nodes || []).some((id) => rowsById.get(id)?.tree === 'idea')) {
        ideaInsightKeys.add(`${problem.id}:${insight.id || insight.text.slice(0, 40)}`)
      }
    }
  }
  const ideaNonRoot = ideaRows.filter((row) => row.parent !== null)

  const overview = {
    nodes: algoRows.length,
    covered: covered.length,
    coveredPct: nonRoot.length ? Math.round((covered.length / nonRoot.length) * 100) : 0,
    expert: nonRoot.filter((row) => row.level === 'expert').length,
    strong: nonRoot.filter((row) => row.level === 'strong').length,
    ok: nonRoot.filter((row) => row.level === 'ok').length,
    weak: nonRoot.filter((row) => row.level === 'weak').length,
    poor: nonRoot.filter((row) => row.level === 'poor').length,
    blank: nonRoot.filter((row) => row.level === 'unknown').length,
    unmeasured: nonRoot.filter((row) => row.level === 'unmeasured').length,
    manualProblems: kb.problems.filter((problem) => !problem.sample).length,
    manualSolved: kb.problems.filter((problem) => !problem.sample && problem.verdict === 'solved').length,
    manualStuck: kb.problems.filter(
      (problem) => !problem.sample && (problem.verdict === 'attempted' || problem.verdict === 'unsolved'),
    ).length,
    syncedAttempted: struggle.filter((problem) => problem.synced).length,
    stuck: kb.problems.reduce(
      (acc, problem) => {
        if (problem.sample) return acc
        if (['observe', 'derive', 'implement', 'debug'].includes(problem.stuckStage)) {
          acc[problem.stuckStage] += 1
        }
        return acc
      },
      { observe: 0, derive: 0, implement: 0, debug: 0 },
    ),
    syncedSolved: solved.length,
    untagged: solved.filter((item) => !(item.tags || []).length).length,
    accounts: kb.accounts.length,
    insights: kb.problems.filter((problem) => !problem.sample).reduce((sum, problem) => sum + (problem.insights?.length || 0), 0),
    ideaNodes: ideaRows.length,
    ideaCovered: ideaNonRoot.filter((row) => row.insightCount > 0).length,
    ideaInsights: ideaInsightKeys.size,
  }

  const top = [...nonRoot]
    .filter((row) => row.risk > 0.05)
    .sort((a, b) => b.risk - a.risk || b.p75 - a.p75)
    .slice(0, 40)

  // 思路树里最该补的方向：没洞察的、以及有题但没总结的。
  const ideaTop = [...ideaNonRoot]
    .sort((a, b) => a.insightCount - b.insightCount || b.linkedProblems - a.linkedProblems)
    .slice(0, 16)

  const unclassified = kb.problems
    .filter((problem) => !problem.sample)
    .filter((problem) => {
      const linked = (problem.nodes || []).length > 0
      const insightLinked = (problem.insights || []).some((insight) => (insight.nodes || []).length > 0)
      return !linked && !insightLinked
    })
    .map((problem) => ({
      id: problem.id,
      platform: problem.platform,
      key: problem.key,
      title: problem.title,
      verdict: problem.verdict,
      rating: problem.rating,
    }))

  return {
    rows: nodeRows,
    rowsById,
    root,
    nonRoot,
    algoRows,
    ideaRows,
    ideaTop,
    stats,
    overview,
    top,
    unclassified,
    solved,
    struggle,
    gaps: buildGaps(kb, solved),
    generatedAt: new Date().toISOString(),
  }
}

export function buildGaps(kb, solved) {
  const byTag = new Map()
  for (const item of solved) {
    for (const tag of item.tags || []) {
      if (!byTag.has(tag)) byTag.set(tag, { tag, solved: 0, ratings: [] })
      const entry = byTag.get(tag)
      entry.solved += 1
      if (item.rating != null) entry.ratings.push(item.rating)
    }
  }
  const byId = nodeIndex(kb)
  const gaps = []
  for (const [tag, entry] of byTag) {
    const nodeId = kb.meta.tagMap[tag]
    const node = nodeId ? byId.get(nodeId) : null
    gaps.push({
      tag,
      mappedNode: node ? node.name : null,
      mappedPath: node ? pathOf(kb, node) : null,
      solved: entry.solved,
      medianRating: entry.ratings.length ? Math.round(quantile(entry.ratings, 0.5)) : null,
      maxRating: entry.ratings.length ? Math.max(...entry.ratings) : null,
    })
  }
  gaps.sort((a, b) => a.solved - b.solved || a.tag.localeCompare(b.tag))
  return gaps
}

/** 反向找「这个节点（含子树）认领了哪些 tag」。 */
export function tagsForNode(kb, node) {
  const ids = new Set()
  const stack = [node.id]
  while (stack.length) {
    const id = stack.pop()
    ids.add(id)
    for (const other of kb.nodes) if (other.parent === id) stack.push(other.id)
  }
  return Object.entries(kb.meta.tagMap)
    .filter(([, id]) => ids.has(id))
    .map(([tag]) => tag)
}

export function nodeStatsFor(kb, analysis, ref) {
  const row = analysis.rows.find((item) => item.id === ref.id)
  return row || null
}

/**
 * 从 CF problemset 里挑练习：命中弱点 tag、难度落在窗口内、且没做过、没录入过。
 */
export function recommendProblems(kb, pool, options = {}) {
  const analysis = options.analysis || analyze(kb)
  const limit = options.limit ?? 10
  // 默认难度窗口跟着主人的水平走：以已通过题的中位到 75 分位为基准上下放宽，
  // 否则 800 分的题也会被推上来（对已经能过 2700 的人没有意义）。
  const ratings = analysis.solved.map((item) => item.rating).filter((rating) => rating != null).sort((a, b) => a - b)
  const quantileOf = (q) => {
    if (!ratings.length) return null
    const index = Math.min(ratings.length - 1, Math.max(0, Math.floor(q * (ratings.length - 1))))
    return ratings[index]
  }
  const p50 = quantileOf(0.5)
  const p75 = quantileOf(0.75)
  const ratingMin = options.ratingMin ?? (p50 != null ? Math.max(1200, p50 - 300) : null)
  const ratingMax = options.ratingMax ?? (p75 != null ? p75 + 300 : null)
  const preferred = p75 != null ? Math.min(p75 + 100, 3500) : null
  const solvedSet = new Set(analysis.solved.filter((item) => item.platform === 'codeforces').map((item) => `codeforces:${item.key}`))
  const knownSet = new Set(kb.problems.filter((problem) => problem.platform === 'codeforces').map((problem) => `codeforces:${problem.key}`))
  const solvedKeys = new Set([...solvedSet].map((uid) => uid.split(':')[1]))
  const knownKeys = new Set([...knownSet].map((uid) => uid.split(':')[1]))

  // tag → 认领节点，以及「节点自身 / 子树认领的 tag」
  const childrenOf = new Map()
  for (const node of kb.nodes) {
    const list = childrenOf.get(node.parent) || []
    list.push(node.id)
    childrenOf.set(node.parent, list)
  }
  const tagsAt = new Map()
  for (const [tag, id] of Object.entries(kb.meta.tagMap)) {
    const list = tagsAt.get(id) || []
    list.push(tag)
    tagsAt.set(id, list)
  }
  const subtreeTags = (id) => {
    const out = new Set()
    const stack = [id]
    while (stack.length) {
      const current = stack.pop()
      for (const tag of tagsAt.get(current) || []) out.add(tag)
      for (const child of childrenOf.get(current) || []) stack.push(child)
    }
    return out
  }
  const ancestorTags = (id) => {
    let current = kb.nodes.find((node) => node.id === id) || null
    while (current && current.parent) {
      const tags = tagsAt.get(current.parent)
      if (tags && tags.length) return tags
      current = kb.nodes.find((node) => node.id === current.parent) || null
    }
    return []
  }

  let targetTags
  if (options.node) {
    targetTags = subtreeTags(options.node.id)
    if (targetTags.size === 0) for (const tag of ancestorTags(options.node.id)) targetTags.add(tag)
  } else if (options.tag) {
    targetTags = new Set([options.tag])
  } else {
    // 默认：在「自己认领 tag」的节点里挑风险最高的几个（这些弱点能直接换成练习方向），
    // 并用父节点风险加权，避免只看叶子。
    targetTags = new Set()
    const ranked = analysis.nonRoot
      .filter((row) => (tagsAt.get(row.id) || []).length)
      .map((row) => {
        let exposure = row.risk
        let parentId = row.parent
        let level = 1
        while (parentId && level <= 2) {
          const parentRow = analysis.rowsById.get(parentId)
          if (!parentRow) break
          exposure = Math.max(exposure, parentRow.risk * (1 - 0.22 * level))
          parentId = parentRow.parent
          level += 1
        }
        return { row, exposure }
      })
      .sort((a, b) => b.exposure - a.exposure)
    for (const entry of ranked.slice(0, 6)) for (const tag of tagsAt.get(entry.row.id) || []) targetTags.add(tag)
  }
  if (targetTags.size === 0) return { items: [], targetTags: [], note: '没有可用的 tag 映射，先 oi_kb action=map_tag 把 tag 挂到知识点上' }

  const nodeByTag = new Map()
  for (const [tag, id] of Object.entries(kb.meta.tagMap)) {
    const row = analysis.rowsById.get(id)
    if (row && targetTags.has(tag)) nodeByTag.set(tag, row)
  }

  const items = []
  for (const problem of pool) {
    if (problem.rating == null) continue
    if (ratingMin != null && problem.rating < ratingMin) continue
    if (ratingMax != null && problem.rating > ratingMax) continue
    const key = `${problem.contestId}${problem.index}`
    if (solvedKeys.has(key) || knownKeys.has(key)) continue
    const hitTags = (problem.tags || []).filter((tag) => targetTags.has(tag))
    if (!hitTags.length) continue
    const nodes = [...new Set(hitTags.map((tag) => nodeByTag.get(tag)).filter(Boolean))]
    const weight = nodes.reduce((sum, row) => sum + row.risk, 0) / Math.max(1, nodes.length)
    items.push({
      id: `codeforces:${key}`,
      platform: 'codeforces',
      key,
      title: problem.name,
      rating: problem.rating,
      tags: problem.tags || [],
      url: `https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`,
      hitTags,
      nodes: nodes.map((row) => row.path),
      weight,
    })
  }
  items.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight
    if (preferred == null) return (a.rating ?? 0) - (b.rating ?? 0)
    return Math.abs((a.rating ?? 0) - preferred) - Math.abs((b.rating ?? 0) - preferred)
  })

  // 尽量让前几道题覆盖不同的 tag，而不是同一个弱项刷一屏
  const picked = []
  const usedTags = new Set()
  for (const item of items) {
    if (picked.length >= limit) break
    if (item.hitTags.some((tag) => usedTags.has(tag))) continue
    picked.push(item)
    for (const tag of item.hitTags) usedTags.add(tag)
  }
  if (picked.length < limit) {
    for (const item of items) {
      if (picked.length >= limit) break
      if (!picked.includes(item)) picked.push(item)
    }
  }
  return { items: picked, targetTags: [...targetTags], ratingMin, ratingMax }
}
