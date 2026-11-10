/**
 * 业务层：工具与 Web 面板共用的所有操作。
 *
 * 每个方法的返回值都带一个 `summary` 字段——它是给模型看的纯文本，
 * 工具层直接 render 出来，省得模型再自己拼 JSON。
 */
import fs from 'node:fs'
import { CARD_LEVEL_LABEL, CARD_LEVELS, KINDS, KIND_LABEL, KbError, MASTERY, STUCK_LABEL, STUCK_STAGES, VERDICT_LABEL, VERDICTS, fail, nowIso } from './store.js'
import { TAXONOMY, tagLabel } from './taxonomy.js'
import { IDEA_ROOT, IDEA_TAXONOMY, IDEA_TREE } from './ideas.js'
import { OBS_ROOT, OBS_TAXONOMY, matchObsNodes } from './observation.js'
import { calibrate, compareFeatures, nearestProblem, problemFeatures, rankCandidates } from './similarity.js'
import {
  addNode,
  childrenMap,
  descendantIds,
  findNode,
  moveNode,
  nodeIndex,
  pathOf,
  removeNode,
  resolveNode,
  searchNodes,
  updateNode,
} from './tree.js'
import { analyze, collectSolved, recommendProblems } from './analysis.js'
import * as sync from './sync.js'

const MARK = { expert: '◆', strong: '●', ok: '◐', weak: '▲', poor: '▽', unknown: '○', unmeasured: '·' }
const LEVEL_TEXT = {
  expert: '非常熟练',
  strong: '熟练',
  ok: '还行',
  weak: '不熟练',
  poor: '非常不熟练',
  unknown: '空白',
  unmeasured: '未测',
}
// 「熟练度最低」的排序：空白 < 非常不熟练 < 不熟练 < 还行 < 熟练 < 非常熟练
const LEVEL_RANK = { unknown: 0, poor: 1, weak: 2, ok: 3, strong: 4, expert: 5 }

// 抽题面板要快：翻译最多等这么久，超时就先入库英文并排队等模型翻译。
const FAST_TRANSLATE_MS = 9000

async function translateFast(text, ms = FAST_TRANSLATE_MS) {
  const source = String(text || '').trim()
  if (!source) return ''
  // 宿主没有 translator 时，MyMemory 基本都在限流：直接排队等模型翻译，别拖慢抽题。
  if (!sync.hasTranslator()) return ''
  let timer = null
  try {
    return await Promise.race([
      sync.translateToChinese(source),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(''), ms)
      }),
    ])
  } catch (_) {
    return ''
  } finally {
    if (timer) clearTimeout(timer)
  }
}
// AtCoder 的题没有官方标签，判弱点时靠题面/题解里的英文词兜底；
// 这里给 CF tag 补一批常见的英文同义说法。
const EN_TAG_WORDS = {
  dp: ['dynamic programming', 'memoization', '動的計画', 'dp'],
  greedy: ['greedy', 'exchange argument', '貪欲'],
  'binary search': ['binary search', 'monotonic', 'monotone', '二分探索', 'にぶたん'],
  'data structures': ['segment tree', 'fenwick', 'binary indexed tree', 'union find', 'disjoint set', 'heap', 'treap', 'sparse table', 'セグメント木', '累積和', '優先度付きキュー'],
  graphs: ['graph', 'shortest path', 'dijkstra', 'bfs', 'dfs', 'lca', 'tree diameter', 'グラフ', '最短路', '頂点'],
  trees: ['tree', 'subtree', 'lca', '木', '部分木'],
  math: ['modulo', 'prime', 'gcd', 'lcm', 'factorization', 'divisor', '素因数', '約数', '余り', 'mod'],
  combinatorics: ['combinatorics', 'binomial', 'permutation', 'combination', '組合せ', '順列', '二項'],
  probabilities: ['probability', 'expected value', 'expectation', '期待値', '確率'],
  games: ['game', 'grundy', 'nim', 'ゲーム'],
  strings: ['string', 'suffix', 'prefix function', 'z algorithm', 'trie', 'palindrome', '文字列', '回文', '接尾辞'],
  geometry: ['geometry', 'convex hull', 'cross product', 'coordinate', '座標', '凸包', '幾何'],
  flows: ['flow', 'matching', 'min cut', 'max flow', '最大流', 'マッチング'],
  fft: ['fft', 'convolution', 'ntt', '畳み込み'],
  'meet-in-the-middle': ['meet in the middle', 'half enumeration', '半分全列挙'],
  bitmasks: ['bitmask', 'subset', '2^n', 'ビット'],
  interactive: ['interactive', 'query', 'query the judge', 'インタラクティブ'],
  implementation: ['simulation', 'implementation', 'シミュレーション', '実装'],
  'shortest paths': ['shortest path', 'dijkstra', 'bellman', '最短路'],
  dsu: ['union find', 'disjoint set', 'uf'],
  'two pointers': ['two pointers', 'sliding window', 'しゃく取り'],
  'divide and conquer': ['divide and conquer', 'divide & conquer', '分割統治'],
  'number theory': ['number theory', 'modular', 'euler', '整数論'],
  'expression parsing': ['expression', 'parse', 'parentheses', 'precedence', '括弧', '式'],
}
const IDEA_LEVEL_TEXT = {
  expert: '已内化成套路',
  strong: '已沉淀成体系',
  ok: '有苗头',
  weak: '只有零散记录',
  unknown: '还没记录',
}

// 题面里常是裸 LaTeX（从题解页面抓来的），翻成可读的纯文本给闪卡用。
const PLAIN_MATH = {
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', times: '×', cdot: '·', div: '÷',
  dots: '…', ldots: '…', cdots: '…', vdots: '⋮', ddots: '⋱', sum: '∑', prod: '∏', int: '∫',
  infty: '∞', to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', Leftarrow: '⇐',
  Leftrightarrow: '⇔', in: '∈', notin: '∉', subseteq: '⊆', subset: '⊂', supseteq: '⊇',
  cup: '∪', cap: '∩', pm: '±', mp: '∓', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  angle: '∠', perp: '⊥', parallel: '∥', mid: '|', approx: '≈', equiv: '≡', sim: '~',
  pmod: ' (mod ', bmod: ' mod ', log: 'log', ln: 'ln', max: 'max', min: 'min', gcd: 'gcd',
  lcm: 'lcm', sin: 'sin', cos: 'cos', tan: 'tan', mod: ' mod ', quad: ' ', qquad: ' ',
}

function plainMath(text) {  let out = String(text == null ? '' : text).replace(/\$+/g, '')
  out = out.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
  out = out.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
  out = out.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1')
  out = out.replace(/\\(?:left|right|big|Big|bigg|Bigg)\b/g, '')
  out = out.replace(/\\([A-Za-z]+)/g, (whole, name) => (PLAIN_MATH[name] !== undefined ? PLAIN_MATH[name] : name))
  out = out.replace(/\\[{}]/g, (whole) => whole[1])
  out = out.replace(/[{}]/g, '')
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

// 观察句式拆成「触发条件」：箭头可能在数学模式里（$\Rightarrow$），先去掉美元再切。
function triggerOf(text) {
  const plain = String(text == null ? '' : text).replace(/\$/g, '')
  const cut = plain.split(/\\(?:Rightarrow|rightarrow|to)\b|⇒|→|->|=>/)
  return cut[0].replace(/[，,、；;：:\s]+$/, '').trim()
}

// 题面只给前几段，够判断「这题要干什么」即可。
// 英文题面里的 A_i / 10^9 这类记号补成 $…$，让面板能排版；只动最保守的形状。
function wrapInlineMath(text) {
  return String(text == null ? '' : text)
    .replace(/\b([A-Za-z])_([A-Za-z0-9]+)\b/g, (m, base, sub) => `$${base}_{${sub}}$`)
    .replace(/(\d+)\^(\d+)/g, (m, base, exp) => `$${base}^{${exp}}$`)
    .replace(/\$([^$]*)\$([A-Za-z])/g, (m, math, tail) => `$${math}$ ${tail}`)
}

function briefStatement(text, limit = 700) {
  const source = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (source.length <= limit) return source
  const cut = source.slice(0, limit)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf('; '))
  return `${(stop > limit * 0.5 ? cut.slice(0, stop + 1) : cut).trim()} …`
}

const JUDGE_STOP = new Set([
  '可以', '我们', '一个', '所以', '这个', '那个', '如果', '就是', '需要', '然后', '因为', '不是',
  '没有', '时候', '这些', '那些', '问题', '答案', '题目', '方向', '思路', '每个', '所有', '以及',
  '进行', '得到', '只能', '一定', '直接', '还是', '这样', '那么', '这里', '其中', '对于', '即可',
])

// 把中文/公式拆成可比较的 token：ASCII 词 + 中文二元组；用于面板内自动判方向。
function judgeTokens(text) {
  const tokens = new Set()
  const plain = String(text == null ? '' : text)
    .replace(/\$+/g, ' ')
    .replace(/\\[A-Za-z]+/g, ' ')
    .toLowerCase()
  for (const chunk of plain.split(/[^0-9a-z\u4e00-\u9fff]+/)) {
    if (!chunk) continue
    if (/^[a-z]+[0-9]*$/.test(chunk) || /^[0-9]+$/.test(chunk)) {
      if (chunk.length >= 2) tokens.add(chunk)
      continue
    }
    if (!/[\u4e00-\u9fff]/.test(chunk)) continue
    for (let index = 0; index + 2 <= chunk.length; index += 1) {
      const gram = chunk.slice(index, index + 2)
      if (/^[\u4e00-\u9fff]{2}$/.test(gram) && !JUDGE_STOP.has(gram)) tokens.add(gram)
    }
  }
  return tokens
}

function judgeChars(text) {
  const chars = new Set()
  for (const char of String(text == null ? '' : text)) {
    if (/[\u4e00-\u9fff]/.test(char)) chars.add(char)
  }
  return chars
}

function displayTitle(problem) {
  return (problem && (problem.titleZh || problem.title)) || ''
}

const KIND_ALIASES = {
  observation: 'observation',
  观察: 'observation',
  性质: 'observation',
  关键性质: 'observation',
  trick: 'trick',
  套路: 'trick',
  技巧: 'trick',
  idea: 'idea',
  思路: 'idea',
  通用思路: 'idea',
  推导: 'idea',
  推导思路: 'idea',
  direction: 'direction',
  方向: 'direction',
  思考方向: 'direction',
  pitfall: 'pitfall',
  坑: 'pitfall',
  坑点: 'pitfall',
  易错: 'pitfall',
}

function normalizeKind(value) {
  const key = String(value ?? '').trim()
  const hit = KIND_ALIASES[key] || KIND_ALIASES[key.toLowerCase()]
  if (hit) return hit
  fail(`洞察类型「${key}」不认识。可选：${KINDS.map((kind) => `${kind}(${KIND_LABEL[kind]})`).join('、')}`)
}

export function normalizePlatform(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === '' || text === 'other') return 'other'
  if (text === 'cf' || text === 'codeforces') return 'codeforces'
  if (text === 'at' || text === 'atc' || text === 'atcoder') return 'atcoder'
  if (text === 'lg' || text === 'luogu' || text === '洛谷') return 'luogu'
  return text
}

export function parseProblemUrl(input) {
  const text = String(input ?? '')
  let matched = text.match(/codeforces\.com\/(?:problemset\/problem|contest)\/(\d+)\/(?:problem\/)?([A-Za-z0-9]+)/)
  if (matched) {
    const index = matched[2].toUpperCase()
    return { platform: 'codeforces', key: `${matched[1]}${index}`, contestId: Number(matched[1]), index }
  }
  matched = text.match(/atcoder\.jp\/contests\/([^/]+)\/tasks\/([^/?#]+)/)
  if (matched) return { platform: 'atcoder', key: matched[2], contestId: matched[1] }
  matched = text.match(/atcoder\.jp\/tasks\/([^/?#]+)/)
  if (matched) return { platform: 'atcoder', key: matched[1] }
  matched = text.match(/luogu\.(?:com\.cn|com)\/problem\/([A-Za-z0-9_]+)/)
  if (matched) return { platform: 'luogu', key: matched[1].toUpperCase() }
  matched = text.match(/^([A-Za-z]+):([A-Za-z0-9_-]+)$/)
  if (matched) return { platform: normalizePlatform(matched[1]), key: matched[2] }
  return null
}

function formatPct(value) {
  return `${Math.round((value || 0) * 100)}%`
}

function patternText(pattern) {
  return typeof pattern === 'string' ? pattern : String(pattern?.text || '')
}

function patternVerified(pattern) {
  return typeof pattern === 'object' && pattern !== null && pattern.verified === true
}

// 观察节点的熟练度：真题观察条数、涉及题目数、有证据的句式数三者一起看。
function obsLevelOf(observations, problems, verified) {
  if (!observations && !problems && !verified) return 'unknown'
  if (verified >= 3 && problems >= 10) return 'expert'
  if (verified >= 2 && problems >= 5) return 'strong'
  if (observations >= 8 || problems >= 4) return 'ok'
  if (observations >= 3) return 'weak'
  return 'poor'
}

function isAncestorOf(kb, ancestorId, nodeId) {
  const index = nodeIndex(kb)
  let current = kb.nodes.find((node) => node.id === nodeId) || null
  while (current && current.parent) {
    if (current.parent === ancestorId) return true
    current = index.get(current.parent) || null
  }
  return false
}

function nodeLabel(row) {
  if (row.tree === 'idea') {
    const bits = []
    if (row.linkedProblems) bits.push(`${row.linkedProblems} 题`)
    if (row.insightCount) bits.push(`${row.insightCount} 条洞察`)
    const suffix = bits.length ? `  [${bits.join(' · ')}]` : '  [未记录]'
    return `${MARK[row.level] || '○'} ${row.name}${suffix}`
  }
  const bits = []
  if (row.solvedCount) bits.push(`${row.solvedCount} 题`)
  if (row.p75 != null) bits.push(`~${Math.round(row.p75)}`)
  if (row.insightCount) bits.push(`${row.insightCount} 条洞察`)
  if (row.unsolvedCount) bits.push(`✕${row.unsolvedCount}`)
  const suffix = bits.length ? `  [${bits.join(' · ')}]` : row.level === 'unmeasured' ? '  [未测]' : '  [空白]'
  return `${MARK[row.level] || '○'} ${row.name}${suffix}`
}

function solvedCountFor(kb, account) {
  const own = Object.keys(kb.solved?.[account.platform]?.[account.handle] || {}).length
  // 洛谷的 CF/AT 镜像题按原平台分桶、沿用本账号 handle；只有该平台没有同名真实账号时才算镜像。
  let mirrored = 0
  for (const [platform, bucket] of Object.entries(kb.solved || {})) {
    if (platform === account.platform || !bucket || !bucket[account.handle]) continue
    const hasRealAccount = (kb.accounts || []).some(
      (item) => item.platform === platform && item.handle.toLowerCase() === account.handle.toLowerCase(),
    )
    if (!hasRealAccount) mirrored += Object.keys(bucket[account.handle]).length
  }
  return { own, mirrored, total: own + mirrored }
}

export class KnowledgeService {
  constructor(store) {
    this.store = store
    this._analysis = null
    this._analysisAt = -1
  }

  kb() {
    return this.store.read()
  }

  invalidate() {
    this._analysis = null
  }

  analysis() {
    if (!this._analysis || this._analysisAt !== this.store.revision) {
      this._analysis = analyze(this.kb())
      this._analysisAt = this.store.revision
    }
    return this._analysis
  }

  mutate(fn) {
    try {
      return this.store.mutate(fn)
    } finally {
      // 成功要刷新缓存；失败时数据已回滚，但分析缓存也可能引用半改对象，一并作废。
      this.invalidate()
    }
  }

  // ── 种子 ────────────────────────────────────────────────────────────────

  /**
   * 观察树单独存放在 kb.obsNodes：和算法/思路节点重名也不会互相污染。
   * 按 OBS_TAXONOMY 的路径顺序建，父节点先于子节点出现。
   */
  seedObservationTree(kb) {
    const created = []
    const filled = []
    const used = new Map() // path -> node
    for (const [pathStr, spec] of OBS_TAXONOMY) {
      const segments = pathStr.split('/')
      const name = segments[segments.length - 1]
      const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : null
      const parent = parentPath ? used.get(parentPath) || null : null
      let node = kb.obsNodes.find((item) => item.name === name && (item.parent || null) === (parent?.id || null))
      if (!node) {
        node = {
          id: this.store.nextId(kb, 'o'),
          parent: parent?.id || null,
          name,
          kind: segments.length === 1 ? 'domain' : segments.length === 2 ? 'topic' : 'concept',
          summary: spec.summary || '',
          signals: [...(spec.signals || [])],
          aliases: [...(spec.aliases || [])],
          patterns: [...(spec.patterns || [])],
          tree: 'obs',
          order: created.length,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        kb.obsNodes.push(node)
        created.push(pathStr)
      } else {
        if (!node.summary && spec.summary) {
          node.summary = spec.summary
          filled.push(pathStr)
        }
        if ((spec.aliases || []).length) {
          // 不覆盖手写别名：内置别名只做并集补全。
          const merged = [...new Set([...(node.aliases || []), ...spec.aliases])]
          if (JSON.stringify(node.aliases || []) !== JSON.stringify(merged)) {
            node.aliases = merged
            filled.push(`${pathStr}.aliases`)
          }
        }
        if ((spec.patterns || []).length && !(node.patterns || []).some((item) => typeof item === 'object')) {
          const nextPatterns = spec.patterns.map((text) => ({ text, examples: [], verified: false }))
          if (JSON.stringify(node.patterns || []) !== JSON.stringify(nextPatterns)) {
            node.patterns = nextPatterns
            filled.push(`${pathStr}.patterns`)
          }
        }
      }
      used.set(pathStr, node)
    }
    return { created, filled }
  }

  ensureTaxonomy(kb) {
    const created = []
    const filled = []
    const seedTree = (entries, tree) => {
      const specByPath = new Map(entries.map(([p, spec]) => [p, spec]))
      const ensure = (pathStr) => {
        const segments = pathStr.split('/')
        let currentPath = ''
        let node = null
        for (let i = 0; i < segments.length; i += 1) {
          currentPath = currentPath ? `${currentPath}/${segments[i]}` : segments[i]
          const existing = findNode(kb, currentPath)
          if (existing) {
            node = existing
            continue
          }
          const spec = specByPath.get(currentPath) || {}
          const parentPath = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : null
          node = addNode(
            kb,
            {
              parent: parentPath,
              name: segments[i],
              kind: i === 0 ? 'domain' : i === 1 ? 'topic' : 'concept',
              summary: spec.summary || '',
              signals: spec.signals || [],
              aliases: spec.aliases || [],
              tree,
            },
            (target, prefix) => this.store.nextId(target, prefix),
          )
          created.push(currentPath)
        }
        return node
      }

      for (const [pathStr, spec] of entries) {
        const node = ensure(pathStr)
        if (node.summary === '' && spec.summary) {
          node.summary = spec.summary
          filled.push(`${pathStr}.summary`)
        }
        if ((node.signals || []).length === 0 && spec.signals) {
          node.signals = [...spec.signals]
          filled.push(`${pathStr}.signals`)
        }
        if ((node.aliases || []).length === 0 && spec.aliases) {
          node.aliases = [...spec.aliases]
          filled.push(`${pathStr}.aliases`)
        }
      }
    }

    seedTree(TAXONOMY, undefined)
    seedTree(IDEA_TAXONOMY, IDEA_TREE)
    const obs = this.seedObservationTree(kb)
    created.push(...obs.created)
    filled.push(...obs.filled)

    // 第二遍：tag 归「最具体」的节点（只走算法树，思路节点不承接 CF 标签）。
    // 领域节点先出现、子节点后出现，所以后出现的更具体；已有的手工映射（不属于该节点祖先链）保持不动。
    for (const [pathStr, spec] of TAXONOMY) {
      const node = findNode(kb, pathStr)
      if (!node) continue
      for (const tag of spec.tags || []) {
        const ownerId = kb.meta.tagMap[tag]
        const ownerExists = ownerId && kb.nodes.some((item) => item.id === ownerId)
        if (!ownerExists || isAncestorOf(kb, ownerId, node.id)) kb.meta.tagMap[tag] = node.id
      }
    }
    // 清理 CF 题库里根本不存在的 tag 映射（历史遗留会误导推荐），
    // 只有拿到题库缓存时才敢删，否则保持原样。
    const problemset = this.store.readCache('cf-problemset.json', 30 * 24 * 3600 * 1000)
    if (problemset?.problems?.length) {
      const poolTags = new Set()
      for (const problem of problemset.problems) for (const tag of problem.tags || []) poolTags.add(tag)
      for (const tag of Object.keys(kb.meta.tagMap)) {
        if (!poolTags.has(tag)) delete kb.meta.tagMap[tag]
      }
    }
    kb.meta.lastSeedAt = new Date().toISOString()
    return { created, filled }
  }

  seed() {
    const result = this.mutate((kb) => this.ensureTaxonomy(kb))
    const kb = this.kb()
    const rows = [
      `已就绪：新建 ${result.created.length} 个知识点，补全 ${result.filled.length} 处说明；当前共 ${kb.nodes.length} 个节点，tag 映射 ${Object.keys(kb.meta.tagMap).length} 条。`,
    ]
    if (result.created.length) rows.push('', '新建节点：', ...result.created.map((pathStr) => `- ${pathStr}`))
    return { summary: rows.join('\n'), created: result.created, filled: result.filled.length, nodes: kb.nodes.length }
  }

  // ── 树 ──────────────────────────────────────────────────────────────────

  tree(options = {}) {
    const kb = this.kb()
    const analysis = this.analysis()
    const treeKind = options.tree === 'idea' ? 'idea' : options.tree === 'all' ? 'all' : 'algo'
    const matchTree = (node) =>
      treeKind === 'all' ? true : treeKind === 'idea' ? node.tree === 'idea' : node.tree !== 'idea'
    const rootNode = options.root ? resolveNode(kb, options.root) : null
    const depthLimit = Number.isFinite(options.depth) ? Math.max(1, Number(options.depth)) : 99
    const children = childrenMap(kb)
    const lines = []

    const walk = (parentId, prefix, level) => {
      const list = (children.get(parentId) || []).filter(matchTree)
      list.forEach((node, index) => {
        const isLast = index === list.length - 1
        const row = analysis.rowsById.get(node.id) || { name: node.name, level: 'unknown', solvedCount: 0 }
        const branch = `${prefix}${isLast ? '└─ ' : '├─ '}`
        lines.push(`${branch}${nodeLabel(row)}`)
        const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`
        if (level + 1 < depthLimit) walk(node.id, childPrefix, level + 1)
        else if ((children.get(node.id) || []).filter(matchTree).length) lines.push(`${childPrefix}…`)
      })
    }

    const algoCount = kb.nodes.filter((node) => node.tree !== 'idea').length
    const ideaCount = kb.nodes.filter((node) => node.tree === 'idea').length
    if (rootNode) {
      const row = analysis.rowsById.get(rootNode.id)
      lines.push(nodeLabel(row))
      walk(rootNode.id, '', 0)
    } else {
      if (treeKind === 'idea') {
        lines.push(`思路树（${ideaCount} 个节点）——记录每道题「是怎么想出来的」，有洞察才有内容`)
      } else {
        lines.push(`知识点总览（${algoCount} 个节点，已覆盖 ${analysis.overview.covered}/${analysis.overview.nodes}）`)
        if (ideaCount && treeKind === 'algo') lines.push(`另有「思路树」${ideaCount} 个节点：oi_kb action=tree tree=idea`)
      }
      walk(null, '', 0)
    }
    if (treeKind === 'idea') {
      lines.push('', '图例：◆ 已内化  ● 已沉淀  ◐ 有苗头  ▲ 只有零散记录  ○ 未记录；[关联题数 · 洞察数]')
    } else {
      lines.push(
        '',
        '图例：◆ 非常熟练  ● 熟练  ◐ 还行  ▲ 不熟练  ▽ 非常不熟练  ○ 空白  · 账号数据测不到；[题数 · 75 分位难度 · 洞察数 · 未解决数]',
      )
    }
    return {
      summary: lines.join('\n'),
      overview: analysis.overview,
      nodes: analysis.rows
        .filter((row) => matchTree(kb.nodes.find((node) => node.id === row.id) || {}))
        .map((row) => ({ id: row.id, name: row.name, path: row.path, level: row.level, score: row.score })),
    }
  }

  findObsNode(kb, ref) {
    const raw = String(ref ?? '').trim()
    if (!raw) return null
    const nodes = kb.obsNodes || []
    const byId = new Map(nodes.map((node) => [node.id, node]))
    if (byId.has(raw)) return byId.get(raw)
    const norm = (value) =>
      String(value || '')
        .replace(/\s*\/\s*/g, '/')
        .replace(/^观察\//, '')
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase()
    const target = norm(raw)
    if (!target) return null
    const byPath = nodes.filter((node) => node.parent && norm(this.obsPath(kb, node.id)) === target)
    if (byPath.length === 1) return byPath[0]
    const byName = nodes.filter((node) => norm(node.name) === target)
    if (byName.length === 1) return byName[0]
    return byPath[0] || byName[0] || null
  }

  showObsNode(kb, node) {
    const all = kb.obsNodes || []
    const descendants = new Set([node.id])
    let grew = true
    while (grew) {
      grew = false
      for (const item of all) {
        if (item.parent && descendants.has(item.parent) && !descendants.has(item.id)) {
          descendants.add(item.id)
          grew = true
        }
      }
    }
    const path = this.obsPath(kb, node.id)
    const rows = []
    for (const problem of kb.problems) {
      for (const insight of problem.insights) {
        if (insight.kind !== 'observation') continue
        if (!(insight.obsNodes || []).some((id) => descendants.has(id))) continue
        rows.push({ problem, insight, key: (problem.keyObservations || []).includes(insight.id) })
      }
    }
    const children = all.filter((item) => item.parent === node.id)
    const direct = rows.filter((row) => (row.insight.obsNodes || []).includes(node.id))
    const problemCount = new Set(rows.map((row) => row.problem.id)).size
    const subtreeVerified = all
      .filter((item) => descendants.has(item.id))
      .reduce((sum, item) => sum + (item.patterns || []).filter(patternVerified).length, 0)
    const level = obsLevelOf(rows.length, problemCount, subtreeVerified)
    const lines = [`## ${path}`, `${MARK[level]} 观察 ${rows.length} 条（直接挂在这里 ${direct.length} 条，涉及 ${problemCount} 道题，有证据句式 ${subtreeVerified} 条）`]
    if (node.summary) lines.push('', `说明：${node.summary}`)
    if (node.signals?.length) lines.push('', '识别信号：', ...node.signals.map((signal) => `- ${signal}`))
    if (node.patterns?.length) {
      const verified = node.patterns.filter(patternVerified).length
      lines.push('', `## 常见观察句式（${node.patterns.length} 条，有证据 ${verified} 条）`)
      for (const pattern of node.patterns) {
        const text = patternText(pattern)
        const evidence = (pattern.examples || []).map((example) => example.title).filter(Boolean)
        lines.push(`- ${patternVerified(pattern) ? '' : '[未验证] '}${text}${evidence.length ? `　例：${evidence.slice(0, 2).join('、')}` : ''}`)
      }
    }
    if (children.length) {
      lines.push('', '## 子方向')
      for (const child of children) {
        const subtree = new Set([child.id])
        let expanded = true
        while (expanded) {
          expanded = false
          for (const item of all) {
            if (item.parent && subtree.has(item.parent) && !subtree.has(item.id)) {
              subtree.add(item.id)
              expanded = true
            }
          }
        }
        const hits = rows.filter((row) => (row.insight.obsNodes || []).some((id) => subtree.has(id))).length
        lines.push(`- ${child.name} · ${hits} 条${child.summary ? `：${child.summary}` : ''}`)
      }
    }
    const evidenceProblems = []
    for (const pattern of node.patterns || []) {
      for (const example of pattern && pattern.examples ? pattern.examples : []) {
        const problem = kb.problems.find((item) => item.id === example.id || item.key === example.id)
        if (problem && !evidenceProblems.some((item) => item.id === problem.id)) evidenceProblems.push(problem)
      }
    }
    if (rows.length || evidenceProblems.length) {
      if (rows.length) {
        lines.push('', '## 相关的观察')
        for (const row of rows.slice(0, 30)) {
          lines.push(
            `- ${row.key ? '★ ' : ''}${row.insight.text}　—《${displayTitle(row.problem)}》（${row.problem.platform} ${row.problem.key}）`,
          )
        }
      }
      const problems = [...new Map(rows.map((row) => [row.problem.id, row.problem])).values()]
      for (const problem of evidenceProblems) {
        if (!problems.some((item) => item.id === problem.id)) problems.push(problem)
      }
      lines.push('', `## 涉及题目（${problems.length}）`)
      for (const problem of problems.slice(0, 20)) {
        lines.push(`- ${displayTitle(problem)}（${problem.key}${problem.rating ? `，${problem.rating}` : ''}）`)
      }
    } else {
      lines.push('', '这个观察还没有任何题目挂上来。录题时把 observation 挂到它上面，或在 oi_problem action=add_insight 里写 obsNodes。')
    }
    return { summary: lines.join('\n'), obsNode: node, path, count: rows.length }
  }

  showNode(input) {
    const kb = this.kb()
    let node = null
    try {
      node = resolveNode(kb, input.node)
    } catch (error) {
      const obs = this.findObsNode(kb, input.node)
      if (obs) return this.showObsNode(kb, obs)
      throw error
    }
    const analysis = this.analysis()
    const row = analysis.rowsById.get(node.id)
    const path = pathOf(kb, node)
    const lines = []
    lines.push(`## ${path}`)
    if (row.tree === 'idea') {
      lines.push(
        `${MARK[row.level]} ${IDEA_LEVEL_TEXT[row.level] || row.level} · 关联题目 ${row.linkedProblems || 0} 道 · 洞察 ${row.insightCount} 条`,
      )
      if (row.insightKinds?.length) {
        lines.push(`已覆盖的洞察类型：${row.insightKinds.map((kind) => KIND_LABEL[kind] || kind).join('、')}`)
      }
    } else {
      lines.push(
        `${MARK[row.level]} ${LEVEL_TEXT[row.level]}（75 分位 ${row.p75 != null ? Math.round(row.p75) : '—'}）· 已解决 ${row.solvedCount} · 试过未过 ${row.attemptedCount} · 未解决 ${row.unsolvedCount} · 洞察 ${row.insightCount} 条`,
      )
      if (row.p75 != null) lines.push(`难度：75 分位 ${Math.round(row.p75)}，最高 ${row.maxRating}`)
    }
    if (row.summary) lines.push('', `说明：${row.summary}`)
    if (row.signals?.length) lines.push('', '识别信号：', ...row.signals.map((signal) => `- ${signal}`))
    if (row.note) lines.push('', `笔记：${row.note}`)
    if (row.reasons?.length) lines.push('', '为什么算弱点/盲区：', ...row.reasons.map((reason) => `- ${reason}`))

    if (row.tree !== 'idea') {
      const ownedTags = Object.keys(kb.meta.tagMap || {}).filter((tag) => kb.meta.tagMap[tag] === node.id)
      if (ownedTags.length) {
        const pool = this.cfTagPool()
        const solvedItems = collectSolved(kb)
        lines.push('', '## 数据来源')
        for (const tag of ownedTags) {
          const total = pool.get(tag) || 0
          const hit = solvedItems.filter((item) => (item.tags || []).includes(tag)).length
          lines.push(`- ${tagLabel(tag)}（\`${tag}\`）：Codeforces 题库共 ${total} 道带此标签，你已通过 ${hit} 道`)
        }
        lines.push('  AtCoder / 洛谷的同步记录不提供题目标签，所以不会计入这些数字。')
      }
    }

    const subtreeIds = new Set([node.id])
    let frontier = [node.id]
    while (frontier.length) {
      const next = []
      for (const candidate of kb.nodes) {
        if (candidate.parent && frontier.includes(candidate.parent) && !subtreeIds.has(candidate.id)) {
          subtreeIds.add(candidate.id)
          next.push(candidate.id)
        }
      }
      frontier = next
    }
    const touches = (problem, ids) =>
      problem.nodes.some((id) => ids.has(id)) || problem.insights.some((insight) => insight.nodes.some((id) => ids.has(id)))
    const directIds = new Set([node.id])
    const directProblems = kb.problems.filter((problem) => touches(problem, directIds))
    const linkedProblems = kb.problems.filter((problem) => touches(problem, subtreeIds))
    if (linkedProblems.length) {
      const head =
        linkedProblems.length > directProblems.length
          ? `## 相关题目（${linkedProblems.length} 道，本节点直接挂 ${directProblems.length} 道，其余在子节点）`
          : `## 相关题目（${linkedProblems.length} 道）`
      lines.push('', head)
      for (const problem of linkedProblems.slice(0, 20)) {
        const viaChild = !directProblems.includes(problem)
        lines.push(
          `- ${displayTitle(problem)}（${problem.platform} ${problem.key}，${VERDICT_LABEL[problem.verdict]}${problem.rating ? `，${problem.rating}` : ''}）${viaChild ? ' · 子节点' : ''}`,
        )
      }
      if (linkedProblems.length > 20) lines.push(`- ……另有 ${linkedProblems.length - 20} 道`)
    }

    const grouped = new Map(KINDS.map((kind) => [kind, []]))
    for (const insight of row.insights) grouped.get(insight.kind)?.push(insight)
    for (const kind of KINDS) {
      const list = grouped.get(kind) || []
      if (!list.length) continue
      lines.push('', `## ${KIND_LABEL[kind]}（${list.length}）`)
      for (const insight of list.slice(0, 30)) {
        lines.push(`- ${insight.text}${insight.problemTitle ? `　—《${insight.problemTitle}》` : ''}`)
      }
    }
    if (row.tree === 'idea' && (row.insightCount || 0) === 0) {
      lines.push('', '这道思路还没有任何记录。录题时用 oi_problem action=add_insight，把观察/套路/推导写进来，并挂到这个节点上——思路树靠这样长起来。')
    } else if (row.solvedCount === 0 && row.insightCount === 0) {
      lines.push('', '这个节点还没有任何证据。要么补题，要么把相关题挂上来。')
    }
    return { summary: lines.join('\n'), node: row, path, problems: linkedProblems.map((problem) => problem.id) }
  }

  addNode(input) {
    const kb = this.kb()
    const result = this.mutate((target) =>
      addNode(
        target,
        {
          parent: input.parent,
          name: input.name,
          kind: input.kind,
          summary: input.summary ?? '',
          signals: input.signals ?? [],
          aliases: input.aliases ?? [],
          note: input.note ?? '',
          mastery: input.mastery ?? 'auto',
        },
        (storeKb, prefix) => this.store.nextId(storeKb, prefix),
      ),
    )
    const path = pathOf(this.kb(), this.kb().nodes.find((node) => node.id === result.id))
    return { summary: `已新建知识点「${path}」（id ${result.id}）。下一步可以用 oi_kb action=update 补说明，或 oi_problem action=add 把题目挂上来。`, node: result, path }
  }

  updateNode(input) {
    const kb = this.kb()
    const patch = {}
    for (const key of ['name', 'kind', 'summary', 'note', 'signals', 'aliases', 'mastery']) {
      if (input[key] !== undefined) patch[key] = input[key]
    }
    if (Object.keys(patch).length === 0) fail('没有要改的字段（name/summary/signals/note/mastery/kind）')
    if (patch.mastery !== undefined && !MASTERY.includes(patch.mastery)) {
      fail(`mastery 只能是 ${MASTERY.join('/')}`)
    }
    const node = this.mutate((target) => updateNode(target, resolveNode(target, input.node), patch))
    const path = pathOf(this.kb(), this.kb().nodes.find((item) => item.id === node.id))
    return { summary: `已更新「${path}」。`, node, path }
  }

  moveNode(input) {
    const kb = this.kb()
    const node = resolveNode(kb, input.node)
    const parent = input.parent ? resolveNode(kb, input.parent) : null
    const moved = this.mutate((target) =>
      moveNode(target, resolveNode(target, input.node), input.parent ? resolveNode(target, input.parent) : null),
    )
    return { summary: `已把「${node.name}」移动到「${parent ? parent.name : '根'}」下面。`, node: moved }
  }

  removeNode(input) {
    const kb = this.kb()
    const node = resolveNode(kb, input.node)
    const mode = input.mode === 'reparent' ? 'reparent' : 'subtree'
    const path = pathOf(kb, node)
    const result = this.mutate((target) => {
      const targetNode = resolveNode(target, input.node)
      // reparent 时，直接挂在这个节点上的题与洞察要改挂到父节点，避免挂载丢失。
      if (mode === 'reparent' && targetNode.parent) {
        const parentId = targetNode.parent
        const remap = (ids) => [...new Set((ids || []).map((id) => (id === targetNode.id ? parentId : id)))]
        for (const problem of target.problems) {
          problem.nodes = remap(problem.nodes)
          for (const insight of problem.insights || []) insight.nodes = remap(insight.nodes)
        }
      }
      return removeNode(target, targetNode, mode)
    })
    const summary =
      mode === 'reparent'
        ? `已删除「${path}」。${result.reparented} 个直接子节点改挂到上一级；直接挂在本节点的题目/洞察也迁移到上一级，挂载保留。`
        : `已删除「${path}」及其全部子节点（共 ${result.removed} 个节点）。相关题目的挂载点已一并清掉。`
    return { summary, removed: result.removed, reparented: result.reparented }
  }

  searchNodes(input) {
    const kb = this.kb()
    const hits = searchNodes(kb, input.query, input.limit ?? 20)
    if (!hits.length) return { summary: `没有匹配「${input.query}」的知识点。`, nodes: [] }
    const analysis = this.analysis()
    return {
      summary: hits.map((node) => `- ${nodeLabel(analysis.rowsById.get(node.id))}（id ${node.id}）`).join('\n'),
      nodes: hits.map((node) => ({ id: node.id, path: pathOf(kb, node) })),
    }
  }

  mapTag(input) {
    const kb = this.kb()
    const tag = String(input.tag ?? '').trim().toLowerCase()
    if (!tag) fail('tag 不能为空（Codeforces 的标签，如 dp / graphs / binary search）')
    if (!input.node) {
      const existed = kb.meta.tagMap[tag]
      if (!existed) return { summary: `tag「${tag}」本来就没有映射。` }
      this.mutate((target) => {
        delete target.meta.tagMap[tag]
      })
      return { summary: `已删除 tag「${tag}」的映射。` }
    }
    const node = resolveNode(kb, input.node)
    this.mutate((target) => {
      target.meta.tagMap[tag] = node.id
    })
    return { summary: `已把 tag「${tag}」(${tagLabel(tag)}) 映射到「${pathOf(kb, node)}」。以后同步到带这个 tag 的题会自动记到该节点。` }
  }

  linkProblem(input) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const node = resolveNode(kb, input.node)
    if (problem.nodes.includes(node.id)) return { summary: `「${displayTitle(problem)}」本来就挂着「${node.name}」。` }
    this.mutate((target) => {
      const entity = this.resolveProblem(target, problem.id)
      entity.nodes.push(node.id)
      entity.updatedAt = new Date().toISOString()
    })
    return { summary: `已把「${displayTitle(problem)}」挂到「${pathOf(kb, node)}」。` }
  }

  unlinkProblem(input) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const node = resolveNode(kb, input.node)
    this.mutate((target) => {
      const entity = this.resolveProblem(target, problem.id)
      entity.nodes = entity.nodes.filter((id) => id !== node.id)
      for (const insight of entity.insights) insight.nodes = insight.nodes.filter((id) => id !== node.id)
    })
    return { summary: `已把「${displayTitle(problem)}」从「${pathOf(kb, node)}」上摘掉。` }
  }

  // ── 题目 ────────────────────────────────────────────────────────────────

  resolveProblem(kb, ref) {
    const raw = String(ref ?? '').trim()
    if (raw === '') fail('缺少题目参数（题目 id、platform:key 或题目链接）')
    const byId = kb.problems.find((problem) => problem.id === raw)
    if (byId) return byId
    const parsed = parseProblemUrl(raw)
    if (parsed) {
      const hit = kb.problems.find((problem) => problem.platform === parsed.platform && problem.key === parsed.key)
      if (hit) return hit
    }
    const byKey = kb.problems.filter((problem) => problem.key.toLowerCase() === raw.toLowerCase())
    if (byKey.length === 1) return byKey[0]
    if (byKey.length > 1) fail(`有多道题的 key 是「${raw}」，请写成 platform:key（如 codeforces:${raw}）`)
    fail(`库里没有这道题（「${raw}」）。先用 oi_problem action=add 录入。`)
  }

          // 洛谷镜像题会带原平台题号：把 Codeforces 题库缓存里的标签/难度借过来
          enrichMirroredProblems(items) {
    if (!items.some((item) => item.platform === 'codeforces')) return items
    // 一次读出题库建索引：洛谷镜像可能几百道，逐条 readCache + parse 会拖到超时。
    let index = null
    try {
      const cache = this.store.readCache('cf-problemset.json')
      if (cache?.problems) {
        index = new Map(cache.problems.map((problem) => [`${problem.contestId}${problem.index}`, problem]))
      }
    } catch (_) {
      index = null
    }
    if (!index) return items
    for (const item of items) {
      if (item.platform !== 'codeforces') continue
      const cached = index.get(item.key)
      if (!cached) continue
      item.title = cached.name || item.title
      if (cached.rating != null) item.rating = cached.rating
      if (cached.tags?.length) item.tags = cached.tags
    }
    return items
  }

          lookupCachedCfProblem(key) {
    try {
      const cache = this.store.readCache('cf-problemset.json')
      if (!cache?.problems) return null
      return cache.problems.find((problem) => `${problem.contestId}${problem.index}` === key) || null
    } catch (_) {
      return null
    }
  }

  /** 每个 Codeforces 标签在题库里有多少道题（用于解释「为什么这个方向是 0 题」）。 */
  cfTagPool() {
    const cache = this.store.readCache('cf-problemset.json', 365 * 24 * 3600 * 1000)
    const problems = cache && Array.isArray(cache.problems) ? cache.problems : []
    const counts = new Map()
    for (const problem of problems) {
      for (const tag of problem.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1)
    }
    return counts
  }

  detectNodes(text) {
    const kb = this.kb()
    const haystack = String(text ?? '')
    if (haystack === '') return []
    const hits = []
    for (const node of kb.nodes) {
      // 「思路」这个根节点名字太泛，几乎每段洞察都会提到，不参与自动挂载。
      if (node.tree === 'idea' && !node.parent) continue
      const names = [node.name, ...(node.aliases || [])]
      if (names.some((name) => name.length >= 2 && haystack.includes(name))) hits.push(node)
    }
    return hits
  }

  /** 观察树节点也用名字/别名匹配正文，但只在 kb.obsNodes 里找，不和思路树抢名字。 */
  detectObsNodes(text) {
    const kb = this.kb()
    const haystack = String(text ?? '')
    if (haystack === '') return []
    const hits = []
    for (const node of kb.obsNodes) {
      if (!node.parent) continue
      const names = [node.name, ...(node.aliases || [])]
      if (names.some((name) => name.length >= 2 && haystack.includes(name))) hits.push(node)
    }
    return hits
  }

  obsPath(kb, id) {
    const index = new Map((kb.obsNodes || []).map((node) => [node.id, node]))
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

  /**
   * 精髓观察：这题分析里最久/最难的那一步。
   * 优先用显式 key=true，其次按观察洞察的 text 长度取前 3（推导链越长通常卡得越久）。
   */
  computeKeyObservations(problem) {
    const observations = (problem.insights || []).filter((insight) => insight.kind === 'observation')
    const explicit = observations.filter((insight) => insight.key)
    const pool = explicit.length ? explicit : [...observations].sort((a, b) => b.text.length - a.text.length)
    const ids = []
    for (const insight of pool) {
      if (ids.length >= 3) break
      ids.push(insight.id)
    }
    problem.keyObservations = ids
    return ids
  }

  normalizeInsight(raw, problem) {
    const text = String(raw?.text ?? '').trim()
    if (text === '') fail('洞察内容不能为空')
    const kind = normalizeKind(raw.kind ?? raw.type ?? 'idea')
    const kb = this.kb()
    const nodes = []
    const obsNodes = []
    for (const ref of raw.nodes || []) {
      let resolved = null
      let resolveError = null
      try {
        resolved = resolveNode(kb, ref)
      } catch (error) {
        resolveError = error
      }
      if (resolved) {
        if (!nodes.includes(resolved.id)) nodes.push(resolved.id)
        continue
      }
      const obs = this.findObsNode(kb, ref)
      if (!obs) {
        if (resolveError) throw resolveError
        fail(`找不到节点「${ref}」：知识/思路树和观察树里都没有这个名字`)
      }
      if (!obsNodes.includes(obs.id)) obsNodes.push(obs.id)
    }
    if (!nodes.length) {
      for (const node of this.detectNodes(text)) if (!nodes.includes(node.id)) nodes.push(node.id)
    }
    for (const ref of raw.obsNodes || []) {
      const obs = this.findObsNode(kb, ref)
      if (!obs) fail(`观察树里没有「${ref}」：先用 oi_kb action=obs_tree 看清名字`)
      if (!obsNodes.includes(obs.id)) obsNodes.push(obs.id)
    }
    if (!obsNodes.length) {
      for (const node of this.detectObsNodes(text)) if (!obsNodes.includes(node.id)) obsNodes.push(node.id)
    }
    return {
      id: raw.id || '',
      kind,
      text,
      nodes,
      obsNodes,
      key: kind === 'observation' && raw.key === true,
      createdAt: new Date().toISOString(),
      problemHint: problem?.title,
    }
  }

  addProblem(input) {
    const kb = this.kb()
    const parsed = parseProblemUrl(input.url || '') || {}
    let platform = normalizePlatform(input.platform || parsed.platform)
    let key = String(input.key || parsed.key || '').trim()
    if (!key && platform === 'codeforces') {
      const matched = String(input.url || input.title || '').match(/(\d{3,5})([A-Za-z]\d?)/)
      if (matched) {
        key = `${matched[1]}${matched[2].toUpperCase()}`
        platform = 'codeforces'
      }
    }
    if (!key) fail('缺少题号 key：CF 填 1879D，AtCoder 填 abc300_f，洛谷填 P1234，或直接给题目链接')
    if (platform === 'codeforces') key = key.toUpperCase()
    const existing = kb.problems.find((problem) => problem.platform === platform && problem.key === key)
    if (existing) {
      fail(`这道题已经在库里了（${existing.id}「${displayTitle(existing)}」）。要补充内容用 oi_problem action=update 或 action=add_insight。`)
    }

    let title = String(input.title || '').trim()
    let rating = input.rating ?? null
    if (rating !== null && !Number.isFinite(Number(rating))) fail('rating 必须是数字（或留空）')
    if (rating !== null) rating = Math.round(Number(rating))
    let tags = Array.isArray(input.tags)
      ? [...new Set(input.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))]
      : []
    if (platform === 'codeforces') {
      const cached = this.lookupCachedCfProblem(key)
      if (cached) {
        if (!title) title = cached.name
        if (rating == null) rating = cached.rating
        if (!tags.length) tags = cached.tags || []
      }
    }
    if (!title) title = key

    const url = String(input.url || '').trim() || defaultProblemUrl(platform, key)
    const nodeIds = []
    const autoNodes = []
    for (const tag of tags) {
      const nodeId = this.kb().meta.tagMap[tag]
      if (nodeId && !nodeIds.includes(nodeId)) {
        nodeIds.push(nodeId)
        autoNodes.push({ tag, nodeId })
      }
    }
    for (const ref of input.nodes || []) {
      const node = resolveNode(this.kb(), ref)
      if (!nodeIds.includes(node.id)) nodeIds.push(node.id)
    }
    // 「最精髓的一句话」也要参与挂载：它通常直接点出思路节点。
    const essence = String(input.essence ?? '').trim()
    if (essence) {
      for (const node of this.detectNodes(essence)) {
        if (!nodeIds.includes(node.id)) nodeIds.push(node.id)
      }
    }
    const isQuiz = input.pool === 'quiz'

    const insights = []
    for (const raw of input.insights || []) {
      const insight = this.normalizeInsight(raw)
      insight.id = this.store.nextId(kb, 'i')
      insights.push(insight)
    }
    if (isQuiz) {
      // quiz 池只用来出题，不挂知识树、不进统计与反套路基线。
      nodeIds.length = 0
      autoNodes.length = 0
      for (const insight of insights) {
        insight.nodes = []
        insight.obsNodes = []
      }
    } else {
      // 洞察挂到的节点，题目本身也要算挂上：图/统计都按题目维度计数。
      for (const insight of insights) {
        for (const nodeId of insight.nodes || []) {
          if (!nodeIds.includes(nodeId)) nodeIds.push(nodeId)
        }
      }
    }

    const problem = {
      id: this.store.nextId(kb, 'p'),
      platform,
      key,
      title,
      titleZh: String(input.titleZh ?? ''),
      url,
      rating: rating == null ? null : Number(rating),
      tags,
      verdict: VERDICTS.includes(input.verdict) ? input.verdict : 'unknown',
      difficulty: String(input.difficulty ?? ''),
      essence,
      statement: String(input.statement ?? ''),
      statementZh: String(input.statementZh ?? ''),
      solution: String(input.solution ?? ''),
      nodes: nodeIds,
      keyObservations: [],
      insights,
      source: 'manual',
      sample: input.sample === true,
      pool: isQuiz ? 'quiz' : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.computeKeyObservations(problem)
    this.mutate((target) => {
      target.problems.push(problem)
    })

    const lines = [`已录入《${title}》（${platform} ${key}，${VERDICT_LABEL[problem.verdict]}${problem.rating ? `，${problem.rating} 分` : ''}）。`]
    const nodeNames = problem.nodes.map((id) => {
      const node = this.kb().nodes.find((item) => item.id === id)
      return node ? pathOf(this.kb(), node) : id
    })
    if (nodeNames.length) lines.push(`自动挂到：${nodeNames.join('、')}`)
    else lines.push('没有匹配到知识点：题目的 tag 可能没有映射，或需要手动 oi_problem action=link_node。')
    if (essence) lines.push(`精髓：${essence}`)
    if (insights.length) lines.push(`收录 ${insights.length} 条洞察：${summarizeKinds(insights)}`)
    else lines.push('还没提炼洞察。录题时至少写一条「这题最关键的观察」，并把套路/通用思路/思考方向分别记上（action=add_insight）。')
    const suggestions = new Map()
    for (const insight of insights) {
      for (const node of this.detectNodes(insight.text)) {
        if (!nodeIds.includes(node.id)) suggestions.set(node.id, pathOf(this.kb(), node))
      }
    }
    if (suggestions.size) lines.push(`洞察里提到的其他知识点（可用 oi_problem action=add_insight 或 oi_kb action=link_problem 挂上）：${[...suggestions.values()].join('、')}`)
    return {
      summary: lines.join('\n'),
      problem: { id: problem.id, platform, key, title, nodes: nodeIds, insights: insights.length },
      autoNodes,
      suggestedNodes: [...suggestions.values()],
    }
  }

  updateProblem(input) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const patch = input.patch && typeof input.patch === 'object' ? input.patch : input
    if (patch.verdict !== undefined && !VERDICTS.includes(patch.verdict)) {
      fail(`verdict 只能是 ${VERDICTS.join('/')}`)
    }
    const applied = []
    this.mutate((target) => {
      const entity = this.resolveProblem(target, problem.id)
      if (patch.title !== undefined) {
        entity.title = String(patch.title)
        applied.push('title')
      }
      if (patch.url !== undefined) {
        entity.url = String(patch.url)
        applied.push('url')
      }
      if (patch.rating !== undefined) {
        const next = patch.rating == null || patch.rating === '' ? null : Number(patch.rating)
        if (next !== null && !Number.isFinite(next)) fail('rating 必须是数字（或留空）')
        entity.rating = next === null ? null : Math.round(next)
        applied.push('rating')
      }
      if (patch.tags !== undefined) {
        entity.tags = Array.isArray(patch.tags)
          ? [...new Set(patch.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))]
          : []
        applied.push('tags')
      }
      if (patch.titleZh !== undefined) {
        entity.titleZh = String(patch.titleZh ?? '')
        applied.push('titleZh')
      }
      if (patch.statementZh !== undefined) {
        entity.statementZh = String(patch.statementZh ?? '')
        applied.push('statementZh')
      }
      if (patch.verdict !== undefined) {
        if (!VERDICTS.includes(patch.verdict)) fail(`verdict 只能是 ${VERDICTS.join('/')}`)
        entity.verdict = patch.verdict
        applied.push('verdict')
      }
      if (patch.stuckStage !== undefined) {
        const stage = String(patch.stuckStage || '')
        if (stage && !STUCK_STAGES.includes(stage)) fail(`stuckStage 只能是 ${STUCK_STAGES.join('/')}`)
        entity.stuckStage = stage || null
        applied.push('stuckStage')
      }
      if (patch.difficulty !== undefined) {
        entity.difficulty = String(patch.difficulty)
        applied.push('difficulty')
      }
      if (patch.essence !== undefined) {
        entity.essence = String(patch.essence)
        applied.push('essence')
      }
      if (patch.statement !== undefined) {
        entity.statement = String(patch.statement)
        applied.push('statement')
      }
      if (patch.solution !== undefined) {
        entity.solution = String(patch.solution)
        applied.push('solution')
      }
      if (patch.nodes !== undefined) {
        entity.nodes = []
        for (const ref of patch.nodes || []) {
          const node = resolveNode(target, ref)
          if (!entity.nodes.includes(node.id)) entity.nodes.push(node.id)
        }
        applied.push('nodes')
      }
      if (applied.length) entity.updatedAt = new Date().toISOString()
    })
    return { summary: `已更新《${displayTitle(problem)}》：${applied.join('、') || '无变化'}。` }
  }

  /**
   * 记录「卡在哪一步」。传空 stage 表示清空。
   * 这是训练闭环的核心数据：过没过只是结果，卡在哪才是下一步该练什么。
   */
  markStuck(input = {}) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const stage = input.stage == null ? '' : String(input.stage || '').trim()
    if (stage && !STUCK_STAGES.includes(stage)) {
      fail(`卡点只能是 ${STUCK_STAGES.map((item) => `${item}（${STUCK_LABEL[item]}）`).join(' / ')}，或留空清除`)
    }
    let saved = null
    this.mutate((target) => {
      const entity = this.resolveProblem(target, problem.id)
      entity.stuckStage = stage || null
      entity.updatedAt = new Date().toISOString()
      saved = entity
    })
    if (!stage) {
      return { summary: `已清除《${displayTitle(problem)}》的卡点记录。`, problem: saved, stage: null }
    }
    return {
      summary: `已标记《${displayTitle(problem)}》：卡在「${STUCK_LABEL[stage]}」（${stage}）。`,
      problem: saved,
      stage,
    }
  }

  addInsight(input) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    if (problem.pool === 'quiz') fail('quiz 池的题只用于训练，不挂知识点、也不加洞察')
    const insight = this.normalizeInsight(input)
    this.mutate((target) => {
      const entity = this.resolveProblem(target, problem.id)
      insight.id = this.store.nextId(target, 'i')
      entity.insights.push(insight)
      // 洞察挂到的节点要并入题目的挂载，否则统计、覆盖率、风险都看不到它。
      entity.nodes = [...new Set([...(entity.nodes || []), ...insight.nodes])]
      this.computeKeyObservations(entity)
      entity.updatedAt = new Date().toISOString()
    })
    const nodeNames = insight.nodes.map((id) => {
      const node = this.kb().nodes.find((item) => item.id === id)
      return node ? pathOf(this.kb(), node) : id
    })
    const lines = [`已给《${displayTitle(problem)}》加一条${KIND_LABEL[insight.kind]}：`, `- ${insight.text}`]
    if (nodeNames.length) lines.push(`挂到：${nodeNames.join('、')}`)
    else lines.push('没有匹配到知识点（洞察文字里没出现已有节点名），可加 nodes 参数显式指定。')
    return { summary: lines.join('\n'), insight, problem: problem.id }
  }

  removeInsight(input) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const target = String(input.insight ?? '').trim()
    if (!target) fail('请给 insight（洞察 id 或文本片段）')
    const hit = problem.insights.find((insight) => insight.id === target) ||
      problem.insights.find((insight) => insight.text.includes(target))
    if (!hit) fail(`《${displayTitle(problem)}》里找不到这条洞察：${target}`)
    this.mutate((storeKb) => {
      const entity = this.resolveProblem(storeKb, problem.id)
      entity.insights = entity.insights.filter((insight) => insight.id !== hit.id)
      this.computeKeyObservations(entity)
    })
    return { summary: `已删除《${displayTitle(problem)}》的${KIND_LABEL[hit.kind]}：${hit.text}` }
  }

  classifyProblem(input) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const nodeIds = new Set(problem.nodes)
    const added = []
    for (const tag of problem.tags || []) {
      const nodeId = kb.meta.tagMap[tag]
      if (nodeId && !nodeIds.has(nodeId)) {
        const node = kb.nodes.find((item) => item.id === nodeId)
        if (node) added.push({ node, tag })
        nodeIds.add(nodeId)
      }
    }
    const suggestions = new Map()
    for (const node of this.detectNodes(`${problem.statement}\n${problem.solution}\n${problem.insights.map((insight) => insight.text).join('\n')}`)) {
      if (!nodeIds.has(node.id)) suggestions.set(node.id, pathOf(kb, node))
    }
    if (input.apply !== false && added.length) {
      this.mutate((target) => {
        const entity = this.resolveProblem(target, problem.id)
        for (const { node } of added) if (!entity.nodes.includes(node.id)) entity.nodes.push(node.id)
        entity.updatedAt = new Date().toISOString()
      })
    }
    const lines = [`《${displayTitle(problem)}》分类检查：`]
    if (added.length) lines.push(`按 tag 可挂：${added.map(({ node, tag }) => `${pathOf(kb, node)}（${tag}）`).join('、')}${input.apply !== false ? '，已挂上' : '（apply=false，未写回）'}`)
    else lines.push('tag 没有新增可映射的节点。')
    if (suggestions.size) lines.push(`正文/题解里提到：${[...suggestions.values()].join('、')}`)
    return { summary: lines.join('\n'), added: added.length, suggestions: [...suggestions.values()] }
  }

  showProblem(input) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const nodeNames = problem.nodes.map((id) => {
      const node = kb.nodes.find((item) => item.id === id)
      return node ? pathOf(kb, node) : id
    })
    const lines = [`## ${displayTitle(problem)}`]
    lines.push(`平台 ${problem.platform} · 题号 ${problem.key} · ${VERDICT_LABEL[problem.verdict]}${problem.rating ? ` · ${problem.rating} 分` : ''}`)
    if (problem.url) lines.push(`链接：${problem.url}`)
    if (problem.tags.length) lines.push(`标签：${problem.tags.map((tag) => `${tag}(${tagLabel(tag)})`).join('、')}`)
    if (nodeNames.length) lines.push(`知识点：${nodeNames.join('、')}`)
    if (problem.essence) lines.push('', `**精髓**：${problem.essence}`)
    const keyObservations = (problem.keyObservations || [])
      .map((id) => problem.insights.find((insight) => insight.id === id))
      .filter(Boolean)
    if (keyObservations.length) {
      lines.push('', '**精髓观察**（分析中最久的几步）：')
      for (const insight of keyObservations) {
        const obs = (insight.obsNodes || []).map((id) => this.obsPath(kb, id)).filter(Boolean)
        lines.push(`- ${insight.text}${obs.length ? `　→ ${obs.join('、')}` : ''}`)
      }
    }
    if (problem.insights.length) {
      lines.push('', `## 洞察（${problem.insights.length}）`)
      for (const kind of KINDS) {
        const list = problem.insights.filter((insight) => insight.kind === kind)
        if (!list.length) continue
        lines.push(`### ${KIND_LABEL[kind]}`)
        for (const insight of list) lines.push(`- ${insight.text}`)
      }
    }
    if (problem.statement) lines.push('', '## 题意', problem.statement.slice(0, 2000))
    if (problem.solution) lines.push('', '## 题解', problem.solution.slice(0, 4000))
    return { summary: lines.join('\n'), problem, nodeNames }
  }

  // ── 观察树 ──────────────────────────────────────────────────────────────

  obsTree(options = {}) {
    const kb = this.kb()
    const counts = new Map()
    for (const problem of kb.problems) {
      for (const insight of problem.insights || []) {
        if (insight.kind !== 'observation') continue
        for (const id of insight.obsNodes || []) counts.set(id, (counts.get(id) || 0) + 1)
      }
    }
    const children = new Map()
    for (const node of kb.obsNodes) {
      const list = children.get(node.parent) || []
      list.push(node)
      children.set(node.parent, list)
    }
    const agg = new Map()
    const aggregate = (nodeId) => {
      let total = counts.get(nodeId) || 0
      for (const child of children.get(nodeId) || []) total += aggregate(child.id)
      agg.set(nodeId, total)
      return total
    }
    for (const node of kb.obsNodes) if (node.parent === null) aggregate(node.id)
    const depthLimit = Number.isFinite(options.depth) ? Math.max(1, Number(options.depth)) : 99
    const patternTotal = kb.obsNodes.reduce((sum, node) => sum + (node.patterns || []).length, 0)
    const verifiedTotal = kb.obsNodes.reduce(
      (sum, node) => sum + (node.patterns || []).filter((item) => item && item.verified === true).length,
      0,
    )
    const lines = [`观察树（${kb.obsNodes.length} 个节点，${kb.problems.reduce((sum, problem) => sum + (problem.keyObservations || []).length, 0)} 条精髓观察记录，${patternTotal} 条观察句式，其中 ${verifiedTotal} 条有真题证据）——记录"那一步到底看出了什么"`]
    const walk = (parentId, prefix, level) => {
      const list = children.get(parentId) || []
      list.forEach((node, index) => {
        const isLast = index === list.length - 1
        const count = agg.get(node.id) || 0
        lines.push(`${prefix}${isLast ? '└─ ' : '├─ '}${count ? `● ${node.name}  [${count}]` : `○ ${node.name}`}`)
        if (level + 1 < depthLimit) walk(node.id, `${prefix}${isLast ? '   ' : '│  '}`, level + 1)
      })
    }
    walk(null, '', 0)
    return { summary: lines.join('\n'), nodes: kb.obsNodes }
  }

  /**
   * 观察句式库：把观察树每个节点上沉淀的「常见观察句式」列出来，
   * 支持按关键词过滤（比如 二分、逆序对、gcd、区间）。
   */
  obsPatterns(options = {}) {
    const kb = this.kb()
    const query = String(options.query || '').trim()
    const needle = query.toLowerCase()
    const rows = []
    for (const node of kb.obsNodes) {
      const patterns = node.patterns || []
      if (!patterns.length) continue
      const matched = patterns.filter((pattern) => {
        const text = patternText(pattern)
        return text && (!needle || text.toLowerCase().includes(needle))
      })
      if (!matched.length) continue
      rows.push({ path: this.obsPath(kb, node.id), patterns: matched })
    }
    const total = rows.reduce((sum, row) => sum + row.patterns.length, 0)
    const verified = rows.reduce(
      (sum, row) => sum + row.patterns.filter((pattern) => pattern && pattern.verified === true).length,
      0,
    )
    const lines = [`## 观察句式库（${total} 条，其中 ${verified} 条有真题证据${query ? `，关键词「${query}」` : ''}）`]
    if (!rows.length) lines.push('', '没有匹配的观察句式，换个关键词试试。')
    for (const row of rows) {
      lines.push('', `### ${row.path}（${row.patterns.length}）`)
      for (const pattern of row.patterns) {
        const text = patternText(pattern)
        const examples = (pattern && pattern.examples) || []
        const names = examples.map((example) => example.title).filter(Boolean)
        lines.push(`- ${pattern && pattern.verified === true ? '' : '[未验证] '}${text}${names.length ? `　例：${names.slice(0, 3).join('、')}` : ''}`)
      }
    }
    return { summary: lines.join('\n'), count: total, rows }
  }

  /**
   * 未归类观察：列出没挂观察节点的 observation，并按观察句式里的名字/别名给出建议。
   * 只是建议——粗粒度树接不住所有题目特有的推导，宁可空着也别硬塞。
   */
  obsUnassigned(options = {}) {
    const kb = this.kb()
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 20))
    const observations = kb.problems
      .filter((problem) => !problem.sample && problem.pool !== 'quiz')
      .flatMap((problem) =>
        problem.insights
          .filter((insight) => insight.kind === 'observation' && !(insight.obsNodes || []).length)
          .map((insight) => ({
            problem,
            insight,
            suggestions: matchObsNodes(insight.text),
          })),
      )
    observations.sort((left, right) => (right.problem.rating || 0) - (left.problem.rating || 0))
    const totalObservation = kb.problems
      .filter((problem) => !problem.sample && problem.pool !== 'quiz')
      .reduce(
        (sum, problem) => sum + problem.insights.filter((insight) => insight.kind === 'observation').length,
        0,
      )
    const withSuggestion = observations.filter((row) => row.suggestions.length).length
    const pct = totalObservation ? Math.round((observations.length / totalObservation) * 100) : 0
    const lines = [
      `## 未归类观察 ${observations.length} / ${totalObservation} 条（${pct}%）`,
      `其中 ${withSuggestion} 条能按观察句式里的名字/别名找到候选节点（自动匹配权重 ×0.75，建议人工确认）。`,
      '',
      `每条最多列 ${limit} 条：`,
    ]
    if (!observations.length) lines.push('', '全部观察都已经挂到观察节点上了。')
    for (const row of observations.slice(0, limit)) {
      const ratingText = Number.isFinite(row.problem.rating) ? ` · ${row.problem.rating}` : ''
      lines.push('', `### 《${displayTitle(row.problem)}》（${row.problem.platform} ${row.problem.key}${ratingText}）`)
      lines.push(`- ${row.insight.text}`)
      if (row.suggestions.length) lines.push(`- 建议挂到：${row.suggestions.join('、')}`)
    }
    if (observations.length > limit) lines.push('', `……另有 ${observations.length - limit} 条，用 limit 参数翻页（上限 200）。`)
    return {
      summary: lines.join('\n'),
      count: observations.length,
      total: totalObservation,
      withSuggestion,
      rows: observations.slice(0, limit),
    }
  }

  // ── 相似度 / 反套路推荐 ──────────────────────────────────────────────────

  formatPair(kb, a, b, result) {
    const pct = (value) => (value == null ? '—' : `${Math.round(value * 100)}%`)
    const lines = [
      `《${displayTitle(a)}》 vs 《${displayTitle(b)}》`,
      `总相似度：**${pct(result.score)}**`,
      `- 精髓观察：${pct(result.parts.obs)}`,
      `- 其他洞察（套路/思路/方向/坑点）：${pct(result.parts.other)}`,
      `- 算法知识点：${pct(result.parts.algo)}`,
    ]
    const obsDetail = result.shared.obsDetail || []
    if (obsDetail.length) {
      lines.push(`共同观察：${obsDetail.map((item) => (item.generic ? `${item.path}（泛）` : item.path)).join('、')}`)
    }
    if (result.parts.level != null && result.parts.level < 0.995) {
      lines.push(`- 难度差 ${result.parts.ratingGap} 分 → 水平系数 ${result.parts.level.toFixed(2)}（已按此打折）`)
    }
    if (result.shared.other.length) lines.push(`共同洞察层节点：${result.shared.other.slice(0, 8).join('、')}`)
    if (result.shared.algo.length) lines.push(`共同算法节点：${result.shared.algo.slice(0, 8).join('、')}`)
    if (!result.shared.obs.length) lines.push('精髓观察没有重叠——这基本就是"没见过这类想法"的信号。')
    return lines.join('\n')
  }

  formatRanked(kb, ranked) {
    const lines = [
      `候选 ${ranked.sampled} 道，阈值 ${ranked.threshold}（与库内最像的一道相似度低于它就算"陌生"）。`,
    ]
    const rows = ranked.rows.slice(0, 20)
    for (const row of rows) {
      const pct = Math.round(row.minSimilarity * 100)
      const nearest = row.nearest ? `《${displayTitle(row.nearest)}》${Math.round(row.nearestScore * 100)}%` : '（库里没有别的题）'
      const tag = row.recommended ? '★ 推荐' : ''
      const levelNote = row.nearestParts && row.nearestParts.level != null && row.nearestParts.level < 0.995
        ? `，难度差 ${row.nearestParts.ratingGap} 分（×${row.nearestParts.level.toFixed(2)}）`
        : ''
      lines.push(
        `- ${tag}「${displayTitle(row.problem)}」（${row.problem.key}${row.problem.rating ? `，${row.problem.rating}` : ''}）：最像 ${nearest}，总相似度 ${pct}%${levelNote}${row.keyInsights ? `，精髓观察 ${row.keyInsights} 条` : '，没有精髓观察'}`,
      )
      if (row.shared.obs.length) lines.push(`    共同观察：${row.shared.obs.slice(0, 4).join('、')}`)
    }
    if (!ranked.recommended.length) {
      lines.push('没有候选低于阈值——这批题对你来说都不算陌生。可以把阈值调高，或换更偏门的一批。')
    } else {
      lines.push('', `最该推荐先做：**${displayTitle(ranked.recommended[0].problem)}**（${ranked.recommended[0].problem.key}），与你会的最像的也只有 ${Math.round(ranked.recommended[0].minSimilarity * 100)}%。`)
    }
    return lines.join('\n')
  }

  similar(input = {}) {
    const kb = this.kb()
    const threshold = Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : 0.3
    if (input.a && input.b) {
      const a = this.resolveProblem(kb, input.a)
      const b = this.resolveProblem(kb, input.b)
      const result = compareFeatures(problemFeatures(kb, a), problemFeatures(kb, b))
      return {
        summary: this.formatPair(kb, a, b, result),
        score: Number(result.score.toFixed(4)),
        parts: result.parts,
        shared: result.shared,
      }
    }
    if (input.a) {
      const a = this.resolveProblem(kb, input.a)
      const best = nearestProblem(kb, a)
      if (!best) return { summary: `库里只有《${displayTitle(a)}》一道题，没有可比的。`, score: 0 }
      return {
        summary: `${this.formatPair(kb, a, best.problem, best)}\n\n这是与《${displayTitle(a)}》最像的题。`,
        score: Number(best.score.toFixed(4)),
        parts: best.parts,
      }
    }
    const candidatesInput = Array.isArray(input.candidates) ? input.candidates.filter(Boolean) : []
    const refs = candidatesInput.length ? candidatesInput : this.recentProblemRefs(kb, Number(input.limit) || 10)
    if (!refs.length) fail('没有候选题目：给 candidates，或先消化几道题再跑推荐')
    const candidates = refs.map((ref) => this.resolveProblem(kb, ref))
    const ranked = rankCandidates(kb, candidates, { threshold })
    return { summary: this.formatRanked(kb, ranked), ...ranked }
  }

  recentProblemRefs(kb, limit) {
    return [...kb.problems]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, limit))
      .map((problem) => problem.id)
  }

  recommendNovel(input = {}) {
    const kb = this.kb()
    const threshold = Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : 0.3
    const refs = Array.isArray(input.candidates) && input.candidates.length
      ? input.candidates.filter(Boolean)
      : this.recentProblemRefs(kb, Number(input.limit) || 10)
    if (!refs.length) fail('没有候选题目：给 candidates（题号/链接），或先消化几道题')
    const candidates = refs.map((ref) => this.resolveProblem(kb, ref))
    const ranked = rankCandidates(kb, candidates, { threshold })
    const best = ranked.recommended[0] || ranked.rows[0]
    const dist = calibrate(kb)
    const lines = [this.formatRanked(kb, ranked)]
    lines.push('', `参照系：你已做题的最近邻相似度 10% 分位 ${Math.round(dist.p10 * 100)}%、中位 ${Math.round(dist.median * 100)}%；低于 ${Math.round(dist.p10 * 100)}% 才算真的没见过。`)
    if (best) {
      const pct = Math.round((dist.values.filter((value) => value <= best.minSimilarity).length / Math.max(1, dist.values.length)) * 100)
      lines.push('', `最终推荐：**${displayTitle(best.problem)}**（${best.problem.key}${best.problem.rating ? `，${best.problem.rating}` : ''}）`)
      lines.push(`- 与库内最像的《${best.nearest ? displayTitle(best.nearest) : '—'}》相似度只有 ${Math.round(best.minSimilarity * 100)}%，在你已做题里排前 ${pct}% 的陌生度`)
      if (best.shared.obs.length) lines.push(`- 连观察都沾一点：${best.shared.obs.slice(0, 3).join('、')}——说明只有边角像，主干是新的`)
      else lines.push('- 精髓观察完全对不上，属于没练过的想法')
      lines.push('- 建议：先自己推 30 分钟，再看题解，然后把这条观察补进观察树。')
    }
    return { summary: lines.join('\n'), ...ranked, percentile: best ? Math.round((dist.values.filter((value) => value <= best.minSimilarity).length / Math.max(1, dist.values.length)) * 100) : null }
  }

  calibrateThreshold() {
    const kb = this.kb()
    const result = calibrate(kb)
    const pct = (value) => `${Math.round(value * 100)}%`
    return {
      summary: [
        `已做题 ${result.count} 道，两两最近邻相似度分布：`,
        `- 10% 分位 ${pct(result.p10)}、25% 分位 ${pct(result.p25)}、中位数 ${pct(result.median)}、75% 分位 ${pct(result.p75)}、最高 ${pct(result.max)}`,
        `- 建议阈值：**${pct(result.recommendedThreshold)}**（取 25% 分位的九成，低于它的候选题对你算“没见过”）`,
      ].join('\n'),
      ...result,
    }
  }

  listProblems(input = {}) {
    const kb = this.kb()
    let list = kb.problems
    if (input.platform) list = list.filter((problem) => problem.platform === normalizePlatform(input.platform))
    if (input.verdict) list = list.filter((problem) => problem.verdict === input.verdict)
    if (input.node) {
      const node = resolveNode(kb, input.node)
      const ids = new Set(descendantIds(kb, node.id))
      list = list.filter(
        (problem) =>
          problem.nodes.some((id) => ids.has(id)) ||
          problem.insights.some((insight) => insight.nodes.some((id) => ids.has(id))),
      )
    }
    if (input.query) {
      const needle = String(input.query).toLowerCase()
      list = list.filter((problem) =>
        `${displayTitle(problem)}\n${problem.key}\n${problem.tags.join(' ')}\n${problem.solution}\n${problem.insights.map((insight) => insight.text).join('\n')}`
          .toLowerCase()
          .includes(needle),
      )
    }
    const limit = Math.max(1, Math.min(Number(input.limit) || 30, 200))
    const lines = [`共 ${list.length} 道题${list.length > limit ? `，显示前 ${limit} 道` : ''}：`]
    for (const problem of list.slice(0, limit)) {
      lines.push(
        `- ${displayTitle(problem)}（${problem.platform} ${problem.key}，${VERDICT_LABEL[problem.verdict]}${problem.rating ? `，${problem.rating}` : ''}，洞察 ${problem.insights.length}）[${problem.id}]`,
      )
    }
    return { summary: lines.join('\n'), problems: list.slice(0, limit).map((problem) => problem.id), total: list.length }
  }

  removeProblem(input) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    this.mutate((target) => {
      target.problems = target.problems.filter((item) => item.id !== problem.id)
    })
    return { summary: `已删除《${displayTitle(problem)}》。` }
  }

  // ── 账号 ────────────────────────────────────────────────────────────────

  findAccount(kb, platform, handle) {
    const wanted = String(handle ?? '').trim().toLowerCase()
    return kb.accounts.find((account) => account.platform === platform && (wanted === '' || account.handle.toLowerCase() === wanted))
  }

  addAccount(input) {
    const platform = normalizePlatform(input.platform)
    if (!['codeforces', 'atcoder', 'luogu'].includes(platform)) fail('platform 只支持 codeforces / atcoder / luogu')
    let handle = String(input.handle ?? '').trim()
    if (handle === '') fail('账号不能为空')
    let uid = ''
    if (platform === 'luogu') {
      const matched = handle.match(/\/user\/(\d+)/)
      if (matched) handle = matched[1]
      if (/^\d+$/.test(handle)) uid = handle
    }
    if (platform === 'codeforces') {
      const matched = handle.match(/codeforces\.com\/profile\/([^/?#]+)/)
      if (matched) handle = matched[1]
    }
    const kb = this.kb()
    const existing = this.findAccount(kb, platform, handle)
    if (existing) {
      if (input.cookie) {
        this.mutate((target) => {
          this.findAccount(target, platform, handle).cookie = String(input.cookie)
        })
        return { summary: `${platform} 账号 ${handle} 已在名单里，已更新 Cookie。` }
      }
      return { summary: `${platform} 账号 ${handle} 已在名单里。` }
    }
    const account = {
      id: this.store.nextId(kb, 'a'),
      platform,
      handle,
      uid,
      cookie: String(input.cookie ?? ''),
      createdAt: new Date().toISOString(),
      lastSyncAt: null,
      lastResult: null,
    }
    this.mutate((target) => {
      target.accounts.push(account)
    })
    return { summary: `已添加 ${platform} 账号 ${handle}。现在可以 oi_account action=sync 同步已通过的题。`, account }
  }

  listAccounts() {
    const kb = this.kb()
    if (!kb.accounts.length) {
      return { summary: '还没有绑定账号。用 oi_account action=add 添加 codeforces / atcoder / luogu 账号。' }
    }
    const lines = ['已绑定账号：']
    for (const account of kb.accounts) {
      const counts = solvedCountFor(kb, account)
      const solvedText = counts.mirrored
        ? `已同步 ${counts.total} 题（自有 ${counts.own} + 镜像 ${counts.mirrored}）`
        : `已同步 ${counts.own} 题`
      const status = account.lastResult?.ok === false ? `上次失败：${account.lastResult.message}` : account.lastSyncAt ? solvedText : '未同步'
      lines.push(`- ${account.platform} ${account.handle}：${status}${account.lastSyncAt ? `（${account.lastSyncAt.slice(0, 16).replace('T', ' ')}）` : ''}`)
    }
    return { summary: lines.join('\n'), accounts: kb.accounts.map((account) => ({ platform: account.platform, handle: account.handle, lastSyncAt: account.lastSyncAt })) }
  }

  removeAccount(input) {
    const kb = this.kb()
    const platform = normalizePlatform(input.platform)
    const wanted = String(input.handle ?? '').trim()
    if (!wanted) fail('remove 需要同时给 platform 和 handle，避免误删该平台的第一个账号')
    const account = this.findAccount(kb, platform, wanted)
    if (!account) fail(`没有绑定 ${platform} 账号 ${wanted}`)
    const handle = account.handle
    this.mutate((target) => {
      target.accounts = target.accounts.filter((item) => item.id !== account.id)
      // 镜像题会按原平台分桶但沿用本账号的 handle：只有该平台上再没有同名真实账号时，才清它的桶。
      for (const bucketPlatform of Object.keys(target.solved || {})) {
        const occupied = (target.accounts || []).some(
          (item) => item.platform === bucketPlatform && String(item.handle).toLowerCase() === handle.toLowerCase(),
        )
        if (occupied) continue
        if (target.solved[bucketPlatform]) delete target.solved[bucketPlatform][handle]
        if (target.attempted && target.attempted[bucketPlatform]) delete target.attempted[bucketPlatform][handle]
      }
    })
    return { summary: `已移除 ${platform} 账号 ${handle}（包括 CF/AtCoder 镜像题的同步缓存也删了）。` }
  }

  async syncAccount(input = {}) {
    const kb = this.kb()
    const platform = input.platform ? normalizePlatform(input.platform) : null
    let account = null
    if (platform) {
      account = this.findAccount(kb, platform, input.handle || '')
      if (!account) fail(`没有绑定 ${platform} 账号 ${input.handle || ''}`)
    } else {
      const matches = input.handle ? kb.accounts.filter((item) => item.handle === input.handle) : kb.accounts
      if (!matches.length) fail('还没有绑定任何账号，先用 oi_account action=add 添加')
      account = matches[0]
    }

    let items = []
    let attemptedItems = []
    try {
      if (account.platform === 'codeforces') {
        const activity = await sync.fetchCodeforcesActivity(account.handle)
        items = activity.solved
        attemptedItems = activity.attempted
      } else if (account.platform === 'atcoder') {
        let resources = null
        try {
          resources = await sync.loadAtCoderResources(this.store, { force: Boolean(input.force) })
        } catch (_) {
          resources = null
        }
        items = await sync.fetchAtCoderSolved(account.handle, {
          titleOf: (id) => resources?.problems?.[id]?.title,
        })
        if (resources) sync.applyAtCoderResources(items, resources)
      } else if (account.platform === 'luogu') {
        items = await sync.fetchLuoguSolved(account.handle, { cookie: input.cookie || account.cookie, uid: account.uid })
        items = this.enrichMirroredProblems(items)
      } else {
        fail(`不支持的平台：${account.platform}`)
      }
    } catch (error) {
      const message = error?.message || String(error)
      this.store.mutate((target) => {
        const entity = this.findAccount(target, account.platform, account.handle)
        if (entity) entity.lastResult = { ok: false, message, at: new Date().toISOString() }
      })
      this.invalidate()
      return { summary: `同步失败：${message}`, ok: false, message }
    }

    const result = this.store.mutate((target) => {
      // 旧数据里洛谷镜像题记在 luogu 桶下，重同步时清掉，避免和原平台重复计数
      if (account.platform === 'luogu') {
        const stale = target.solved.luogu?.[account.handle]
        if (stale) {
          for (const key of Object.keys(stale)) {
            if (/^(CF\d|AT_)/i.test(key)) delete stale[key]
          }
        }
      }
      // 洛谷镜像题会以原平台身份入库，所以按 item.platform 分桶
      const perPlatform = new Map()
      for (const item of items) {
        const platform = item.platform || account.platform
        if (!perPlatform.has(platform)) perPlatform.set(platform, [])
        perPlatform.get(platform).push(item)
      }
      let added = 0
      let total = 0
      for (const [platform, list] of perPlatform) {
        target.solved[platform] = target.solved[platform] || {}
        const bucket = (target.solved[platform][account.handle] = target.solved[platform][account.handle] || {})
        for (const item of list) {
          if (!bucket[item.key]) added += 1
          bucket[item.key] = item
        }
        total += Object.keys(bucket).length
      }
      let marked = 0
      for (const problem of target.problems) {
        if (problem.verdict === 'solved') continue
        if (target.solved[problem.platform]?.[account.handle]?.[problem.key]) {
          problem.verdict = 'solved'
          problem.updatedAt = new Date().toISOString()
          marked += 1
        }
      }
      const entity = this.findAccount(target, account.platform, account.handle)
      // 同步成功就重建 attempted 桶：接口这次返回空，说明旧「试过未过」已经过时。
      target.attempted[account.platform] = target.attempted[account.platform] || {}
      target.attempted[account.platform][account.handle] = {}
      for (const item of attemptedItems) target.attempted[account.platform][account.handle][item.key] = item
      entity.lastSyncAt = new Date().toISOString()
      entity.lastResult = { ok: true, count: items.length, added, marked, attempted: attemptedItems.length, at: entity.lastSyncAt }
      target.meta.lastSyncAt = entity.lastSyncAt
      return { added, marked, total }
    })
    this.invalidate()

    const analysis = this.analysis()
    const lines = [
      `${account.platform} ${account.handle} 同步完成：拉到 ${items.length} 道已通过，新增 ${result.added} 条，累计 ${result.total} 条。`,
    ]
    if (result.marked) lines.push(`库里 ${result.marked} 道手工录入的题自动标成「已通过」。`)
    if (attemptedItems.length) lines.push(`另有 ${attemptedItems.length} 道提交过但从没 AC，已记为「试过未过」（会抬高对应知识点的风险）。`)
    lines.push(`已覆盖知识点 ${analysis.overview.covered}/${analysis.overview.nodes}（${analysis.overview.coveredPct}%）。跑 oi_kb action=report 看最该补哪里。`)
    return { summary: lines.join('\n'), ok: true, total: result.total, added: result.added, marked: result.marked }
  }

  // ── 分析 ────────────────────────────────────────────────────────────────

  report(input = {}) {
    const kb = this.kb()
    const analysis = this.analysis()
    const limit = Math.max(1, Math.min(Number(input.limit) || 12, 40))
    const { overview } = analysis
    const lines = ['## 总览']
    lines.push(
      `知识点 ${overview.nodes} 个，已覆盖 ${overview.covered} 个（${overview.coveredPct}%）：非常熟练 ${overview.expert} / 熟练 ${overview.strong} / 还行 ${overview.ok} / 不熟练 ${overview.weak} / 非常不熟练 ${overview.poor} / 空白 ${overview.blank}${overview.unmeasured ? ` / 未测 ${overview.unmeasured}` : ''}。`,
    )
    lines.push(
      `题目：手工收录 ${overview.manualProblems} 道（已通过 ${overview.manualSolved}，卡住 ${overview.manualStuck}），账号同步去重后已通过 ${overview.syncedSolved} 道，洞察 ${overview.insights} 条。`,
    )
    if (overview.untagged) {
      lines.push(`其中 ${overview.untagged} 道没有标签（AtCoder 题目默认无 tag），只计入总数，不参与知识点统计。`)
    }
    if (overview.syncedAttempted) {
      lines.push(`另有 ${overview.syncedAttempted} 道提交过但从未 AC，已按「试过未过」计入对应知识点。`)
    }
    if (overview.ideaNodes) {
      lines.push(
        `思路树：${overview.ideaNodes} 个节点，已有记录 ${overview.ideaCovered} 个，洞察 ${overview.ideaInsights} 条（这张树记的是「怎么想出来的」，不是算法名）。`,
      )
    }
    if (!kb.accounts.length) lines.push('（还没绑定账号：oi_account action=add，同步后覆盖率才算得准。）')

    const stuckTotal = Object.values(overview.stuck || {}).reduce((sum, n) => sum + n, 0)
    if (stuckTotal > 0) {
      lines.push('', '## 卡点分布')
      for (const stage of STUCK_STAGES) {
        const count = overview.stuck[stage] || 0
        const pct = stuckTotal ? Math.round((count / stuckTotal) * 100) : 0
        lines.push(`- ${STUCK_LABEL[stage]}（${stage}）：${count} 道（${pct}%）`)
      }
      const worst = STUCK_STAGES.map((stage) => [stage, overview.stuck[stage] || 0]).sort((a, b) => b[1] - a[1])[0]
      if (worst && worst[1] > 0) {
        const advice = {
          observe: '失败集中在「没找到观察」：先练观察召回与条件表，别急着加题量。',
          derive: '失败集中在「推不动」：把卡住的题各写一句「缺的那步是什么」，再按思路节点补。',
          implement: '失败集中在「会做写不对」：限时实现训练，写前先列步骤与边界。',
          debug: '失败集中在「调不出」：补对拍与边界清单，写完立刻构造小数据自测。',
        }[worst[0]]
        lines.push(`最主要卡点：${STUCK_LABEL[worst[0]]}（${worst[1]} 道）。${advice}`)
      }
    }

    if (analysis.top.length) {
      lines.push('', `## 最该补的 ${Math.min(limit, analysis.top.length)} 个知识点`)
      analysis.top.slice(0, limit).forEach((row, index) => {
        const detail = row.reasons.length
          ? row.reasons.join('；')
          : `75 分位 ${row.p75 != null ? Math.round(row.p75) : '—'}，已通过 ${row.solvedCount} 题`
        lines.push(`${index + 1}. ${row.path}　风险 ${row.risk.toFixed(2)}（${LEVEL_TEXT[row.level]}）— ${detail}`)
      })
    } else {
      lines.push('', '## 暂时没有明显的空白分支')
      lines.push('先录入一些题（或同步账号），或者用 oi_kb action=seed 补齐知识树。')
    }

    const ideaRows = analysis.ideaRows || []
    if (ideaRows.length) {
      lines.push('', '## 思路树')
      lines.push(`已有记录 ${overview.ideaCovered}/${overview.ideaNodes} 个思路，共 ${overview.ideaInsights} 条洞察。`)
      const empty = ideaRows.filter((row) => row.parent !== null && row.insightCount === 0).slice(0, 12)
      if (empty.length) lines.push(`最空的方向：${empty.map((row) => row.name).join('、')}`)
      const warm = ideaRows
        .filter((row) => row.parent !== null && row.insightCount > 0)
        .sort((a, b) => b.insightCount - a.insightCount)
        .slice(0, 8)
      if (warm.length) lines.push(`已有沉淀：${warm.map((row) => `${row.name}(${row.insightCount})`).join('、')}`)
      const bare = kb.problems.filter((problem) => !problem.essence && problem.insights.length === 0)
      if (bare.length) {
        lines.push(`还有 ${bare.length} 道题既没写「精髓」也没有洞察——它们只是刷题记录，不会变成思路。`)
      }
    }

    if (kb.obsNodes.length) {
      const obsTotal = kb.problems.reduce((sum, problem) => sum + (problem.keyObservations || []).length, 0)
      const obsUnassigned = kb.problems.reduce(
        (sum, problem) =>
          sum + problem.insights.filter((insight) => insight.kind === 'observation' && !(insight.obsNodes || []).length).length,
        0,
      )
      lines.push('', '## 观察树')
      lines.push(`共 ${kb.obsNodes.length} 个观察节点、${obsTotal} 条精髓观察记录、${kb.obsNodes.reduce((sum, node) => sum + (node.patterns || []).length, 0)} 条观察句式。`)
      if (obsUnassigned) {
        lines.push(`其中 ${obsUnassigned} 条观察还没挂到观察节点（多是这道题特有的推导；可拿 oi_kb action=obs_patterns 对照常见句式后手动挂）。`)
      }
      const obsUsed = new Map()
      for (const problem of kb.problems) {
        for (const insight of problem.insights) {
          for (const id of insight.obsNodes || []) obsUsed.set(id, (obsUsed.get(id) || 0) + 1)
        }
      }
      const hasChild = new Set(kb.obsNodes.map((node) => node.parent).filter(Boolean))
      const emptyLeaves = kb.obsNodes.filter((node) => !hasChild.has(node.id) && !obsUsed.get(node.id))
      if (emptyLeaves.length) lines.push(`还没有题挂上的方向：${emptyLeaves.slice(0, 10).map((node) => node.name).join('、')}`)
    }

    const strong = analysis.nonRoot.filter((row) => row.level === 'expert' || row.level === 'strong').slice(0, 12)
    if (strong.length) {
      lines.push('', '## 已经比较稳的（◆ 非常熟练 / ● 熟练）')
      for (const row of strong) {
        lines.push(
          `- ${MARK[row.level]} ${row.path}（${LEVEL_TEXT[row.level]}，${row.solvedCount} 题，75 分位 ${row.p75 != null ? Math.round(row.p75) : '—'}）`,
        )
      }
    }

    if (analysis.unclassified.length) {
      lines.push('', `## 未分类的题（${analysis.unclassified.length}）`)
      lines.push('这些题没有挂任何知识点，分类统计会把它们漏掉：')
      for (const problem of analysis.unclassified.slice(0, 10)) lines.push(`- ${displayTitle(problem)}（${problem.platform} ${problem.key}）[${problem.id}]`)
    }

    const zeroTags = analysis.gaps.filter((gap) => gap.solved === 0 && gap.mappedNode)
    if (zeroTags.length) {
      lines.push('', `## 标签盲区（${zeroTags.length} 个 tag 从未通过）`)
      lines.push(zeroTags.slice(0, 12).map((gap) => `${gap.tag}→${gap.mappedNode}`).join('、'))
    }

    const thinTags = analysis.gaps.filter((gap) => gap.mappedNode && gap.solved > 0 && gap.solved <= 12)
    if (thinTags.length) {
      lines.push('', `## 题量偏少的 tag（≤12 道，共 ${thinTags.length} 个）`)
      for (const gap of thinTags.slice(0, 14)) {
        lines.push(
          `- ${gap.tag}：${gap.solved} 题，中位 ${gap.medianRating ?? '—'}，最高 ${gap.maxRating ?? '—'} → ${gap.mappedNode}`,
        )
      }
    }

    const attemptedProblems = (analysis.struggle || [])
      .filter((problem) => problem.verdict === 'attempted')
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    if (attemptedProblems.length) {
      lines.push('', `## 提交过、但从没 AC 的题（${attemptedProblems.length}）`)
      for (const problem of attemptedProblems.slice(0, 12)) {
        const tags = (problem.tags || []).slice(0, 3).map((tag) => tagLabel(tag))
        const suffix = tags.length ? `〔${tags.join('/')}〕` : ''
        const rating = problem.rating != null ? String(problem.rating) : '未定级'
        lines.push(`- ${displayTitle(problem)}（${problem.platform} ${problem.key}，${rating}）${suffix}`)
      }
      if (attemptedProblems.length > 12) lines.push(`- ……另有 ${attemptedProblems.length - 12} 道，用 oi_problem action=search 查看`)
    }

    const unmeasuredRows = analysis.nonRoot.filter((row) => row.level === 'unmeasured')
    if (unmeasuredRows.length) {
      lines.push('', `## 账号数据测不到的节点（${unmeasuredRows.length}）`)
      lines.push('Codeforces 只给粗标签（data structures / graphs / dp 这类），这些细分节点在提交记录里没有独立证据，所以既不算弱项也不算强项：')
      lines.push(`${unmeasuredRows.slice(0, 16).map((row) => row.path).join('、')}${unmeasuredRows.length > 16 ? '……' : ''}`)
    }

    return { summary: lines.join('\n'), overview, top: analysis.top.slice(0, limit), unclassified: analysis.unclassified }
  }

  gaps() {
    const analysis = this.analysis()
    if (!analysis.gaps.length) {
      return { summary: '还没有任何带 tag 的通过记录。绑定 CF 账号同步一次，或手工录题时带上 tags。' }
    }
    const lines = ['tag 覆盖（按已通过题数升序）：']
    for (const gap of analysis.gaps) {
      const nodeText = gap.mappedNode ? `→ ${gap.mappedPath}` : '→ （未映射，用 oi_kb action=map_tag 挂上）'
      lines.push(`- ${gap.tag}(${tagLabel(gap.tag)})：${gap.solved} 题${gap.medianRating ? `，中位 ${gap.medianRating}` : ''} ${nodeText}`)
    }
    return { summary: lines.join('\n'), gaps: analysis.gaps }
  }

  async recommend(input = {}) {
    const kb = this.kb()
    let pool
    try {
      const cache = await sync.loadCodeforcesProblemset(this.store, { force: Boolean(input.refresh) })
      pool = cache.problems
    } catch (error) {
      return { summary: `题库拉取失败（${error.message}）。可以先用 oi_kb action=report 看弱点，等网络好再推荐题目。`, items: [] }
    }
    let node = null
    if (input.node) node = resolveNode(kb, input.node)
    const exclude = new Set((Array.isArray(input.exclude) ? input.exclude : []).map((key) => String(key)))
    const wanted = Math.min(Number(input.limit) || 10, 30)
    const result = recommendProblems(kb, pool, {
      analysis: this.analysis(),
      limit: Math.min(wanted + exclude.size, 30),
      ratingMin: input.ratingMin ?? null,
      ratingMax: input.ratingMax ?? null,
      tag: input.tag || null,
      node,
    })
    const items = result.items.filter((item) => !exclude.has(String(item.key))).slice(0, wanted)
    if (!items.length) {
      return {
        summary: result.items.length
          ? `这一批能推荐的题都看过了（命中 tag：${result.targetTags.join('、')}）。过一阵子或换个知识点再看。`
          : `没挑出合适的题（目标 tag：${result.targetTags.join('、')}；难度窗口 ${result.ratingMin ?? '不限'}–${result.ratingMax ?? '不限'}）。可以放宽难度或换节点。`,
        items: [],
        targetTags: result.targetTags,
      }
    }
    const window = result.ratingMin != null && result.ratingMax != null ? `，难度 ${result.ratingMin}–${result.ratingMax}` : ''
    const lines = [`推荐 ${items.length} 道 Codeforces 练习（命中弱点 tag：${result.targetTags.join('、')}${window}）：`]
    items.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${displayTitle(item)}　${item.rating} 分　[${item.key}]　命中 ${item.hitTags.join('/')}${item.nodes.length ? `　→ ${item.nodes.join('、')}` : ''}`,
      )
      lines.push(`   ${item.url}`)
    })
    return { summary: lines.join('\n'), items, targetTags: result.targetTags }
  }

  /**
   * 面板「薄弱题」：先随机抽一小批候选，再逐题对照知识点掌握度，挑出命中最弱方向的那道。
   *
   * 和 recommend 的区别：不预设目标 tag，而是让候选自己暴露「哪一块最虚」。
   * exclude 用来在面板里连续换题，避免重复。
   */
  /**
   * 面板「薄弱题」：去 AtCoder 原题库随机抽几道没做过的新题，抓题面与题解，
   * 用题面/题解里的关键词对照知识点掌握度，挑出最戳弱点的那道。
   *
   * AtCoder 没有官方标签，所以只能按词面判断；命中的关键词会列在结果里。
   */
  /**
   * 面板「薄弱题」：去 AtCoder 与 Codeforces 题库混合随机抽几道没做过的新题，
   * AtCoder 抓题面/题解按关键词判断，Codeforces 直接用它自己的标签判断，
   * 再挑出最戳弱点的那道。
   */
  async weakProblem(input = {}) {
    const kb = this.kb()
    const analysis = this.analysis()
    const fallbackWeak = (analysis.top || [])[0] || null
    const exclude = new Set((Array.isArray(input.exclude) ? input.exclude : []).map((key) => String(key)))

    const solvedRatings = collectSolved(kb)
      .map((problem) => problem.rating)
      .filter((rating) => Number.isFinite(rating))
      .sort((a, b) => a - b)
    const quantileOf = (p) => (solvedRatings.length ? solvedRatings[Math.floor((solvedRatings.length - 1) * p)] : null)
    const p50 = quantileOf(0.5)
    const p75 = quantileOf(0.75)
    const ratingMin = input.ratingMin != null ? Number(input.ratingMin) : p50 != null ? Math.max(1200, Math.round(p50) - 300) : 1200
    const ratingMax = input.ratingMax != null ? Number(input.ratingMax) : p75 != null ? Math.round(p75) + 300 : 2600

    const rowsById = new Map()
    for (const row of analysis.rows) {
      if (row.tree === 'idea' || !row.parent) continue
      rowsById.set(row.id, row)
    }

    const keywords = new Map()
    const addKeyword = (word, id, weight) => {
      const text = String(word || '').trim().toLowerCase()
      if (text.length < 2) return
      const variants = [text]
      if (/^[a-z][a-z ]+$/.test(text)) {
        if (text.endsWith('ies')) variants.push(text.slice(0, -3) + 'y')
        if (text.endsWith('s') && !text.endsWith('ss')) variants.push(text.slice(0, -1))
        for (const part of text.split(' ')) {
          if (part.length >= 5) variants.push(part)
        }
      }
      for (const variant of variants) {
        const previous = keywords.get(variant)
        if (!previous || previous.weight < weight) keywords.set(variant, { id, weight })
      }
    }
    for (const node of kb.nodes) {
      if (node.tree === 'idea' || node.tree === 'obs' || !node.parent) continue
      addKeyword(node.name, node.id, 3)
      for (const alias of node.aliases || []) addKeyword(alias, node.id, 3)
      for (const tag of node.cfTags || []) {
        addKeyword(tag, node.id, 2)
        for (const extra of EN_TAG_WORDS[tag] || []) addKeyword(extra, node.id, 2)
      }
    }
    for (const [tag, id] of Object.entries(kb.meta.tagMap || {})) {
      addKeyword(tag, id, 2)
      for (const extra of EN_TAG_WORDS[tag] || []) addKeyword(extra, id, 2)
    }
    const classify = (text) => {
      const lower = String(text || '').toLowerCase()
      const counts = new Map()
      for (const [word, meta] of keywords) {
        if (!lower.includes(word)) continue
        counts.set(meta.id, (counts.get(meta.id) || 0) + meta.weight)
      }
      return counts
    }

    const solved = new Set(collectSolved(kb).map((problem) => `${problem.platform}:${problem.key}`))
    const known = new Set(kb.problems.map((problem) => `${problem.platform}:${problem.key}`))

    const atcoderPool = []
    try {
      const resources = await sync.loadAtCoderResources(this.store)
      for (const [key, meta] of Object.entries(resources.problems || {})) {
        const rating = meta.difficulty
        if (rating == null || rating < ratingMin || rating > ratingMax) continue
        if (!meta.contest) continue
        if (solved.has(`atcoder:${key}`) || known.has(`atcoder:${key}`) || exclude.has(key)) continue
        atcoderPool.push({ platform: 'atcoder', key, title: meta.title || key, rating, contest: meta.contest })
      }
    } catch (_) {
      /* 只用 Codeforces */
    }

    const codeforcesPool = []
    try {
      const cache = await sync.loadCodeforcesProblemset(this.store)
      for (const problem of cache.problems || []) {
        if (problem.special) continue
        const rating = problem.rating
        if (rating == null || rating < ratingMin || rating > ratingMax) continue
        const key = `${problem.contestId}${problem.index}`
        if (solved.has(`codeforces:${key}`) || known.has(`codeforces:${key}`) || exclude.has(key)) continue
        codeforcesPool.push({
          platform: 'codeforces',
          key,
          title: problem.name || key,
          rating,
          contestId: problem.contestId,
          index: problem.index,
          tags: problem.tags || [],
        })
      }
    } catch (_) {
      /* 只用 AtCoder */
    }

    if (!atcoderPool.length && !codeforcesPool.length) {
      return {
        summary: `AtCoder 与 Codeforces 题库里 ${ratingMin}–${ratingMax} 分暂时没有可抽的新题了，把难度范围放宽一点再试。`,
        item: null,
        weak: fallbackWeak,
      }
    }

    const shuffle = (list) => {
      const copy = [...list]
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    }
    const want = Math.max(1, Math.min(10, Number(input.candidates) || 6))
    const picked = []
    const atcoderShuffled = shuffle(atcoderPool)
    const codeforcesShuffled = shuffle(codeforcesPool)
    while (picked.length < want && (atcoderShuffled.length || codeforcesShuffled.length)) {
      const useCodeforces = codeforcesShuffled.length > 0 && (atcoderShuffled.length === 0 || Math.random() < 0.5)
      picked.push(useCodeforces ? codeforcesShuffled.pop() : atcoderShuffled.pop())
    }

    const tagMap = kb.meta.tagMap || {}
    const ranked = []
    for (const pick of picked) {
      let counts = new Map()
      if (pick.platform === 'codeforces') {
        // Codeforces 自带标签，直接映射到知识点，比关键词更准。
        for (const tag of pick.tags) {
          const nodeId = tagMap[tag]
          if (!nodeId) continue
          counts.set(nodeId, (counts.get(nodeId) || 0) + 2)
        }
      } else {
        let bundle = { statement: '', editorial: '' }
        try {
          bundle = await sync.fetchAtCoderTaskBundle(pick)
        } catch (_) {
          /* 抓不到就按空文本处理 */
        }
        counts = classify(`${pick.title}\n${bundle.statement}\n${bundle.editorial}`)
      }
      const rows = [...counts.entries()]
        .map(([id, weight]) => ({ row: rowsById.get(id), weight }))
        .filter((hit) => hit.row && hit.row.level !== 'unmeasured')
      if (!rows.length) continue
      rows.sort((a, b) => (LEVEL_RANK[a.row.level] ?? 9) - (LEVEL_RANK[b.row.level] ?? 9) || b.weight - a.weight)
      ranked.push({ pick, rows, weakest: rows[0].row, score: rows[0].weight })
    }

    if (!ranked.length) {
      return {
        summary: `混合随机抽了 ${picked.length} 道新题（${ratingMin}–${ratingMax} 分），没有一道对上可测的知识点。再换一次试试。`,
        item: null,
        weak: fallbackWeak,
        sampled: picked.length,
      }
    }

    ranked.sort(
      (a, b) =>
        (LEVEL_RANK[a.weakest.level] ?? 9) - (LEVEL_RANK[b.weakest.level] ?? 9) ||
        b.score - a.score,
    )
    const best = ranked[0]
    const platform = best.pick.platform
    const titleZh = await sync.translateToChinese(best.pick.title)
    const item = {
      id: `${platform}:${best.pick.key}`,
      platform,
      key: best.pick.key,
      title: best.pick.title,
      titleZh,
      rating: best.pick.rating,
      url:
        platform === 'atcoder'
          ? `https://atcoder.jp/contests/${best.pick.contest}/tasks/${best.pick.key}`
          : `https://codeforces.com/problemset/problem/${best.pick.contestId}/${best.pick.index}`,
      hitTags: best.rows.slice(0, 3).map((hit) => hit.row.name),
      nodes: best.rows.slice(0, 3).map((hit) => hit.row.path),
      weight: best.weakest.risk,
    }
    const reasonText = best.weakest.reasons && best.weakest.reasons.length ? best.weakest.reasons.join('；') : '这一块证据偏少'
    const lines = [
      '## 薄弱题推荐',
      `AtCoder 与 Codeforces 混抽了 ${picked.length} 道（${ratingMin}–${ratingMax} 分），按标签/题面关键词对照知识点掌握度。`,
      `最该补的方向：**${best.weakest.path}**（${LEVEL_TEXT[best.weakest.level] || '—'}，${reasonText}）`,
      '',
      `**${item.titleZh || item.title}**　${item.rating} 分　${platform === 'atcoder' ? 'AT' : 'CF'} ${item.key}`,
      `命中：${item.hitTags.join(' / ')}　→ ${item.nodes.join('、')}`,
      item.url,
    ]
    return { summary: lines.join('\n'), item, weak: best.weakest, sampled: picked.length }
  }

  status() {
    const kb = this.kb()
    const analysis = this.analysis()
    const file = this.store.file
    let size = 0
    try {
      size = fs.statSync(file).size
    } catch (_) {
      size = 0
    }
    const lines = [
      `数据目录：${this.store.dir}`,
      `数据文件：${file}（${(size / 1024).toFixed(1)} KB）`,
      `节点 ${kb.nodes.length} 个，题目 ${kb.problems.length} 道，账号 ${kb.accounts.length} 个，洞察 ${analysis.overview.insights} 条。`,
      kb.meta.lastSeedAt ? `上次 seed：${kb.meta.lastSeedAt.slice(0, 16).replace('T', ' ')}` : '还没 seed 过知识树',
      kb.meta.lastSyncAt ? `上次同步：${kb.meta.lastSyncAt.slice(0, 16).replace('T', ' ')}` : '还没同步过账号',
    ]
    return { summary: lines.join('\n'), dataDir: this.store.dir, overview: analysis.overview }
  }

  // ── 训练：观察闪卡、quiz 定向、组卷 ────────────────────────────────────────

  cardIdOf(nodeId, index) {
    return `p:${nodeId}:${index}`
  }

  reviewsOf(kb, cardId) {
    const list = kb.training?.reviews?.[cardId]
    return Array.isArray(list) ? list : []
  }

  cardStats(kb, cardId) {
    const list = this.reviewsOf(kb, cardId)
    const total = list.length
    const good = list.filter((item) => item.level === 'good' || item.level === 'easy').length
    const lastAt = total ? list[total - 1].at : 0
    const lastLevel = total ? list[total - 1].level : null
    return { total, good, accuracy: total ? good / total : 0, lastAt, lastLevel }
  }

  patternCards(kb) {
    const cards = []
    for (const node of kb.obsNodes || []) {
      const chain = this.obsPath(kb, node.id) || node.name
      ;(node.patterns || []).forEach((pattern, index) => {
        if (!pattern || !pattern.text) return
        cards.push({ cardId: this.cardIdOf(node.id, index), nodeId: node.id, nodePath: chain, pattern })
      })
    }
    return cards
  }

  revealTruth(kb, problem) {
    const lines = ['精髓', problem.essence || '（这道题还没写精髓）']
    const keyIds = new Set(problem.keyObservations || [])
    const keyInsights = (problem.insights || []).filter((insight) => keyIds.has(insight.id) || insight.key)
    const observations = (keyInsights.length ? keyInsights : (problem.insights || []).filter((insight) => insight.kind === 'observation')).slice(0, 2)
    if (observations.length) {
      lines.push('', `关键观察（${observations.length}）`)
      for (const insight of observations) {
        const obs = (insight.obsNodes || []).map((id) => this.obsPath(kb, id)).filter(Boolean).join('、')
        lines.push(`· ${insight.text}${obs ? `（${obs}）` : ''}`)
      }
    }
    lines.push('', `题目：\`${problem.platform}:${problem.key}\`${problem.rating ? `　${problem.rating} 分` : ''}`)
    return lines.join('\n')
  }

  /**
   * 「换一批」：从 AtCoder 原题库随机抽题，做过/已在池里的自动跳过。
   * 抽到的题会当场抓题面与官方题解：题面给面板看，题解留作判方向的兜底依据。
   */
  async sampleQuiz(input = {}) {
    const size = Math.max(1, Math.min(6, Number(input.size) || 3))
    const deferTranslate = input.deferTranslate === true
    const minRating = Number(input.min) || 1200
    const maxRating = Number(input.max) || 2600
    const kb = this.kb()
    const solved = new Set(collectSolved(kb).map((item) => `${item.platform}:${item.key}`))
    const known = new Set(kb.problems.map((problem) => `${problem.platform}:${problem.key}`))

    // 面板点「换一批」：走实时抽题。本地已译池只作为网络失败时的兜底。
    const shown = (kb.training && kb.training.quizShown) || {}
    const now = Date.now()
    const freshWindow = now - 3 * 24 * 3600 * 1000
    const localPool = kb.problems.filter(
      (problem) =>
        problem.pool === 'quiz' &&
        problem.verdict !== 'solved' &&
        String(problem.statementZh || '').trim().length >= 80 &&
        !(Number(shown[`${problem.platform}:${problem.key}`]) > freshWindow),
    )

    const atcoderPool = []
    try {
      const resources = await sync.loadAtCoderResources(this.store)
      for (const [key, meta] of Object.entries(resources.problems || {})) {
        const rating = meta.difficulty
        if (rating == null || rating < minRating || rating > maxRating) continue
        if (!meta.contest) continue
        if (solved.has(`atcoder:${key}`) || known.has(`atcoder:${key}`)) continue
        atcoderPool.push({ platform: 'atcoder', key, title: meta.title || key, rating, contest: meta.contest })
      }
    } catch (_) {
      /* AtCoder 题库拉不下来就只用 Codeforces */
    }

    const codeforcesPool = []
    try {
      const cache = await sync.loadCodeforcesProblemset(this.store)
      for (const problem of cache.problems || []) {
        if (problem.special) continue
        const rating = problem.rating
        if (rating == null || rating < minRating || rating > maxRating) continue
        const key = `${problem.contestId}${problem.index}`
        if (solved.has(`codeforces:${key}`) || known.has(`codeforces:${key}`)) continue
        codeforcesPool.push({
          platform: 'codeforces',
          key,
          title: problem.name || key,
          rating,
          contestId: problem.contestId,
          index: problem.index,
          tags: problem.tags || [],
        })
      }
    } catch (_) {
      /* Codeforces 缓存拉不下来就只用 AtCoder */
    }

    if (!atcoderPool.length && !codeforcesPool.length) {
      fail(`AtCoder 与 Codeforces 题库里 ${minRating}–${maxRating} 分都抽不出没做过的新题了`)
    }

    const pickRandom = (pool) => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
    const picked = []
    const wanted = size * 3
    while (picked.length < wanted && (atcoderPool.length || codeforcesPool.length)) {
      const useCodeforces = codeforcesPool.length > 0 && (atcoderPool.length === 0 || Math.random() < 0.5)
      picked.push(pickRandom(useCodeforces ? codeforcesPool : atcoderPool))
    }

    const items = []
    const skippedZh = []
    const pendingZh = []
    for (const item of picked) {
      if (items.length >= size) break
      if (item.platform === 'atcoder') {
        let bundle = { statement: '', editorial: '' }
        try {
          bundle = await sync.fetchAtCoderTaskBundle(item)
        } catch (_) {
          /* 抓不到就先入库，面板会提示 */
        }
        // 面板要中文：题面与题解都翻成中文；翻译失败就保留英文原文。
        // deferTranslate：先入库英文，等模型（鲸鱼）翻译后回填。
        const statementZh = !deferTranslate && bundle.statement ? await translateFast(bundle.statement.slice(0, 2400)) : ''
        const editorialZh = !deferTranslate && bundle.editorial ? await translateFast(bundle.editorial.slice(0, 3200)) : ''
        const titleZh = deferTranslate ? '' : await translateFast(item.title)
        if (!bundle.statement) {
          skippedZh.push(`atcoder:${item.key}`)
          continue
        }
        if (!statementZh) pendingZh.push(`atcoder:${item.key}`)
        this.addProblem({
          platform: 'atcoder',
          key: item.key,
          title: item.title,
          titleZh: titleZh && titleZh !== item.title ? titleZh : '',
          rating: item.rating,
          verdict: 'unsolved',
          pool: 'quiz',
          url: `https://atcoder.jp/contests/${item.contest}/tasks/${item.key}`,
          statement: bundle.statement || '',
          statementZh,
          solution: editorialZh || bundle.editorial || '',
        })
        items.push({
          platform: 'atcoder',
          key: item.key,
          title: item.title,
          titleZh: titleZh && titleZh !== item.title ? titleZh : '',
          rating: item.rating,
          hasStatement: Boolean(bundle.statement),
          hasChinese: Boolean(statementZh),
          hasEditorial: Boolean(bundle.editorial),
          ...(deferTranslate ? { statement: bundle.statement.slice(0, 2600) } : {}),
        })
      } else {
        let bundle = { statement: '' }
        try {
          bundle = await sync.fetchCodeforcesTaskBundle(item)
        } catch (_) {
          /* 抓不到题面就只留标题与链接 */
        }
        const statementZh = !deferTranslate && bundle.statement ? await translateFast(bundle.statement.slice(0, 2400)) : ''
        const titleZh = deferTranslate ? '' : await translateFast(item.title)
        if (!bundle.statement) {
          skippedZh.push(`codeforces:${item.key}`)
          continue
        }
        if (!statementZh) pendingZh.push(`codeforces:${item.key}`)
        this.addProblem({
          platform: 'codeforces',
          key: item.key,
          title: item.title,
          titleZh: titleZh && titleZh !== item.title ? titleZh : '',
          rating: item.rating,
          tags: item.tags,
          verdict: 'unsolved',
          pool: 'quiz',
          url: `https://codeforces.com/problemset/problem/${item.contestId}/${item.index}`,
          statement: bundle.statement || '',
          statementZh,
        })
        items.push({
          platform: 'codeforces',
          key: item.key,
          title: item.title,
          titleZh: titleZh && titleZh !== item.title ? titleZh : '',
          rating: item.rating,
          hasStatement: Boolean(bundle.statement),
          hasChinese: Boolean(statementZh),
          hasEditorial: false,
          tags: item.tags,
          ...(deferTranslate ? { statement: bundle.statement.slice(0, 2600) } : {}),
        })
      }
    }
    const atcoderCount = items.filter((item) => item.platform === 'atcoder').length
    const codeforcesCount = items.length - atcoderCount
    if (!items.length) {
      fail('这一轮抽到的题都没有拿到题面（抓取通道暂时不可用），稍后再点「换一批」试试')
    }
    if (!deferTranslate) {
      this.store.mutate((draft) => {
        if (!draft.training) draft.training = { reviews: {}, attempts: [], sessions: [], quizShown: {} }
        if (!draft.training.quizShown) draft.training.quizShown = {}
        for (const item of items) draft.training.quizShown[`${item.platform}:${item.key}`] = Date.now()
        // 没翻出来的题进队列，等模型（鲸鱼）补齐中文题意。
        if (pendingZh.length) {
          const queue = new Set(Array.isArray(draft.training.translateQueue) ? draft.training.translateQueue : [])
          for (const key of pendingZh) queue.add(key)
          draft.training.translateQueue = [...queue]
        }
      })
    }
    if (deferTranslate) {
      // 补货模式：把英文题面原样返回给模型，由模型翻好再回填 statementZh/titleZh。
      const blocks = items
        .map((item) => `### ${item.platform}:${item.key}｜${item.title}｜${item.rating ?? '?'} 分\n${item.statement}`)
        .join('\n\n')
      return {
        summary: [
          `## 已入库 ${items.length} 道新题（等翻译）`,
          `AtCoder ${atcoderCount} 道、Codeforces ${codeforcesCount} 道；下面是英文题面，翻好后用 oi_problem action=update 回填 statementZh/titleZh。`,
          '',
          blocks,
        ].join('\n'),
        items,
        skipped: skippedZh,
      }
    }
    return {
      summary: [
        '## 新题已就绪',
        `AtCoder 与 Codeforces 混抽了 ${items.length} 道（${minRating}–${maxRating} 分，AtCoder ${atcoderCount} 道、Codeforces ${codeforcesCount} 道，自动跳过做过和池里已有的）：`,
        ...items.map(
          (item) =>
            `- ${item.platform === 'atcoder' ? 'AT' : 'CF'} ${item.key} ${displayTitle(item)}（${item.rating}${item.hasChinese ? '，已译成中文' : '，中文待补'}）`,
        ),
        ...(skippedZh.length ? [`- 跳过 ${skippedZh.length} 道（题面没抓到）：${skippedZh.join('、')}`] : []),
        ...(pendingZh.length ? [`- ${pendingZh.length} 道中文题意待补：${pendingZh.join('、')}（已排队，稍后刷新面板即可）`] : []),
      ].join('\n'),
      items,
      skipped: skippedZh,
      pendingZh,
    }
  }

  /**
   * 补抓 quiz 池里题面缺失的新题（多为 Host web 抓取偶发失败）。
   * 只补题面/中文题面，不动已有内容。
   */
  /** 列出排队等中文的 quiz 题（给模型翻译用）。 */
  pendingTranslations(input = {}) {
    const limit = Math.max(1, Math.min(20, Number(input.limit) || 6))
    const kb = this.kb()
    const queue = Array.isArray(kb.training?.translateQueue) ? kb.training.translateQueue : []
    const rows = []
    for (const ref of queue) {
      const [platform, ...rest] = String(ref).split(':')
      const key = rest.join(':')
      const problem = kb.problems.find((item) => item.platform === platform && item.key === key)
      if (!problem) continue
      rows.push({
        ref,
        title: problem.title,
        rating: problem.rating,
        hasZh: String(problem.statementZh || '').trim().length >= 80,
        statement: String(problem.statement || '').slice(0, 2600),
      })
    }
    const pending = rows.filter((row) => !row.hasZh).slice(0, limit)
    if (!pending.length) {
      return { summary: '翻译队列是空的，quiz 题都有中文题意了。', count: 0, items: [] }
    }
    const blocks = pending
      .map((row) => `### ${row.ref}｜${row.title || row.ref}｜${row.rating ?? '?'} 分\n${row.statement}`)
      .join('\n\n')
    return {
      summary: [
        `## 待翻译 ${pending.length} 道（队列共 ${rows.length} 道）`,
        '把下面每题翻成 2–5 句中文（公式用 $…$），再用 oi_train action=apply_zh 回填。',
        '',
        blocks,
      ].join('\n'),
      count: pending.length,
      items: pending,
    }
  }

  /** 回填中文题意：items = [{ ref, titleZh?, zh }]。 */
  applyTranslations(input = {}) {
    const list = Array.isArray(input.items) ? input.items : []
    if (!list.length) fail('apply_zh 需要 items: [{ ref, titleZh?, zh }]')
    let applied = 0
    const missing = []
    this.store.mutate((draft) => {
      if (!draft.training) draft.training = { reviews: {}, attempts: [], sessions: [] }
      const queue = new Set(Array.isArray(draft.training.translateQueue) ? draft.training.translateQueue : [])
      for (const entry of list) {
        const ref = String(entry.ref || '').trim()
        if (!ref) continue
        const [platform, ...rest] = ref.split(':')
        const key = rest.join(':')
        const problem = draft.problems.find((item) => item.platform === platform && item.key === key)
        if (!problem) {
          missing.push(ref)
          continue
        }
        const zh = String(entry.zh || '').trim()
        if (zh.length >= 20) problem.statementZh = zh
        if (entry.titleZh) problem.titleZh = String(entry.titleZh).trim()
        problem.updatedAt = nowIso()
        queue.delete(ref)
        applied += 1
      }
      draft.training.translateQueue = [...queue]
    })
    return {
      summary: `已回填 ${applied} 道中文题意${missing.length ? `，另有 ${missing.length} 道在库里找不到：${missing.join('、')}` : ''}。刷新面板即可看到。`,
      applied,
      missing,
    }
  }

  /** 诊断：逐个 provider 试翻译，返回各自耗时与结果，不写库。 */
  async probeTranslate(input = {}) {
    const text = String(input.text || 'We have N cards arranged in a row. Flip any number of them.')
    const rows = await sync.probeTranslate(text)
    if (!rows.length) return { summary: '## 翻译通道探测\n没有拿到任何 provider 的响应。', rows }
    const lines = rows.map((row) => {
      if (row.error) return `- ${row.provider}：失败（${row.error}）`
      if (row.note) return `- ${row.provider}：${row.note}`
      const verdict = row.chinese ? '中文 ✓' : '未返回中文'
      return `- ${row.provider}：${verdict}，${row.ms}ms${row.sample ? `，样例「${row.sample}」` : ''}`
    })
    const ok = rows.filter((row) => row.chinese).map((row) => row.provider)
    return {
      summary: ['## 翻译通道探测', ...lines, '', ok.length ? `可用 provider：${ok.join(' → ')}` : '没有一个 provider 返回中文；只能等配额恢复或用模型翻译。'].join('\n'),
      rows,
    }
  }

  async repairQuizStatements() {    const kb = this.kb()
    const todo = (kb.problems || []).filter(
      (problem) =>
        problem.pool === 'quiz' &&
        (String(problem.statement || '').trim().length < 80 || !String(problem.statementZh || '').trim()),
    )
    if (!todo.length) return { summary: 'quiz 池里的题面都齐了，没有要补的。', fixed: 0, failed: 0 }
    let resources = null
    try {
      resources = await sync.loadAtCoderResources(this.store)
    } catch (_) {
      resources = null
    }
    let fixed = 0
    let translated = 0
    const failed = []
    for (const problem of todo) {
      let statement = String(problem.statement || '').trim()
      let editorial = ''
      if (statement.length < 80) {
        let bundle = { statement: '' }
        if (problem.platform === 'codeforces') {
          const matched = String(problem.key).match(/^(\d+)([A-Za-z]\d?)$/)
          if (matched) bundle = await sync.fetchCodeforcesTaskBundle({ contestId: Number(matched[1]), index: matched[2] })
        } else if (problem.platform === 'atcoder') {
          const contest = resources?.problems?.[problem.key]?.contest
          if (contest) bundle = await sync.fetchAtCoderTaskBundle({ key: problem.key, contest })
        }
        statement = String(bundle.statement || '').trim()
        editorial = String(bundle.editorial || '').trim()
        if (!statement) {
          failed.push(`${problem.platform}:${problem.key}`)
          continue
        }
      }
      const statementZh = await sync.translateToChinese(statement.slice(0, 2400))
      const titleZh = problem.titleZh || (await sync.translateToChinese(problem.title || problem.key))
      if (statementZh) translated += 1
      this.mutate((target) => {
        const entity = target.problems.find((item) => item.id === problem.id)
        if (!entity) return
        entity.statement = statement
        entity.statementZh = statementZh
        entity.titleZh = titleZh
        if (editorial && !String(entity.solution || '').trim()) entity.solution = editorial
      })
      fixed += 1
    }
    return {
      summary: [
        `已补题面 ${fixed} 道${translated ? `（其中 ${translated} 道译成中文）` : ''}${failed.length ? `；仍失败 ${failed.length} 道：${failed.slice(0, 5).join('、')}${failed.length > 5 ? '…' : ''}` : '。'}`,
        translated < fixed ? '有题面但缺中文的：翻译通道此刻可能被限流，稍后重试 repair 即可。' : '',
        fixed ? '刷新面板即可看到。' : '',
      ]
        .filter(Boolean)
        .join('\n'),
      fixed,
      failed: failed.length,
    }
  }

  trainCard(input = {}) {
    const kb = this.kb()
    const want = input.kind === 'problem' ? 'problem' : input.kind === 'pattern' ? 'pattern' : ''
    const cards = this.patternCards(kb)
    const problems = (kb.problems || []).filter(
      (problem) =>
        problem.pool !== 'quiz' &&
        problem.essence &&
        (problem.keyObservations || []).length &&
        String(problem.statement || '').trim().length >= 120 &&
        String(problem.statementZh || '').trim().length >= 80,
    )
    const useProblem = want === 'problem' || (!want && problems.length > 0)
    if (useProblem) {
      if (!problems.length) fail('还没有带中文题面的题目（中文题面 ≥80 字），先跑 oi_train action=repair 或补录题面')
      const weighted = problems.map((problem) => {
        const boost = problem.stuckStage === 'observe' ? 1.2 : 0
        const attempts = (kb.training?.attempts || []).filter((item) => item.problemKey === problem.key).length
        return { problem, weight: 1 + boost + Math.random() * 0.6 - Math.min(attempts, 3) * 0.15 }
      })
      weighted.sort((a, b) => b.weight - a.weight)
      const picked = weighted[0].problem
      // 面板只呈现中文题面；没有中文就不出这张卡。
      const zh = String(picked.statementZh || '').trim()
      const hasMath = (zh.match(/\$/g) || []).length >= 2
      const statement = briefStatement(hasMath ? zh : wrapInlineMath(plainMath(zh)))
      const answer = this.revealTruth(kb, picked)
      return {
        summary: [
          `## 闪卡（看题找观察）`,
          `题目：${displayTitle(picked) || picked.key}　${picked.rating ? `${picked.rating} 分` : ''}　（来源已隐藏，先自己想）`,
          '',
          statement,
          '',
          '先自己说出：这题最关键的一步观察是什么，再翻面。',
        ].join('\n'),
        card: {
          cardId: `q:${picked.key}`,
          kind: 'problem',
          title: picked.title,
          rating: picked.rating,
          question: statement,
          answer: String(answer).replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, ''),
        },
      }
    }
    if (!cards.length) fail('观察树还没有句式，先在 oi_kb action=seed 里补')
    let nodeId = null
    if (input.node) {
      const found = findObsNode(kb, input.node)
      if (!found) fail(`找不到观察节点「${input.node}」，先用 oi_kb action=tree tree=obs 看路径`)
      nodeId = found.id
    }
    const scored = cards
      .filter((card) => !nodeId || card.nodeId === nodeId)
      .map((card) => {
        const stats = this.cardStats(kb, card.cardId)
        // 卡片间隔：again 立刻、hard 1 天、good 3 天、easy 7 天；到期的优先，没到期仍可抽但降权。
        const intervalDays = { again: 0, hard: 1, good: 3, easy: 7 }[stats.lastLevel] || 0
        const dueAt = (stats.lastAt || 0) + intervalDays * 86400000
        const due = !stats.total || Date.now() >= dueAt
        return { card, score: (1 - stats.accuracy) * 2 + (due ? 1.4 : -0.6) + Math.random() * 0.4, stats }
      })
      .sort((a, b) => b.score - a.score)
    if (!scored.length) fail(`观察节点「${input.node}」下还没有带证据的句式卡`)
    const picked = scored[Math.floor(Math.random() * Math.min(6, scored.length))]
    const trigger = triggerOf(picked.card.pattern.text)
    const answer = [
      `**完整句式**：${picked.card.pattern.text}`,
      picked.card.pattern.examples?.length ? `**例子**：${picked.card.pattern.examples.map((item) => item.title || item.id).filter(Boolean).slice(0, 4).join('、')}` : '',
      `**观察方向**：${picked.card.nodePath}`,
    ].filter(Boolean).join('\n')
    return {
      summary: [
        '## 闪卡（补结论）',
        `观察方向：${picked.card.nodePath}`,
        '',
        `**触发条件**：${trigger}`,
        '',
        '先补出这条观察的结论 / 用法，再翻面。',
        picked.stats.total ? `（这张卡复习 ${picked.stats.total} 次，命中 ${picked.stats.good} 次）` : '（第一次见这张卡）',
      ].join('\n'),
      card: {
        cardId: picked.card.cardId,
        kind: 'pattern',
        nodePath: picked.card.nodePath,
        question: trigger,
        answer: answer.replace(/\*\*/g, ''),
      },
    }
  }

  trainMarkCard(input = {}) {
    const cardId = String(input.cardId || '').trim()
    if (!cardId) fail('缺少 cardId')
    if (!CARD_LEVELS.includes(input.level)) fail(`level 只能是 ${CARD_LEVELS.join(' / ')}`)
    const ms = Number.isFinite(Number(input.ms)) ? Math.max(0, Math.round(Number(input.ms))) : null
    const review = { at: Date.now(), level: input.level, ms }
    const result = this.mutate((kb) => {
      if (!kb.training.reviews[cardId]) kb.training.reviews[cardId] = []
      kb.training.reviews[cardId].push(review)
      if (kb.training.reviews[cardId].length > 60) kb.training.reviews[cardId] = kb.training.reviews[cardId].slice(-60)
      return this.cardStats(kb, cardId)
    })
    const intervalDays = { again: 0, hard: 1, good: 3, easy: 7 }[input.level]
    const due = new Date(Date.now() + intervalDays * 86400000)
    return {
      summary: [
        `已记录：${CARD_LEVEL_LABEL[input.level]}（${ms !== null ? `${(ms / 1000).toFixed(1)} 秒` : '未计时'}）`,
        `累计复习 ${result.total} 次，命中 ${result.good} 次（${Math.round(result.accuracy * 100)}%）`,
        intervalDays ? `下次 ${intervalDays} 天后再抽：${due.toISOString().slice(0, 10)}` : '这张卡马上会再抽到',
      ].join('\n'),
      stats: result,
    }
  }

  trainAttempt(input = {}) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const text = String(input.text || '').trim()
    if (!text) fail('思路不能为空')
    const ms = Number.isFinite(Number(input.ms)) ? Math.max(0, Math.round(Number(input.ms))) : null
    const round = (kb.training.attempts || []).filter((item) => item.problemKey === problem.key).length + 1
    const attempt = {
      id: `a${Date.now().toString(36)}`,
      problemKey: problem.key,
      text,
      at: Date.now(),
      ms,
      round,
      result: null,
      note: '',
    }
    this.mutate((target) => {
      target.training.attempts.push(attempt)
      if (target.training.attempts.length > 400) target.training.attempts = target.training.attempts.slice(-400)
    })
    return {
      summary: [
        `已收到第 ${round} 轮思路（${ms !== null ? `${(ms / 60000).toFixed(1)} 分钟` : '未计时'}）。`,
        '',
        '答案先不揭示。把思路发到对话里，我对照真值判方向。',
      ].join('\n'),
      attempt,
    }
  }

  judgeFacets(kb, problem) {
    const facets = []
    const essence = String(problem.essence || '').trim()
    if (essence) facets.push({ label: '精髓', text: essence, tokens: judgeTokens(essence), chars: judgeChars(essence) })
    const insights = problem.insights || []
    const keyIds = new Set(problem.keyObservations || [])
    const chosen = insights.filter((insight) => insight.kind === 'observation' && (insight.key === true || keyIds.has(insight.id)))
    const rest = insights.filter((insight) => !chosen.includes(insight)).slice(0, 6)
    const list = chosen.concat(rest)
    for (const insight of list) {
      const paths = (insight.obsNodes || []).map((id) => this.obsPath(kb, id)).filter(Boolean)
      const extra = paths.map((path) => String(path).split('/').slice(1)).flat().join(' ')
      const text = `${insight.text} ${extra}`
      facets.push({ label: paths[0] || KIND_LABEL[insight.kind] || '观察', text: insight.text, tokens: judgeTokens(text), chars: judgeChars(text) })
    }
    // 没来得及写精髓的「现抽新题」：退而用官方题解的关键句子当判据。
    if (!facets.length && problem.solution) {
      const sentences = String(problem.solution)
        .split(/(?<=[.!?。！？])\s+|\n+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 20 && sentence.length <= 260)
        .slice(0, 40)
      for (const sentence of sentences) {
        facets.push({ label: '题解要点', text: sentence, tokens: judgeTokens(sentence), chars: judgeChars(sentence) })
      }
    }
    return facets
  }

  trainJudge(input = {}) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const text = String(input.text || '').trim()
    if (!text) fail('思路不能为空')
    const round = Number.isFinite(Number(input.round))
      ? Math.max(1, Math.min(2, Math.round(Number(input.round))))
      : (() => {
          // 只数「本轮尚未判分」的提交：上次判分之后重新开始算第一轮。
          const attempts = kb.training.attempts || []
          let start = 0
          attempts.forEach((item, index) => {
            if (item.problemKey === problem.key && item.result) start = index + 1
          })
          const pending = attempts.slice(start).filter((item) => item.problemKey === problem.key).length
          return Math.min(2, pending + 1)
        })()
    const userTokens = judgeTokens(text)
    const userChars = judgeChars(text)
    const facets = this.judgeFacets(kb, problem)
    let best = null
    for (const facet of facets) {
      const size = Math.max(4, Math.min(12, facet.tokens.size))
      let overlap = 0
      for (const token of userTokens) if (facet.tokens.has(token)) overlap += 1
      const ratio = overlap / size
      let shared = 0
      for (const char of userChars) if (facet.chars.has(char)) shared += 1
      const charRatio = userChars.size ? shared / Math.max(6, Math.min(12, userChars.size)) : 0
      const score = Math.max(ratio, charRatio * 0.9)
      if (!best || score > best.score) best = { facet, overlap, ratio, shared, charRatio, score }
    }
    const hit = Boolean(best && (best.ratio >= 0.3 || (best.charRatio >= 0.5 && best.shared >= 6)))
    const result = hit ? (round >= 2 ? 'hit2' : 'hit1') : round >= 2 ? 'miss' : null
    const truth = this.revealTruth(kb, problem)
    const lines = []
    if (hit) {
      lines.push(`方向命中（第 ${round} 轮）：你提到了「${best.facet.label}」这一层。`)
      lines.push('', truth)
    } else if (round < 2) {
      const hint = best && best.overlap > 0 ? `你接近了「${best.facet.label}」，但关键的一步还没说出来。` : '没命中关键观察。'
      lines.push(`方向不对（第 ${round} 轮）。${hint}`, '', '再想一个方向；两轮不中或点「公布真值」再看答案。')
    } else {
      lines.push('两轮都没中，看真值。', '', truth)
    }
    const revealed = hit || round >= 2
    const latest = (kb.training.attempts || []).filter((item) => item.problemKey === problem.key).pop()
    if (latest && result) {
      this.mutate((target) => {
        const targetAttempt = (target.training.attempts || []).filter((item) => item.problemKey === problem.key).pop()
        if (targetAttempt && !targetAttempt.result) {
          targetAttempt.result = result
          if (best && hit) targetAttempt.note = best.facet.label
        }
      })
    }
    return {
      summary: lines.join('\n'),
      hit,
      revealed,
      result,
      round,
      matched: best ? { label: best.facet.label, overlap: best.overlap, ratio: Math.round(best.ratio * 100) } : null,
    }
  }

  trainReview(input = {}) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const round = Number.isFinite(Number(input.round)) ? Math.max(1, Math.min(2, Math.round(Number(input.round)))) : 1
    const hit = input.hit === true || input.hit === 'true'
    if (!hit && round < 2) {
      return {
        summary: [
          '方向不对，再想一个（第 1 轮）。',
          '',
          '提示：不揭示真值；把第二个方向发到对话里即可。',
        ].join('\n'),
        revealed: false,
      }
    }
    const result = hit ? (round >= 2 ? 'hit2' : 'hit1') : 'miss'
    if (hit || round >= 2) {
      const truth = this.revealTruth(kb, problem)
      // 与 trainJudge 对齐：人工复核出结果时也回写最近一次 attempt，统计里才能看到 hit1/hit2/miss。
      const latest = (kb.training.attempts || []).filter((item) => item.problemKey === problem.key).pop()
      if (latest) {
        this.mutate((target) => {
          const targetAttempt = (target.training.attempts || []).filter((item) => item.problemKey === problem.key).pop()
          if (targetAttempt && !targetAttempt.result) targetAttempt.result = result
        })
      }
      return {
        summary: [hit ? `方向命中（第 ${round} 轮）。` : '两轮都没中，看真值。', '', truth].join('\n'),
        revealed: true,
        truth,
        result,
      }
    }
    return { summary: '方向不对，再想一个（第 1 轮）。', revealed: false }
  }

  trainReveal(input = {}) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    return { summary: this.revealTruth(kb, problem), revealed: true }
  }

  trainGrade(input = {}) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.problem)
    const result = String(input.result || '')
    if (!['hit1', 'hit2', 'miss'].includes(result)) fail('result 只能是 hit1 / hit2 / miss')
    const note = String(input.note || '').trim()
    const ms = Number.isFinite(Number(input.ms)) ? Math.max(0, Math.round(Number(input.ms))) : null
    let updated = 0
    this.mutate((target) => {
      const list = target.training.attempts.filter((item) => item.problemKey === problem.key)
      const latest = list[list.length - 1]
      if (latest) {
        latest.result = result
        if (note) latest.note = note
        if (ms !== null) latest.ms = ms
        updated = 1
      }
    })
    if (!updated) fail('这道题还没有 pending attempt，先 action=attempt')
    return {
      summary: `已记录成绩：${result === 'hit1' ? '第一轮命中' : result === 'hit2' ? '第二轮命中' : '两轮没中'}${note ? `（${note}）` : ''}`,
      result,
    }
  }

  sessionStart(input = {}) {
    const kb = this.kb()
    const keys = (Array.isArray(input.keys) ? input.keys : []).map((key) => String(key).trim()).filter(Boolean)
    if (!keys.length) fail('缺少 keys：传这次要做的题号列表（5 道）')
    const id = `s${Date.now().toString(36)}`
    const session = { id, startedAt: Date.now(), endedAt: null, keys, startTimes: {}, results: {} }
    this.mutate((target) => {
      target.training.sessions.push(session)
      if (target.training.sessions.length > 40) target.training.sessions = target.training.sessions.slice(-40)
    })
    return {
      summary: [`组卷开始：${keys.join('、')}`, `场次 ${id}，开始时间 ${new Date(session.startedAt).toLocaleString('zh-CN')}。`, '每题点开时记录开始时间，交卷时用 action=session_finish 结算。'].join('\n'),
      session,
    }
  }

  sessionTouch(input = {}) {
    const kb = this.kb()
    const session = (kb.training.sessions || []).find((item) => item.id === input.session)
    if (!session) fail('找不到这个场次')
    const key = String(input.problem || '').trim()
    if (!key) fail('缺少 problem')
    const at = Date.now()
    this.mutate((target) => {
      const targetSession = target.training.sessions.find((item) => item.id === input.session)
      targetSession.startTimes[key] = at
    })
    return { summary: `已记录 ${key} 的开题时间。`, at }
  }

  sessionFinish(input = {}) {
    const kb = this.kb()
    const session = (kb.training.sessions || []).find((item) => item.id === input.session)
    if (!session) fail('找不到这个场次')
    const acTimes = input.acTimes && typeof input.acTimes === 'object' ? input.acTimes : {}
    const endedAt = Date.now()
    const rows = []
    for (const key of session.keys) {
      const start = Number(session.startTimes[key]) || session.startedAt
      const raw = acTimes[key]
      let ac = null
      let source = 'manual'
      if (raw !== undefined && raw !== null && raw !== '') {
        const parsed = typeof raw === 'number' ? raw : Date.parse(raw)
        if (Number.isFinite(parsed)) ac = parsed
      }
      if (!ac) {
        // 退回到账号同步里记录的 AC 时间（CF creationTimeSeconds / AtCoder epoch_second）。
        for (const platform of Object.keys(kb.solved || {})) {
          for (const handle of Object.keys(kb.solved[platform] || {})) {
            const entry = kb.solved[platform][handle]?.[key]
            if (!entry || !entry.solvedAt) continue
            const parsed = Date.parse(entry.solvedAt)
            if (Number.isFinite(parsed) && parsed >= start) {
              ac = parsed
              source = 'synced'
              break
            }
          }
          if (ac) break
        }
      }
      const ms = ac ? Math.max(0, ac - start) : null
      rows.push({ key, start, ac, ms, source: ac ? source : null, acOk: Boolean(ac) })
    }
    const totalMs = rows.reduce((sum, row) => sum + (row.ms || 0), 0)
    this.mutate((target) => {
      const targetSession = target.training.sessions.find((item) => item.id === input.session)
      targetSession.endedAt = endedAt
      for (const row of rows) targetSession.results[row.key] = { ac: row.ac, ms: row.ms }
    })
    const lines = [`## 场次结算 ${session.id}`, `开始 ${new Date(session.startedAt).toLocaleTimeString('zh-CN')}，结束 ${new Date(endedAt).toLocaleTimeString('zh-CN')}`, '']
    for (const row of rows) {
      lines.push(`- ${row.key}：${row.ms !== null ? `${(row.ms / 60000).toFixed(1)} 分钟` : 'AC 时间未提供'}`)
    }
    lines.push('', `合计已记录用时 ${(totalMs / 60000).toFixed(1)} 分钟。`)
    return { summary: lines.join('\n'), rows }
  }

  trainStats() {
    const kb = this.kb()
    const cards = this.patternCards(kb)
    const perNode = new Map()
    for (const card of cards) {
      const stats = this.cardStats(kb, card.cardId)
      if (!perNode.has(card.nodeId)) perNode.set(card.nodeId, { nodeId: card.nodeId, nodePath: card.nodePath, cards: 0, reviews: 0, good: 0 })
      const entry = perNode.get(card.nodeId)
      entry.cards += 1
      entry.reviews += stats.total
      entry.good += stats.good
    }
    const rows = [...perNode.values()]
      .map((row) => ({ ...row, accuracy: row.reviews ? row.good / row.reviews : null }))
      .sort((a, b) => (a.accuracy ?? -1) - (b.accuracy ?? -1))
    const attempts = kb.training.attempts || []
    const hit1 = attempts.filter((item) => item.result === 'hit1').length
    const hit2 = attempts.filter((item) => item.result === 'hit2').length
    const miss = attempts.filter((item) => item.result === 'miss').length
    const lines = [
      '## 训练统计',
      `闪卡：${cards.length} 张，已复习 ${[...perNode.values()].reduce((sum, row) => sum + row.reviews, 0)} 次；按召回率最低的方向：`,
      ...rows.slice(0, 8).map((row) => `- ${row.nodePath}：${row.reviews ? `${Math.round(row.accuracy * 100)}%（${row.good}/${row.reviews}）` : '还没复习'}`),
      '',
      `新题定向：${hit1 + hit2 + miss} 次记录，第一轮命中 ${hit1}、第二轮命中 ${hit2}、两轮没中 ${miss}。`,
    ]
    return { summary: lines.join('\n'), rows, quiz: { hit1, hit2, miss } }
  }

  // ── Web 面板 ─────────────────────────────────────────────────────────────

  state() {
    const kb = this.kb()
    const analysis = this.analysis()
    const nodes = analysis.rows.map((row) => ({
      id: row.id,
      name: row.name,
      parent: row.parent,
      path: row.path,
      depth: row.depth,
      kind: row.kind,
      summary: row.summary,
      signals: row.signals,
      note: row.note,
      mastery: row.mastery,
      score: row.score,
      level: row.level,
      risk: row.risk,
      solvedCount: row.solvedCount,
      attemptedCount: row.attemptedCount,
      unsolvedCount: row.unsolvedCount,
      insightCount: row.insightCount,
      insightKinds: row.insightKinds,
      linkedProblems: row.linkedProblems,
      tree: row.tree,
      p75: row.p75,
      maxRating: row.maxRating,
      reasons: row.reasons,
    }))
    const problems = kb.problems.map((problem) => ({
      id: problem.id,
      platform: problem.platform,
      key: problem.key,
      title: problem.title,
      titleZh: problem.titleZh || '',
      url: problem.url,
      rating: problem.rating,
      tags: problem.tags,
      verdict: problem.verdict,
      stuckStage: problem.stuckStage || null,
      difficulty: problem.difficulty,
      essence: problem.essence,
      nodes: problem.nodes,
      pool: problem.pool || null,
      nodePaths: problem.nodes.map((id) => analysis.rowsById.get(id)?.path || id),
      keyObservations: problem.keyObservations,
      insights: problem.insights.map((insight) => ({
        id: insight.id,
        kind: insight.kind,
        text: insight.text,
        nodes: insight.nodes,
        obsNodes: insight.obsNodes || [],
        key: insight.key === true,
      })),
      insightCount: problem.insights.length,
      hasSolution: problem.solution !== '',
      hasStatement: problem.statement !== '',
      createdAt: problem.createdAt,
    }))
    // top / ideaTop 只需要面板展示用的字段；完整洞察列表由 problemDetail 按需取。
    const slimRow = (row) => ({
      id: row.id,
      name: row.name,
      parent: row.parent,
      path: row.path,
      kind: row.kind,
      level: row.level,
      risk: row.risk,
      score: row.score,
      coverage: row.coverage,
      dataScore: row.dataScore,
      solvedCount: row.solvedCount,
      attemptedCount: row.attemptedCount,
      unsolvedCount: row.unsolvedCount,
      insightCount: row.insightCount,
      insightKinds: row.insightKinds,
      linkedProblems: row.linkedProblems,
      maxRating: row.maxRating,
      p75: row.p75,
      measured: row.measured,
      ceilingGap: row.ceilingGap,
      reasons: row.reasons,
    })
    const accounts = kb.accounts.map((account) => ({
      id: account.id,
      platform: account.platform,
      handle: account.handle,
      hasCookie: Boolean(account.cookie),
      lastSyncAt: account.lastSyncAt,
      lastResult: account.lastResult,
      solvedCount: solvedCountFor(kb, account).total,
    }))
    return {
      dataDir: this.store.dir,
      updatedAt: kb.updatedAt,
      revision: this.store.revision,
      nodes,
      problems,
      accounts,
      training: {
        reviews: kb.training.reviews || {},
        attempts: (kb.training.attempts || []).slice(-40),
        sessions: (kb.training.sessions || []).slice(-6),
        quiz: kb.problems
          .filter((problem) => problem.pool === 'quiz')
          .map((problem) => ({
            id: problem.id,
            key: problem.key,
            platform: problem.platform,
            title: problem.title,
            titleZh: problem.titleZh || '',
            rating: problem.rating,
            url: problem.url || defaultProblemUrl(problem.platform, problem.key),
            statement: problem.statement || '',
            statementZh: problem.statementZh || '',
            verdict: problem.verdict,
          })),
      },
      obsNodes: (() => {
        const childrenOf = new Map()
        for (const node of kb.obsNodes) {
          const list = childrenOf.get(node.parent) || []
          list.push(node)
          childrenOf.set(node.parent, list)
        }
        const direct = new Map()
        for (const problem of kb.problems) {
          for (const insight of problem.insights || []) {
            for (const id of insight.obsNodes || []) direct.set(id, (direct.get(id) || 0) + 1)
          }
        }
        const subtree = new Map()
        const subtreeProblems = new Map()
        const subtreeVerified = new Map()
        const directProblems = new Map()
        const directVerified = new Map()
        for (const problem of kb.problems) {
          for (const insight of problem.insights || []) {
            for (const id of insight.obsNodes || []) {
              if (!directProblems.has(id)) directProblems.set(id, new Set())
              directProblems.get(id).add(problem.id)
            }
          }
        }
        for (const node of kb.obsNodes) {
          directVerified.set(node.id, (node.patterns || []).filter((pattern) => pattern && pattern.verified).length)
        }
        const totalOf = (id) => {
          if (subtree.has(id)) return subtree.get(id)
          let total = direct.get(id) || 0
          for (const child of childrenOf.get(id) || []) total += totalOf(child.id)
          subtree.set(id, total)
          return total
        }
        const problemsOf = (id) => {
          if (subtreeProblems.has(id)) return subtreeProblems.get(id)
          const set = new Set(directProblems.get(id) || [])
          for (const child of childrenOf.get(id) || []) {
            for (const problemId of problemsOf(child.id)) set.add(problemId)
          }
          subtreeProblems.set(id, set)
          return set
        }
        const verifiedOf = (id) => {
          if (subtreeVerified.has(id)) return subtreeVerified.get(id)
          let total = directVerified.get(id) || 0
          for (const child of childrenOf.get(id) || []) total += verifiedOf(child.id)
          subtreeVerified.set(id, total)
          return total
        }
        const levelOfObs = obsLevelOf
        return kb.obsNodes.map((node) => {
          const chain = []
          let cursor = node
          while (cursor) {
            chain.unshift(cursor.name)
            cursor = cursor.parent ? kb.obsNodes.find((item) => item.id === cursor.parent) : null
          }
          const assignments = direct.get(node.id) || 0
          const count = totalOf(node.id)
          const problems = problemsOf(node.id).size
          const verified = verifiedOf(node.id)
          return {
            id: node.id,
            parent: node.parent,
            name: node.name,
            summary: node.summary,
            path: chain.join('/'),
            tree: 'obs',
            patterns: node.patterns || [],
            assignments,
            count,
            problems,
            verified,
            level: levelOfObs(count, problems, verified),
          }
        })
      })(),
      overview: {
        ...analysis.overview,
        obsNodes: kb.obsNodes.length,
        obsAssigned: new Set(
          kb.problems.flatMap((problem) =>
            problem.insights.flatMap((insight) => (insight.kind === 'observation' ? insight.obsNodes || [] : [])),
          ),
        ).size,
        keyObservations: kb.problems.reduce((sum, problem) => sum + (problem.keyObservations || []).length, 0),
        obsUnassigned: kb.problems.reduce(
          (sum, problem) =>
            sum + problem.insights.filter((insight) => insight.kind === 'observation' && !(insight.obsNodes || []).length).length,
          0,
        ),
      },
      top: analysis.top.slice(0, 20).map(slimRow),
      ideaTop: (analysis.ideaTop || []).slice(0, 16).map(slimRow),
      gaps: analysis.gaps,
      unclassified: analysis.unclassified,
      tagMap: kb.meta.tagMap,
      lastSyncAt: kb.meta.lastSyncAt,
    }
  }

  problemDetail(input) {
    const kb = this.kb()
    const problem = this.resolveProblem(kb, input.id || input.problem)
    const nodePaths = problem.nodes.map((id) => {
      const node = kb.nodes.find((item) => item.id === id)
      return node ? pathOf(kb, node) : id
    })
    const insightNodes = problem.insights.map((insight) => ({
      ...insight,
      nodePaths: (insight.nodes || []).map((id) => {
        const node = kb.nodes.find((item) => item.id === id)
        return node ? pathOf(kb, node) : id
      }),
    }))
    return { problem: { ...problem, insights: insightNodes, nodePaths }, nodes: nodePaths }
  }

  async uiCall(op, args = {}) {
    switch (op) {
      case 'seed':
        return this.seed()
      case 'tree':
        return this.tree(args)
      case 'showNode':
        return this.showNode(args)
      case 'addNode':
        return this.addNode(args)
      case 'updateNode':
        return this.updateNode(args)
      case 'moveNode':
        return this.moveNode(args)
      case 'removeNode':
        return this.removeNode(args)
      case 'searchNodes':
        return this.searchNodes(args)
      case 'mapTag':
        return this.mapTag(args)
      case 'linkProblem':
        return this.linkProblem(args)
      case 'unlinkProblem':
        return this.unlinkProblem(args)
      case 'addProblem':
        return this.addProblem(args)
      case 'updateProblem':
        return this.updateProblem(args)
      case 'markStuck':
        return this.markStuck(args)
      case 'addInsight':
        return this.addInsight(args)
      case 'removeInsight':
        return this.removeInsight(args)
      case 'classifyProblem':
        return this.classifyProblem(args)
      case 'showProblem':
        return this.showProblem(args)
      case 'listProblems':
        return this.listProblems(args)
      case 'removeProblem':
        return this.removeProblem(args)
      case 'addAccount':
        return this.addAccount(args)
      case 'listAccounts':
        return this.listAccounts()
      case 'removeAccount':
        return this.removeAccount(args)
      case 'syncAccount':
        return this.syncAccount(args)
      case 'report':
        return this.report(args)
      case 'gaps':
        return this.gaps()
      case 'recommend':
        return this.recommend(args)
      case 'weakProblem':
        return this.weakProblem(args)
      case 'status':
        return this.status()
      case 'obsTree':
        return this.obsTree(args)
      case 'obsUnassigned':
        return this.obsUnassigned(args)
      case 'similar':
        return this.similar(args)
      case 'recommendNovel':
        return this.recommendNovel(args)
      case 'calibrate':
        return this.calibrateThreshold()
      case 'problemDetail':
        return this.problemDetail(args)
      case 'trainCard':
        return this.trainCard(args)
      case 'sampleQuiz':
        return this.sampleQuiz(args)
      case 'repairQuiz':
        return this.repairQuizStatements()
      case 'trainMarkCard':
        return this.trainMarkCard(args)
      case 'trainAttempt':
        return this.trainAttempt(args)
      case 'trainJudge':
        return this.trainJudge(args)
      case 'trainReview':
        return this.trainReview(args)
      case 'trainReveal':
        return this.trainReveal(args)
      case 'trainGrade':
        return this.trainGrade(args)
      case 'sessionStart':
        return this.sessionStart(args)
      case 'sessionTouch':
        return this.sessionTouch(args)
      case 'sessionFinish':
        return this.sessionFinish(args)
      case 'trainStats':
        return this.trainStats()
      default:
        fail(`未知操作：${op}`)
    }
  }
}

function summarizeKinds(insights) {
  const counts = {}
  for (const insight of insights) counts[insight.kind] = (counts[insight.kind] || 0) + 1
  return KINDS.filter((kind) => counts[kind]).map((kind) => `${KIND_LABEL[kind]} ${counts[kind]}`).join('、')
}

function defaultProblemUrl(platform, key) {
  if (platform === 'codeforces') {
    const matched = key.match(/^(\d+)([A-Za-z]\d?)$/)
    if (matched) return `https://codeforces.com/problemset/problem/${matched[1]}/${matched[2]}`
    return `https://codeforces.com/problemset?search=${encodeURIComponent(key)}`
  }
  if (platform === 'atcoder') return `https://atcoder.jp/tasks/${key}`
  if (platform === 'luogu') return `https://www.luogu.com.cn/problem/${key}`
  return ''
}

export { KbError, fail }
