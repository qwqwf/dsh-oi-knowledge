/**
 * 知识点树：节点的查找、增删改、路径解析。
 *
 * 节点的 id 是不透明的短串（n1, n2…），对人没有意义；人（和模型）用
 * 「名字」或「父/子」路径来指代节点，所以这里所有对外接口都吃 ref：
 *   - 节点 id：n7
 *   - 完整路径：动态规划/区间 DP
 *   - 唯一名字：区间 DP（全局唯一时才接受，重名会报错并列出候选）
 */
import { KbError, fail } from './store.js'

export function nodeIndex(kb) {
  const byId = new Map()
  for (const node of kb.nodes) byId.set(node.id, node)
  return byId
}

export function childrenMap(kb) {
  const map = new Map()
  map.set(null, [])
  for (const node of kb.nodes) map.set(node.id, [])
  for (const node of kb.nodes) {
    const list = map.get(node.parent) || map.get(null)
    list.push(node)
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'zh'))
  }
  return map
}

export function pathOf(kb, node) {
  const byId = nodeIndex(kb)
  const names = []
  let current = node
  let guard = 0
  while (current && guard < 64) {
    names.push(current.name)
    current = current.parent ? byId.get(current.parent) : null
    guard += 1
  }
  return names.reverse().join('/')
}

export function ancestorIds(kb, id) {
  const byId = nodeIndex(kb)
  const ids = []
  let current = byId.get(id)
  let guard = 0
  while (current && guard < 64) {
    ids.push(current.id)
    current = current.parent ? byId.get(current.parent) : null
    guard += 1
  }
  return ids
}

export function descendantIds(kb, id) {
  const children = childrenMap(kb)
  const out = []
  const stack = [id]
  while (stack.length) {
    const current = stack.pop()
    out.push(current)
    for (const child of children.get(current) || []) stack.push(child.id)
  }
  return out
}

export function nodeDepth(kb, node) {
  return ancestorIds(kb, node.id).length - 1
}

export function resolveNode(kb, ref) {
  const raw = String(ref ?? '').trim()
  if (raw === '') fail('缺少知识点参数（节点 id、名字或「父/子」路径）')
  const byId = nodeIndex(kb)
  if (byId.has(raw)) return byId.get(raw)

  const segments = raw.split(/\s*(?:\/|／|>|＞|→|::)\s*/).filter((part) => part !== '')
  if (segments.length > 1) {
    let current = null
    for (const segment of segments) {
      const pool = kb.nodes.filter((node) => (node.parent ?? null) === (current ? current.id : null))
      const hit =
        pool.find((node) => node.name === segment) ||
        pool.find((node) => node.name.toLowerCase() === segment.toLowerCase()) ||
        pool.find((node) => node.id === segment)
      if (!hit) {
        const available = pool.map((node) => node.name).join('、')
        fail(
          `路径「${raw}」在「${segment}」处断了。该层现有：${available || '（空）'}`,
        )
      }
      current = hit
    }
    return current
  }

  const needle = raw.toLowerCase()
  const hits = kb.nodes.filter(
    (node) =>
      node.name.toLowerCase() === needle ||
      (Array.isArray(node.aliases) && node.aliases.some((alias) => alias.toLowerCase() === needle)),
  )
  if (hits.length === 0) {
    // 退一步：唯一子串匹配，方便「区间DP」少打空格
    const fuzzy = kb.nodes.filter((node) => node.name.toLowerCase().includes(needle))
    if (fuzzy.length === 1) return fuzzy[0]
    if (fuzzy.length > 1) {
      fail(`「${raw}」匹配到多个知识点，请写完整路径：${fuzzy.slice(0, 8).map((node) => pathOf(kb, node)).join('、')}`)
    }
    fail(`找不到知识点「${raw}」。可先 oi_kb action=tree 看现有树，或用 action=add 新建。`)
  }
  if (hits.length > 1) {
    fail(`「${raw}」有 ${hits.length} 个同名节点，请用完整路径区分：${hits.slice(0, 8).map((node) => pathOf(kb, node)).join('、')}`)
  }
  return hits[0]
}

export function findNode(kb, ref) {
  try {
    return resolveNode(kb, ref)
  } catch (_) {
    return null
  }
}

export function assertSiblingNameFree(kb, parentId, name, exceptId) {
  const clash = kb.nodes.find(
    (node) => (node.parent ?? null) === (parentId ?? null) && node.id !== exceptId && node.name === name,
  )
  if (clash) {
    const where = parentId ? pathOf(kb, kb.nodes.find((node) => node.id === parentId)) : '根'
    fail(`「${where}」下已经有同名知识点「${name}」，换个名字，或先合并。`)
  }
}

export function addNode(kb, spec, nextId) {
  const name = String(spec.name ?? '').trim()
  if (name === '') fail('知识点名字不能为空')
  if (name.includes('/')) fail('知识点名字里不要带「/」，用 parent 参数表达层级')
  const parent = spec.parent ? resolveNode(kb, spec.parent) : null
  assertSiblingNameFree(kb, parent ? parent.id : null, name)
  const siblings = kb.nodes.filter((node) => (node.parent ?? null) === (parent ? parent.id : null))
  const order = siblings.reduce((max, node) => Math.max(max, node.order ?? 0), -1) + 1
  const t = new Date().toISOString()
  const node = {
    id: nextId(kb, 'n'),
    parent: parent ? parent.id : null,
    name,
    kind: spec.kind || (parent ? 'concept' : 'domain'),
    summary: String(spec.summary ?? ''),
    signals: Array.isArray(spec.signals) ? spec.signals.map(String) : [],
    aliases: Array.isArray(spec.aliases) ? spec.aliases.map(String) : [],
    cfTags: Array.isArray(spec.cfTags) ? spec.cfTags.map(String) : [],
    note: String(spec.note ?? ''),
    mastery: spec.mastery || 'auto',
    ...(spec.tree === 'idea' ? { tree: 'idea' } : {}),
    order,
    createdAt: t,
    updatedAt: t,
  }
  kb.nodes.push(node)
  return node
}

export function updateNode(kb, node, patch) {
  if (patch.name !== undefined) {
    const name = String(patch.name).trim()
    if (name === '') fail('名字不能为空')
    if (name.includes('/')) fail('名字里不要带「/」')
    assertSiblingNameFree(kb, node.parent, name, node.id)
    node.name = name
  }
  if (patch.kind !== undefined) node.kind = patch.kind
  if (patch.summary !== undefined) node.summary = String(patch.summary)
  if (patch.note !== undefined) node.note = String(patch.note)
  if (patch.signals !== undefined) node.signals = Array.isArray(patch.signals) ? patch.signals.map(String) : []
  if (patch.aliases !== undefined) node.aliases = Array.isArray(patch.aliases) ? patch.aliases.map(String) : []
  if (patch.cfTags !== undefined) node.cfTags = Array.isArray(patch.cfTags) ? patch.cfTags.map(String) : []
  if (patch.mastery !== undefined) node.mastery = patch.mastery
  node.updatedAt = new Date().toISOString()
  return node
}

export function moveNode(kb, node, newParent) {
  if (newParent && newParent.id === node.id) fail('不能把节点挂到自己下面')
  if (newParent && descendantIds(kb, node.id).includes(newParent.id)) {
    fail(`不能把「${node.name}」挂到它自己的子孙「${newParent.name}」下面`)
  }
  const parentId = newParent ? newParent.id : null
  if ((node.parent ?? null) === parentId) return node
  assertSiblingNameFree(kb, parentId, node.name, node.id)
  node.parent = parentId
  const siblings = kb.nodes.filter((other) => (other.parent ?? null) === parentId && other.id !== node.id)
  node.order = siblings.reduce((max, other) => Math.max(max, other.order ?? 0), -1) + 1
  node.updatedAt = new Date().toISOString()
  return node
}

export function removeNode(kb, node, mode) {
  const ids = descendantIds(kb, node.id)
  const set = new Set(ids)
  if (mode === 'reparent') {
    const parentId = node.parent ?? null
    const children = kb.nodes.filter((other) => (other.parent ?? null) === node.id)
    let order = kb.nodes
      .filter((other) => (other.parent ?? null) === parentId && other.id !== node.id)
      .reduce((max, other) => Math.max(max, other.order ?? 0), -1)
    for (const child of children) {
      child.parent = parentId
      child.order = (order += 1)
      child.updatedAt = new Date().toISOString()
    }
    kb.nodes = kb.nodes.filter((other) => other.id !== node.id)
    set.delete(node.id)
  } else {
    kb.nodes = kb.nodes.filter((other) => !set.has(other.id))
  }
  for (const problem of kb.problems) {
    problem.nodes = problem.nodes.filter((id) => !set.has(id))
    for (const insight of problem.insights) insight.nodes = insight.nodes.filter((id) => !set.has(id))
  }
  for (const [tag, id] of Object.entries(kb.meta.tagMap)) {
    if (set.has(id)) delete kb.meta.tagMap[tag]
  }
  return { removed: ids, mode: mode === 'reparent' ? 'reparent' : 'subtree' }
}

export function searchNodes(kb, query, limit = 20) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (needle === '') return []
  const scored = []
  for (const node of kb.nodes) {
    const path = pathOf(kb, node).toLowerCase()
    const haystack = [node.name, node.summary, node.note, ...(node.signals || []), ...(node.aliases || []), ...(node.cfTags || [])]
      .join('\n')
      .toLowerCase()
    let score = 0
    if (node.name.toLowerCase() === needle) score = 100
    else if (node.name.toLowerCase().includes(needle)) score = 60
    else if (path.includes(needle)) score = 40
    else if (haystack.includes(needle)) score = 20
    if (score > 0) scored.push({ node, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((item) => item.node)
}

export function isKnownNode(kb, ref) {
  return findNode(kb, ref) !== null
}

export { KbError }
