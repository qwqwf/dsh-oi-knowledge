import fs from 'node:fs'
import path from 'node:path'

const pluginDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const proposedPath = path.join(pluginDir, 'client.proposed.js')
let text = fs.readFileSync(proposedPath, 'utf8')

// 1) 重建 MATH_SYMBOLS 整块
const mathSymbols = `    const MATH_SYMBOLS = {
      le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
      simeq: '≃', sim: '∼', equiv: '≡', propto: '∝', ll: '≪', gg: '≫',
      times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆',
      circ: '∘', bullet: '∙', oplus: '⊕', ominus: '⊖', otimes: '⊗', odot: '⊙',
      cup: '∪', cap: '∩', setminus: '∖', subset: '⊂', subseteq: '⊆',
      supset: '⊃', supseteq: '⊇', in: '∈', notin: '∉', ni: '∋',
      emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄',
      neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨',
      to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
      leftrightarrow: '↔', Leftrightarrow: '⇔', iff: '⇔', implies: '⇒',
      mapsto: '↦', uparrow: '↑', downarrow: '↓', updownarrow: '↕',
      infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏',
      int: '∫', oint: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁',
      lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', langle: '⟨', rangle: '⟩',
      lbrace: '{', rbrace: '}', mid: '|', parallel: '∥', perp: '⊥', angle: '∠',
      triangle: '△', square: '□', checkmark: '✓', dots: '…', ldots: '…',
      cdots: '⋯', vdots: '⋮', ddots: '⋱', prime: '′', degree: '°', hbar: 'ℏ',
      ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', top: '⊤', bot: '⊥',
      models: '⊨', vdash: '⊢', therefore: '∴', because: '∵', colon: ':',
      nleq: '≰', ngeq: '≱', nless: '≮', ngtr: '≯', lnot: '¬',
    }`
text = text.replace(/const MATH_SYMBOLS = \{[\s\S]*?\n    \}/, mathSymbols)

// 2) 逐行修复剩余损坏行（按损坏行的可识别前缀匹配）
const fixes = [
  ["      ['derive',", "      ['derive', '推不出', '有观察，但推不到能写的式子'],"],
  [
    "    const LEVEL_GLYPH = {",
    "    const LEVEL_GLYPH = { expert: '◆', strong: '●', ok: '◐', weak: '▲', poor: '▽', unknown: '○', unmeasured: '·' }",
  ],
  ["    '◆?非常熟练", "    '◆ 非常熟练　● 熟练　◐ 还行　▲ 不熟练　▽ 非常不熟练　○ 空白　· 未测；点的数字是掌握度/覆盖数',"],
  [
    '没有权限访问插件接口',
    "throw new Error('没有权限访问插件接口（401/403）：请从 DSH 界面打开这个面板，而不是直接访问 URL。')",
  ],
  [
    "names.slice(0, 3).join(",
    "names.length ? h('span', { style: { color: C.muted, fontSize: 11 } }, `　例：${names.slice(0, 3).join('、')}`) : null,",
  ],
  [
    "`例证",
    "? h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 1.7 } }, `例证：${hit.patternText}`)",
  ],
  [
    "placeholder: treeKind === 'idea'",
    "placeholder: treeKind === 'idea' ? '搜索思路节点' : treeKind === 'obs' ? '搜索观察节点' : '搜索知识点',",
  ],
  [
    "? '这一层记的是「怎么想出来的」",
    "? '这一层记的是「怎么想出来的」：看到什么信号，走哪一步推导。往下挂的题和洞察越多，这条思路越熟。'",
  ],
  [
    ": '这一层记的是「考什么、怎么用」",
    ": '这一层记的是「考什么、怎么用」，不是某道题的具体做法。往下挂的题越多，说明这类题你越稳。',",
  ],
  [
    "{ label: '掌握",
    "            { label: '掌握度', hint: '手动覆盖自动评估；auto = 完全按题目和洞察算' },",
  ],
  [
    "child.tree === 'idea' ? `洞察",
    "            child.tree === 'idea' ? `洞察 ${child.insightCount || 0} · 题 ${child.linkedProblems || 0}` : `题 ${child.solvedCount || 0}`,",
  ],
  [
    "`${problem.title}",
    "                      `${problem.title}（${problem.key}${problem.rating ? ` · ${problem.rating}` : ''}）`,",
  ],
  [
    "direct ? '本节",
    "                      h(Pill, { color: direct ? C.muted : C.border }, direct ? '本节点' : '子节点'),",
  ],
  [
    "state.problems.length ? `没有匹配",
    "              ? h(Empty, null, state.problems.length ? `没有匹配「${query}」的题目。` : '还没有题目。可以直接在对话里跟 AI 说「把这道题录入」，也可以点「录题」手工填。')",
  ],
  [
    "['不熟",
    "            ['不熟练', overview.weak, '▲ 做过但明显不够'],",
  ],
  [
    "['非常不熟",
    "            ['非常不熟练', overview.poor, '▽ 只沾过边'],",
  ],
  [
    "['观察",
    "            ['观察树', `${overview.keyObservations || 0} 条`, `未归类 ${overview.obsUnassigned || 0} 条 / ${overview.obsNodes || 0} 节点`],",
  ],
  [
    "'相似度只算「精髓观察",
    "                '相似度只算「精髓观察（60%）+ 其他洞察（22%）+ 算法知识点（18%）」，不算题面文字。候选和库内题目最像的一道都低于阈值，就说明你没见过这类想法。候选需要先经题解消化（sample 入库）才能比较；不填则取最近消化的 10 道。',",
  ],
  [
    "'Codeforces 走官",
    "          'Codeforces 走官方 user.status 接口（只看 AC）；AtCoder 走 kenkoooo 的公开数据；洛谷没有公开 API，用题目列表尽力解析，失败时会如实报错。',",
  ],
]

const lines = text.split('\n')
let fixed = 0
const remaining = []
for (let i = 0; i < lines.length; i += 1) {
  if (!lines[i].includes('\uFFFD')) continue
  const hit = fixes.find(([needle]) => lines[i].includes(needle))
  if (hit) {
    lines[i] = hit[1]
    fixed += 1
  } else {
    remaining.push({ line: i + 1, text: lines[i].trim().slice(0, 140) })
  }
}

fs.writeFileSync(path.join(pluginDir, 'client.fixed.js'), lines.join('\n'), 'utf8')
console.log(JSON.stringify({ fixed, remaining: remaining.length }, null, 2))
for (const item of remaining) console.log(item.line + ': ' + item.text)
