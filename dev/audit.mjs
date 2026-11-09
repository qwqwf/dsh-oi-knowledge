// 全库体检：数据完整性、节点树卫生、洞察挂载率、state 体积。
// 用法：node dev/audit.mjs
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'
import { OBS_TAXONOMY } from '../lib/observation.js'
import { IDEA_TAXONOMY } from '../lib/ideas.js'

const store = new KbStore()
const service = new KnowledgeService(store)
const kb = store.read()

const problems = kb.problems
const real = problems.filter((p) => !p.sample)
const sample = problems.filter((p) => p.sample)
const insights = real.flatMap((p) => p.insights)
const observations = insights.filter((i) => i.kind === 'observation')
const missingEssence = real.filter((p) => !p.essence.trim())
const missingInsights = real.filter((p) => !p.insights.length)
const noKeyObs = real.filter((p) => !(p.keyObservations || []).length)
const obsWithoutNodes = observations.filter((i) => !(i.obsNodes || []).length)

const byId = new Map(kb.nodes.map((n) => [n.id, n]))
const orphanNodes = kb.nodes.filter((n) => n.parent && !byId.has(n.parent))
const siblingDup = []
const nameGroups = new Map()
for (const n of kb.nodes) {
  const key = `${n.parent || 'root'}:${n.name}`
  if (!nameGroups.has(key)) nameGroups.set(key, [])
  nameGroups.get(key).push(n)
}
for (const [key, list] of nameGroups) if (list.length > 1) siblingDup.push(`${key} ×${list.length}`)

const tagMap = kb.meta.tagMap || {}
const tagOwnersMissing = Object.entries(tagMap).filter(([, id]) => !byId.has(id))
const tagMulti = Object.entries(tagMap)
const tagToNodes = new Map()
for (const [tag, id] of tagMulti) {
  if (!tagToNodes.has(id)) tagToNodes.set(id, [])
  tagToNodes.get(id).push(tag)
}

const obsById = new Map(kb.obsNodes.map((n) => [n.id, n]))
const obsOrphans = kb.obsNodes.filter((n) => n.parent && !obsById.has(n.parent))
const obsParents = new Set(kb.obsNodes.map((n) => n.parent).filter(Boolean))
const obsLeaves = kb.obsNodes.filter((n) => !obsParents.has(n.id))
const obsNoPatterns = obsLeaves.filter((n) => !(n.patterns || []).length)
const badObsRefs = observations.filter((i) => (i.obsNodes || []).some((id) => !obsById.has(id)))
const obsDup = []
const obsNameGroups = new Map()
for (const n of kb.obsNodes) {
  const key = `${n.parent || 'root'}:${n.name}`
  if (!obsNameGroups.has(key)) obsNameGroups.set(key, [])
  obsNameGroups.get(key).push(n)
}
for (const [key, list] of obsNameGroups) if (list.length > 1) obsDup.push(`${key} ×${list.length}`)

const ideaIds = new Set(kb.nodes.filter((n) => n.tree === 'idea').map((n) => n.id))
const ideaEmpty = [...ideaIds].filter((id) => {
  return !real.some((p) => p.insights.some((i) => i.nodes?.includes(id) || i.obsNodes?.includes(id)))
})

const taxonomyPaths = new Set([...OBS_TAXONOMY.map(([p]) => p), ...IDEA_TAXONOMY.map(([p]) => p)])
const kbObsPaths = new Set(kb.obsNodes.map((n) => service.obsPath(kb, n.id)))
const taxonomyMissingInKb = [...taxonomyPaths].filter((p) => p.startsWith('观察/') && !kbObsPaths.has(p))

const state = service.state()
const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8')

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—')
console.log('== 题库 ==')
console.log(`题目 ${problems.length}（正式 ${real.length} / 样例 ${sample.length}）`)
console.log(`洞察 ${insights.length}：observation ${observations.length}，缺 obsNodes 的观察 ${obsWithoutNodes.length}（${pct(obsWithoutNodes.length, observations.length)}）`)
console.log(`缺精髓 ${missingEssence.length}，缺洞察 ${missingInsights.length}，缺 keyObservations ${noKeyObs.length}`)
console.log('== 算法/思路树 ==')
console.log(`节点 ${kb.nodes.length}（思路 ${ideaIds.size}），孤儿 ${orphanNodes.length}，同级重名 ${siblingDup.length}`)
console.log(`思路节点 0 洞察：${ideaEmpty.length}`)
console.log(`tagMap ${Object.keys(tagMap).length}，指向不存在节点 ${tagOwnersMissing.length}`)
console.log('== 观察树 ==')
console.log(`节点 ${kb.obsNodes.length}（叶子 ${obsLeaves.length}），孤儿 ${obsOrphans.length}，同级重名 ${obsDup.length}，叶子无句式 ${obsNoPatterns.length}，坏引用 ${badObsRefs.length}`)
console.log(`taxonomy 中缺失 ${taxonomyMissingInKb.length}`)
console.log('== state ==')
console.log(`payload ${(stateBytes / 1024).toFixed(1)} KB；nodes ${state.nodes.length}，problems ${state.problems.length}，obsNodes ${state.obsNodes.length}`)
if (siblingDup.length) console.log('同级重名：', siblingDup.join(', '))
if (tagOwnersMissing.length) console.log('坏 tag：', tagOwnersMissing.map(([t]) => t).join(', '))
if (obsDup.length) console.log('观察树同级重名：', obsDup.join(', '))
if (taxonomyMissingInKb.length) console.log('缺失观察节点：', taxonomyMissingInKb.join(', '))

// 这些属于「数据坏了」，应该修；缺精髓/未归类观察只是内容待补，不算错误。
const errors = [
  orphanNodes.length ? `知识树孤立节点 ${orphanNodes.length}` : '',
  obsOrphans.length ? `观察树孤立节点 ${obsOrphans.length}` : '',
  siblingDup.length ? `知识树同级重名 ${siblingDup.length}` : '',
  obsDup.length ? `观察树同级重名 ${obsDup.length}` : '',
  tagOwnersMissing.length ? `坏 tag ${tagOwnersMissing.length}` : '',
  badObsRefs.length ? `观察坏引用 ${badObsRefs.length}` : '',
  obsNoPatterns.length ? `叶子无句式 ${obsNoPatterns.length}` : '',
  taxonomyMissingInKb.length ? `taxonomy 缺节点 ${taxonomyMissingInKb.length}` : '',
].filter(Boolean)

console.log(`\n数据文件：${store.file}`)
if (errors.length) {
  console.log(`完整性检查发现 ${errors.length} 个问题：${errors.join('；')}`)
  process.exitCode = 2
} else {
  console.log('完整性检查通过（缺精髓、未归类观察属于内容待补，不计为错误）。')
}
