/**
 * dsh-oi-knowledge —— Web 面板
 *
 * 一个单文件 React 面板：知识树 / 题目 / 弱点 / 账号 四个 tab。
 * 数据全部走 Host 注册的 /plugins/dsh-oi-knowledge/api/* 路由，
 * 因此这里只依赖 react 与浏览器自身的 fetch。
 */
window.__ModuleLoader__.load({
  id: 'dsh-oi-knowledge',
  factory(require) {
    const ReactRaw = require('react')
    const React = ReactRaw && ReactRaw.default ? ReactRaw.default : ReactRaw
    const h = React.createElement

    const PANEL_ID = 'oi-knowledge'
    const API_PATH = 'plugins/dsh-oi-knowledge/api/'

    const KINDS = [
      ['observation', '观察', '从题面 / 样例 / 约束直接看出来的性质'],
      ['trick', '套路', '固定的变形、构造、结论，记住就能用'],
      ['idea', '思路', '可迁移的推导链：从条件到做法'],
      ['direction', '思考方向', '看到这类题，第一步先往哪想'],
      ['pitfall', '坑点', '容易写错、想漏、复杂度翻车的地方'],
    ]
    const KIND_LABEL = {}
    for (const entry of KINDS) KIND_LABEL[entry[0]] = entry[1]

    const MASTERY = [
      ['auto', '自动评估'],
      ['expert', '非常熟练'],
      ['strong', '熟练'],
      ['ok', '还行'],
      ['weak', '不熟练'],
      ['poor', '非常不熟练'],
      ['unknown', '空白'],
    ]
    const NODE_KINDS = [
      ['domain', '领域'],
      ['topic', '专题'],
      ['concept', '概念 / 技巧'],
    ]
    const VERDICTS = [
      ['unknown', '未标记'],
      ['solved', '已通过'],
      ['attempted', '尝试过'],
      ['unsolved', '没过'],
    ]
    const STUCK_STAGES = [
      ['observe', '没找到观察', '读完了但抓不到关键那一步'],
      ['derive', '推不动', '有观察，但推不到能写的形式'],
      ['implement', '写不出来', '知道怎么做，码不出来或写不完'],
      ['debug', '调不出', '写完了过不了样例/WA'],
    ]
    const STUCK_LABEL = Object.fromEntries(STUCK_STAGES.map(([value, label]) => [value, label]))
    const PLATFORMS = [
      ['codeforces', 'Codeforces'],
      ['atcoder', 'AtCoder'],
      ['luogu', '洛谷'],
    ]

    const C = {
      base: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      brand: 'var(--dsw-alias-brand-primary)',
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      error: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
    }

    const LEVEL_COLOR = {
      expert: C.success,
      strong: C.success,
      ok: C.brand,
      weak: C.warn,
      poor: C.warn,
      unknown: C.border2,
      unmeasured: C.border2,
    }
    const LEVEL_LABEL = {
      expert: '非常熟练',
      strong: '熟练',
      ok: '还行',
      weak: '不熟练',
      poor: '非常不熟练',
      unknown: '空白',
      unmeasured: '未测',
    }
    const LEVEL_GLYPH = { expert: '◆', strong: '●', ok: '◐', weak: '▲', poor: '▽', unknown: '○', unmeasured: '·' }

    const sx = (...parts) => Object.assign({}, ...parts.filter(Boolean))

    // ── Host 路由解析：相对页面 base 解析，兼容反代前缀 ──────────────────
    function directoryBase() {
      const raw =
        typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI !== ''
          ? document.baseURI
          : 'http://dsh.internal/'
      const url = new URL(raw, 'http://dsh.internal/')
      url.search = ''
      url.hash = ''
      if (!url.pathname.endsWith('/')) url.pathname += '/'
      return url.href
    }

    function apiUrl(path) {
      return new URL(API_PATH + String(path).replace(/^\/+/, ''), directoryBase())
    }

    // 面板级记忆：薄弱题推荐过的题号。存在 localStorage 里，
    // 「换一道」「关掉浮层再点」甚至刷新页面之后都不会又从第一道开始。
    const WEAK_SEEN_STORAGE = 'oi-knowledge:weak-seen'
    function weakSeenList() {
      try {
        if (typeof localStorage === 'undefined') return []
        const raw = localStorage.getItem(WEAK_SEEN_STORAGE)
        const list = raw ? JSON.parse(raw) : []
        return Array.isArray(list) ? list.map(String).slice(0, 300) : []
      } catch (_) {
        return []
      }
    }
    function rememberWeakSeen(key) {
      const list = weakSeenList().filter((entry) => entry !== String(key))
      const next = key == null ? list : [String(key)].concat(list).slice(0, 300)
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(WEAK_SEEN_STORAGE, JSON.stringify(next))
      } catch (_) {}
      return next
    }
    function forgetWeakSeen() {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(WEAK_SEEN_STORAGE)
      } catch (_) {}
      return []
    }

    // ── 轻量 LaTeX：$…$ / $$…$$ / \(…\) / \[…\] → React 节点 ─────────────
    // 客户端没有 KaTeX（Builtin 只有 ctx/React/host/styles/console），
    // 这里做一个够用的行内渲染：符号表 + 上下标 + 分式 + 根号 + 重音。
    const MATH_SYMBOLS = {
      alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
      zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
      lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
      rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
      phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
      Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
      Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
      le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
      simeq: '≃', sim: '∼', equiv: '≡', propto: '∝', ll: '≪', gg: '≫',
      times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆',
      circ: '∘', bullet: '•', oplus: '⊕', ominus: '⊖', otimes: '⊗', odot: '⊙',
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
      nleq: '≰', ngeq: '≱', nless: '≮', ngtr: '≯', lnot: '¬', lor_: '∨',
      log: 'log', ln: 'ln', exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan',
      cot: 'cot', arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
      sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', gcd: 'gcd', lcm: 'lcm',
      min: 'min', max: 'max', arg: 'arg', lim: 'lim', limsup: 'lim sup',
      liminf: 'lim inf', det: 'det', deg: 'deg', dim: 'dim', ker: 'ker',
      mod: ' mod ', bmod: ' mod ',
    }

    const BLACKBOARD_LETTERS = {
      R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼', F: '𝔽', H: 'ℍ',
    }

    function readMathGroup(source, start) {
      let i = start
      while (i < source.length && source[i] === ' ') i += 1
      if (i >= source.length) return { raw: '', next: i }
      if (source[i] !== '{') {
        if (source[i] === '\\') {
          let j = i + 1
          while (j < source.length && /[A-Za-z]/.test(source[j])) j += 1
          return { raw: source.slice(i, Math.max(j, i + 2)), next: Math.max(j, i + 2) }
        }
        return { raw: source[i], next: i + 1 }
      }
      let depth = 0
      let j = i
      for (; j < source.length; j += 1) {
        const ch = source[j]
        if (ch === '\\') { j += 1; continue }
        if (ch === '{') depth += 1
        else if (ch === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      return { raw: source.slice(i + 1, j), next: Math.min(j + 1, source.length) }
    }

    function mathTokens(source) {
      const nodes = []
      let buffer = ''
      const flush = () => {
        if (buffer) { nodes.push(buffer); buffer = '' }
      }
      let i = 0
      while (i < source.length) {
        const ch = source[i]
        if (ch === '\\') {
          let j = i + 1
          if (!/[A-Za-z]/.test(source[j] || '')) {
            const escaped = source[j] || ''
            if (escaped === ',' || escaped === ';' || escaped === ':' || escaped === '!' || escaped === ' ') {
              buffer += ' '
              i += 2
              continue
            }
            if (escaped === '\\') { buffer += ' '; i += 2; continue }
            if (escaped === '(' || escaped === ')' || escaped === '[' || escaped === ']') { i += 2; continue }
            buffer += escaped
            i += 2
            continue
          }
          while (j < source.length && /[A-Za-z]/.test(source[j])) j += 1
          const name = source.slice(i + 1, j)
          i = j
          if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
            const top = readMathGroup(source, i)
            const bottom = readMathGroup(source, top.next)
            i = bottom.next
            flush()
            nodes.push(
              h(
                'span',
                {
                  key: `frac${i}`,
                  style: {
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    verticalAlign: 'middle',
                    lineHeight: 1.08,
                    margin: '0 2px',
                    fontSize: '0.94em',
                    position: 'relative',
                    top: '-1px',
                  },
                },
                h('span', { style: { borderBottom: `1px solid ${C.text}`, padding: '0 3px' } }, ...mathTokens(top.raw)),
                h('span', { style: { padding: '0 3px' } }, ...mathTokens(bottom.raw)),
              ),
            )
            continue
          }
          if (name === 'sqrt') {
            const inner = readMathGroup(source, i)
            i = inner.next
            flush()
            nodes.push(
              h(
                'span',
                { key: `sqrt${i}` },
                '√',
                h('span', { style: { borderTop: `1px solid ${C.text}`, paddingLeft: 2, marginLeft: 1 } }, ...mathTokens(inner.raw)),
              ),
            )
            continue
          }
          if (name === 'text' || name === 'textbf' || name === 'textit' || name === 'textrm' ||
              name === 'mathrm' || name === 'mathbf' || name === 'mathit' || name === 'mathsf' ||
              name === 'mathtt' || name === 'operatorname' || name === 'mathcal' || name === 'mathbb' ||
              name === 'boldsymbol') {
            const inner = readMathGroup(source, i)
            i = inner.next
            let content = inner.raw.replace(/\\[A-Za-z]+/g, (match) => MATH_SYMBOLS[match.slice(1)] || '')
            if (name === 'mathbb') content = content.replace(/[A-Za-z]/g, (letter) => BLACKBOARD_LETTERS[letter] || letter)
            buffer += content
            continue
          }
          if (name === 'overline' || name === 'bar' || name === 'underline' || name === 'hat' ||
              name === 'widehat' || name === 'tilde' || name === 'widetilde' || name === 'vec' ||
              name === 'dot' || name === 'ddot') {
            const inner = readMathGroup(source, i)
            i = inner.next
            flush()
            const content = mathTokens(inner.raw)
            if (name === 'overline' || name === 'bar') {
              nodes.push(h('span', { key: `bar${i}`, style: { borderTop: `1px solid ${C.text}`, paddingTop: 1 } }, ...content))
            } else if (name === 'underline') {
              nodes.push(h('span', { key: `ul${i}`, style: { borderBottom: `1px solid ${C.text}`, paddingBottom: 1 } }, ...content))
            } else {
              const mark = name === 'hat' || name === 'widehat' ? '\u0302' : name === 'tilde' || name === 'widetilde' ? '\u0303' : name === 'vec' ? '\u20d7' : name === 'ddot' ? '\u0308' : '\u0307'
              const decorated = content.slice()
              if (decorated.length && typeof decorated[decorated.length - 1] === 'string') {
                decorated[decorated.length - 1] = decorated[decorated.length - 1] + mark
              } else {
                decorated.push(mark)
              }
              nodes.push(h('span', { key: `acc${i}` }, ...decorated))
            }
            continue
          }
          if (name === 'pmod') {
            const inner = readMathGroup(source, i)
            i = inner.next
            flush()
            nodes.push(' (mod ', ...mathTokens(inner.raw), ')')
            continue
          }
          if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' ||
              name === 'bigg' || name === 'Bigg' || name === 'bigl' || name === 'bigr' ||
              name === 'Bigl' || name === 'Bigr' || name === 'biggl' || name === 'biggr' ||
              name === 'Biggl' || name === 'Biggr' || name === 'middle' ||
              name === 'displaystyle' || name === 'textstyle' || name === 'scriptstyle' ||
              name === 'limits' || name === 'nolimits') {
            continue
          }
          if (name === 'quad') { buffer += ' '; continue }
          if (name === 'qquad') { buffer += '  '; continue }
          if (Object.prototype.hasOwnProperty.call(MATH_SYMBOLS, name)) {
            buffer += MATH_SYMBOLS[name]
            continue
          }
          // 未知命令：去掉反斜杠按名字显示，至少不会露出源码
          buffer += name
          continue
        }
        if (ch === '^' || ch === '_') {
          const group = readMathGroup(source, i + 1)
          i = group.next
          flush()
          nodes.push(
            h(
              ch === '^' ? 'sup' : 'sub',
              { key: `${ch}${i}`, style: { fontSize: '0.72em', lineHeight: 1 } },
              ...mathTokens(group.raw),
            ),
          )
          continue
        }
        if (ch === '{') {
          const group = readMathGroup(source, i)
          i = group.next
          flush()
          nodes.push(...mathTokens(group.raw))
          continue
        }
        if (ch === '}') { i += 1; continue }
        if (ch === '&' || ch === '~') { buffer += ch === '~' ? ' ' : ''; i += 1; continue }
        buffer += ch
        i += 1
      }
      flush()
      return nodes
    }

    function findMathEnd(source, start, closer) {
      let i = start
      while (i < source.length) {
        if (source.startsWith(closer, i)) return i
        if (source[i] === '\\') { i += 2; continue }
        i += 1
      }
      return -1
    }

    const BS = String.fromCharCode(92)

    function splitMathSegments(text) {
      const source = String(text == null ? '' : text)
      const segments = []
      if (!source) return segments
      if (source.indexOf('$') < 0 && source.indexOf(BS + '(') < 0 && source.indexOf(BS + '[') < 0) {
        segments.push({ type: 'text', value: source })
        return segments
      }
      let i = 0
      let textStart = 0
      const pushText = (end) => {
        if (end > textStart) segments.push({ type: 'text', value: source.slice(textStart, end) })
      }
      while (i < source.length) {
        if (source.startsWith('$$', i)) {
          const end = source.indexOf('$$', i + 2)
          if (end < 0) { i += 2; continue }
          pushText(i)
          segments.push({ type: 'math', value: source.slice(i + 2, end), display: true })
          i = end + 2
          textStart = i
          continue
        }
        if (source[i] === '$') {
          const end = findMathEnd(source, i + 1, '$')
          if (end < 0) { i += 1; continue }
          pushText(i)
          segments.push({ type: 'math', value: source.slice(i + 1, end), display: false })
          i = end + 1
          textStart = i
          continue
        }
        if (source.startsWith(BS + '(', i)) {
          const end = findMathEnd(source, i + 2, BS + ')')
          if (end < 0) { i += 2; continue }
          pushText(i)
          segments.push({ type: 'math', value: source.slice(i + 2, end), display: false })
          i = end + 2
          textStart = i
          continue
        }
        if (source.startsWith(BS + '[', i)) {
          const end = findMathEnd(source, i + 2, BS + ']')
          if (end < 0) { i += 2; continue }
          pushText(i)
          segments.push({ type: 'math', value: source.slice(i + 2, end), display: true })
          i = end + 2
          textStart = i
          continue
        }
        i += 1
      }
      pushText(source.length)
      return segments
    }

    // 纯 JS 兜底渲染（KaTeX 尚未加载或加载失败时使用）
    function richTextNodes(text) {
      return splitMathSegments(text).map((segment, index) => {
        if (segment.type === 'text') return segment.value
        return h(
          'span',
          { key: `m${index}`, style: segment.display ? { display: 'block', textAlign: 'center', margin: '4px 0' } : null },
          ...mathTokens(segment.value),
        )
      })
    }

    // ── KaTeX（同源静态资源，按需加载）─────────────────────────────────
    const katexRuntime = { status: 'idle', promise: null, listeners: new Set() }

    function katexAssetUrl(name) {
      return new URL(`plugins/dsh-oi-knowledge/assets/katex/${name}`, directoryBase())
    }

    function notifyKatexListeners() {
      for (const listener of Array.from(katexRuntime.listeners)) {
        try {
          listener()
        } catch (_) {
          /* 单个组件重渲染失败不影响其他实例 */
        }
      }
    }

    function ensureKatex() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null)
      if (window.katex && typeof window.katex.renderToString === 'function') {
        katexRuntime.status = 'ready'
        return Promise.resolve(window.katex)
      }
      if (katexRuntime.promise) return katexRuntime.promise
      katexRuntime.status = 'loading'
      katexRuntime.promise = new Promise((resolve) => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = katexAssetUrl('katex.min.css').href
        document.head.appendChild(link)
        const script = document.createElement('script')
        script.src = katexAssetUrl('katex.min.js').href
        script.async = true
        script.onload = () => {
          katexRuntime.status = window.katex && typeof window.katex.renderToString === 'function' ? 'ready' : 'failed'
          notifyKatexListeners()
          resolve(window.katex || null)
        }
        script.onerror = () => {
          katexRuntime.status = 'failed'
          notifyKatexListeners()
          resolve(null)
        }
        document.head.appendChild(script)
      })
      return katexRuntime.promise
    }

    // 渲染结果缓存：同一公式在列表里反复出现时只排一次版。
    const KATEX_HTML_CACHE = new Map()
    const KATEX_HTML_CACHE_LIMIT = 2000
    const SEGMENT_CACHE = new Map()
    const SEGMENT_CACHE_LIMIT = 500

    function cachedSplit(text) {
      const source = String(text == null ? '' : text)
      const hit = SEGMENT_CACHE.get(source)
      if (hit) return hit
      const segments = splitMathSegments(source)
      if (SEGMENT_CACHE.size >= SEGMENT_CACHE_LIMIT) SEGMENT_CACHE.clear()
      SEGMENT_CACHE.set(source, segments)
      return segments
    }

    function katexRenderHtml(latex, displayMode) {
      const katex =
        typeof window !== 'undefined' && window.katex && typeof window.katex.renderToString === 'function'
          ? window.katex
          : null
      if (!katex) return ''
      const key = `${displayMode ? 1 : 0}|${latex}`
      const cached = KATEX_HTML_CACHE.get(key)
      if (cached !== undefined) return cached
      let html = ''
      try {
        html = katex.renderToString(latex, {
          displayMode,
          throwOnError: false,
          strict: 'ignore',
          trust: false,
          // 只输出 HTML，不重复生成一份 MathML——DOM 减半，排版也更快。
          output: 'html',
        })
      } catch (_) {
        html = ''
      }
      if (KATEX_HTML_CACHE.size >= KATEX_HTML_CACHE_LIMIT) KATEX_HTML_CACHE.clear()
      KATEX_HTML_CACHE.set(key, html)
      return html
    }

    function renderRichText(text) {
      const source = String(text == null ? '' : text)
      // 极端长的题面/题解不让 KaTeX 逐条排版，避免整页卡死。
      const allowKatex = source.length <= 60000
      return cachedSplit(source).map((segment, index) => {
        if (segment.type === 'text') return segment.value
        if (allowKatex) {
          const html = katexRenderHtml(segment.value, segment.display === true)
          if (html) {
            return h('span', {
              key: `km${index}`,
              className: segment.display ? 'oi-katex oi-katex-display' : 'oi-katex',
              dangerouslySetInnerHTML: { __html: html },
              style: segment.display ? { display: 'block', margin: '4px 0' } : null,
            })
          }
        }
        return h('span', { key: `fm${index}` }, ...mathTokens(segment.value))
      })
    }

    const memoComponent = typeof React.memo === 'function' ? React.memo : (component) => component

    const MathText = memoComponent(function MathText(props) {
      const text = props && props.text != null ? props.text : ''
      const [katexVersion, setKatexVersion] = React.useState(0)
      React.useEffect(() => {
        if (katexRuntime.status === 'ready' || katexRuntime.status === 'failed') return undefined
        const listener = () => setKatexVersion((value) => value + 1)
        katexRuntime.listeners.add(listener)
        ensureKatex()
        return () => {
          katexRuntime.listeners.delete(listener)
        }
      }, [])
      const nodes = React.useMemo(() => renderRichText(text), [text, katexVersion])
      return h('span', { style: (props && props.style) || null }, nodes)
    }, (prev, next) => (prev.text != null ? prev.text : '') === (next.text != null ? next.text : ''))

    // ── 基础样式 ─────────────────────────────────────────────────────────
    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      background: C.base,
      color: C.text,
      border: `1px solid ${C.border}`,
      borderRadius: 6,
      padding: '5px 8px',
      font: 'inherit',
      fontSize: 12.5,
      outline: 'none',
    }
    const textareaStyle = sx(inputStyle, { minHeight: 64, resize: 'vertical', lineHeight: 1.5 })

    function Btn(props) {
      const tone = props.tone
      const background = props.disabled
        ? C.layer2
        : tone === 'primary'
          ? C.brand
          : tone === 'danger'
            ? 'transparent'
            : C.layer2
      const color = props.disabled
        ? C.muted
        : tone === 'primary'
          ? 'var(--dsw-alias-bg-base)'
          : tone === 'danger'
            ? C.error
            : C.text
      return h(
        'button',
        {
          type: 'button',
          onClick: props.disabled ? undefined : props.onClick,
          title: props.title,
          disabled: props.disabled,
          style: sx(
            {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              border: `1px solid ${tone === 'danger' ? C.border : 'transparent'}`,
              background,
              color,
              borderRadius: 6,
              padding: '4px 10px',
              font: 'inherit',
              fontSize: 12,
              cursor: props.disabled ? 'default' : 'pointer',
              opacity: props.disabled ? 0.7 : 1,
              whiteSpace: 'nowrap',
            },
            props.style,
          ),
        },
        props.children,
      )
    }

    function Field(props) {
      return h(
        'label',
        { style: sx({ display: 'flex', flexDirection: 'column', gap: 4 }, props.style) },
        h('span', { style: { fontSize: 11.5, color: C.muted } }, props.label),
        props.children,
        props.hint ? h('span', { style: { fontSize: 11, color: C.muted } }, props.hint) : null,
      )
    }

    function Select(props) {
      return h(
        'select',
        {
          value: props.value,
          onChange: props.onChange,
          style: sx(inputStyle, { cursor: 'pointer' }, props.style),
          disabled: props.disabled,
        },
        (props.options || []).map((entry) =>
          h('option', { key: entry[0], value: entry[0] }, entry[1]),
        ),
      )
    }

    function Pill(props) {
      const color = props.color || C.muted
      return h(
        'span',
        {
          style: sx(
            {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '1px 7px',
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              color,
              fontSize: 11,
              lineHeight: '16px',
              whiteSpace: 'nowrap',
            },
            props.style,
          ),
        },
        props.children,
      )
    }

    function Bar(props) {
      const ratio = Math.max(0, Math.min(1, Number(props.value) || 0))
      return h(
        'div',
        {
          style: sx(
            { height: 5, borderRadius: 3, background: C.layer2, overflow: 'hidden', width: '100%' },
            props.style,
          ),
        },
        h('div', {
          style: {
            height: '100%',
            width: `${Math.round(ratio * 100)}%`,
            background: props.color || C.brand,
            borderRadius: 3,
          },
        }),
      )
    }

    function SectionTitle(props) {
      return h(
        'div',
        {
          style: sx(
            {
              fontSize: 11.5,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: C.muted,
              margin: props.first ? '0 0 6px' : '14px 0 6px',
            },
            props.style,
          ),
        },
        props.children,
      )
    }

    function Card(props) {
      return h(
        'div',
        {
          style: sx(
            {
              background: C.layer1,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: props.padding || '10px 12px',
            },
            props.style,
          ),
        },
        props.children,
      )
    }

    function Empty(props) {
      return h(
        'div',
        { style: { padding: '18px 8px', color: C.muted, fontSize: 12.5, lineHeight: 1.7 } },
        props.children,
      )
    }

    function splitTags(text) {
      return String(text || '')
        .split(/[,，、\s]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    }

    // ── 浮层：薄弱题推荐 / 完整知识树 ────────────────────────────────────
    function Overlay(props) {
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
          },
          onClick: props.onClose,
        },
        h(
          'div',
          {
            onClick: (event) => event.stopPropagation(),
            style: {
              width: 'min(1000px, 100%)',
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
              background: C.layer1,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 18px 50px rgba(0, 0, 0, 0.35)',
            },
          },
          h(
            'div',
            {
              style: {
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderBottom: `1px solid ${C.border}`,
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 14, fontWeight: 600 } }, props.title),
              props.subtitle
                ? h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 2 } }, props.subtitle)
                : null,
            ),
            props.actions || null,
            h(Btn, { onClick: props.onClose }, '关闭'),
          ),
          h(
            'div',
            {
              style: {
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              },
            },
            props.children,
          ),
        ),
      )
    }

    function WeakPickOverlay(props) {
      const { call } = useStore()
      const [result, setResult] = React.useState(props.result)
      const [loading, setLoading] = React.useState(false)
      const [seen, setSeen] = React.useState(weakSeenList())
      const item = result ? result.item : null
      const weak = result ? result.weak : null
      const again = async () => {
        setLoading(true)
        try {
          let next = await call('weakProblem', { exclude: seen }, { silent: true })
          if (!next || !next.item) {
            // 一轮都换完了：清空记录，从第一道重新开始
            setSeen(forgetWeakSeen())
            next = await call('weakProblem', {}, { silent: true })
            if (next && next.item) setSeen(rememberWeakSeen(next.item.key))
          } else {
            setSeen(rememberWeakSeen(next.item.key))
          }
          if (next) setResult(next)
        } finally {
          setLoading(false)
        }
      }
      return h(
        Overlay,
        {
          title: '薄弱题推荐',
          subtitle: '随机抽一批题，挑出命中你最弱知识点的那道',
          onClose: props.onClose,
          actions: h(Btn, { onClick: again, disabled: loading, tone: 'primary' }, loading ? '正在挑…' : '换一道'),
        },
        weak
          ? h(
              Card,
              null,
              h(SectionTitle, { first: true }, '缺口'),
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, weak.path),
              h(
                'div',
                { style: { fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.7 } },
                `掌握度 ${LEVEL_LABEL[weak.level] || '—'} · 风险 ${Number(weak.risk || 0).toFixed(2)}${weak.reasons && weak.reasons.length ? ` · ${weak.reasons.join('；')}` : ''}`,
              ),
              h(Bar, { value: weak.score || 0, color: LEVEL_COLOR[weak.level] || C.warn, style: { marginTop: 8 } }),
            )
          : null,
        item
          ? h(
              Card,
              null,
              h(SectionTitle, { first: true }, '推荐做这道'),
              h(
                'a',
                {
                  href: item.url,
                  target: '_blank',
                  rel: 'noreferrer',
                  style: { fontSize: 14, fontWeight: 600, color: C.text, textDecoration: 'none' },
                },
                `${item.title}（${item.key}）`,
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 } },
                h(Pill, { color: C.brand }, `${item.rating} 分`),
                (item.hitTags || []).map((tag) =>
                  h(Pill, { key: tag, color: C.muted }, tag),
                ),
              ),
              item.nodes && item.nodes.length
                ? h(
                    'div',
                    { style: { fontSize: 11.5, color: C.muted, marginTop: 8, lineHeight: 1.7 } },
                    `对应知识点：${item.nodes.join('、')}`,
                  )
                : null,
              h(
                'div',
                { style: { fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.7 } },
                '判断依据：题目命中的 tag 落在你风险最高的知识点上；难度窗口按你已通过题的中位/75 分位自动推。',
              ),
              h(
                'div',
                { style: { marginTop: 10, display: 'flex', gap: 8 } },
                h(
                  Btn,
                  { tone: 'primary', onClick: () => window.open(item.url, '_blank', 'noopener') },
                  '打开题目',
                ),
              ),
            )
          : h(Empty, null, '这次没挑出题来——可能是题库缓存没拉下来，或者弱点 tag 在题库里没有对应题。稍后再点一次「换一道」。'),
      )
    }

    function FullTreeOverlay(props) {
      const { state } = useStore()
      const [kind, setKind] = React.useState('algo')
      const rows =
        kind === 'obs'
          ? state.obsNodes || []
          : (state.nodes || []).filter((node) => (node.tree === 'idea') === (kind === 'idea'))
      const ids = new Set(rows.map((row) => row.id))
      const children = new Map()
      for (const row of rows) {
        const parent = row.parent && ids.has(row.parent) ? row.parent : null
        if (!children.has(parent)) children.set(parent, [])
        children.get(parent).push(row)
      }
      const flat = []
      const walk = (parent, depth) => {
        for (const row of children.get(parent) || []) {
          flat.push({ row, depth })
          walk(row.id, depth + 1)
        }
      }
      walk(null, 0)
      const metric = (row) => {
        if (kind === 'obs') return `观察 ${row.count || 0} 条`
        if (kind === 'idea') return `洞察 ${row.insightCount || 0} · 关联题 ${row.linkedProblems || 0}`
        return `${LEVEL_LABEL[row.level] || '—'} · 题 ${row.solvedCount || 0}`
      }
      const counts =
        kind === 'obs'
          ? `${flat.length} 个节点`
          : kind === 'idea'
            ? `${flat.length} 个节点 · ${state.overview.ideaInsights || 0} 条洞察`
            : `${flat.length} 个节点 · 覆盖 ${state.overview.coveredPct}%`
      const switchButton = (value, label) =>
        h(
          'button',
          {
            key: value,
            type: 'button',
            onClick: () => setKind(value),
            style: {
              border: 'none',
              borderBottom: `2px solid ${kind === value ? C.brand : 'transparent'}`,
              background: 'transparent',
              color: kind === value ? C.text : C.muted,
              padding: '5px 9px 4px',
              font: 'inherit',
              fontSize: 12,
              cursor: 'pointer',
            },
          },
          label,
        )
      return h(
        Overlay,
        {
          title: '完整知识树',
          subtitle: counts,
          onClose: props.onClose,
          actions: h('div', { style: { display: 'flex', gap: 2 } }, switchButton('algo', '知识'), switchButton('idea', '思路'), switchButton('obs', '观察')),
        },
        h(
          'div',
          { style: { fontSize: 11.5, color: C.muted } },
          '◆ 非常熟练　● 熟练　◐ 还行　▲ 不熟练　▽ 非常不熟练　○ 空白　· 未测；点的数字是掌握度/覆盖。',
        ),
        h(
          'div',
          null,
          flat.map((entry) =>
            h(
              'div',
              {
                key: entry.row.id,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 4px',
                  marginLeft: entry.depth * 14,
                  borderBottom: `1px solid ${C.border}`,
                },
              },
              h(
                'span',
                {
                  title: LEVEL_LABEL[entry.row.level] || '',
                  style: { flex: 'none', fontSize: 10, color: LEVEL_COLOR[entry.row.level] || C.muted },
                },
                LEVEL_GLYPH[entry.row.level] || '○',
              ),
              h(
                'span',
                {
                  style: {
                    flex: 1,
                    minWidth: 0,
                    fontSize: entry.depth === 0 ? 13 : 12,
                    fontWeight: entry.depth === 0 ? 600 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                entry.row.name,
              ),
              h(
                'span',
                { style: { flex: 'none', fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' } },
                metric(entry.row),
              ),
            ),
          ),
        ),
        h(
          'div',
          { style: { fontSize: 11, color: C.muted, textAlign: 'center', padding: '4px 0 10px' } },
          '想只看某一块，点上面的「关闭」回到知识树再用左边目录。',
        ),
      )
    }

    // ── 数据上下文 ───────────────────────────────────────────────────────
    const StoreContext = React.createContext(null)

    function useStore() {
      const value = React.useContext(StoreContext)
      if (!value) throw new Error('oi-knowledge: 面板上下文缺失')
      return value
    }

    function useApp() {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [tab, setTab] = React.useState('tree')

      const reload = React.useCallback(async () => {
        try {
          const response = await fetch(apiUrl('state'), { credentials: 'same-origin', cache: 'no-store' })
          if (response.status === 401 || response.status === 403) {
            throw new Error('没有权限访问插件接口（401/403）：请从 DSH 界面打开这个面板，而不是直接访问 URL。')
          }
          if (!response.ok) throw new Error(`读取知识库失败：HTTP ${response.status}`)
          const data = await response.json()
          setState(data)
          setError('')
          return data
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
          return null
        }
      }, [])

      React.useEffect(() => {
        reload()
      }, [reload])

      const call = React.useCallback(
        async (op, args, options) => {
          const silent = Boolean(options && options.silent)
          setBusy(true)
          try {
            const response = await fetch(apiUrl('call'), {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ op, args: args || {} }),
            })
            let payload = null
            try {
              payload = await response.json()
            } catch (_) {
              payload = null
            }
            if (!response.ok || !payload || payload.ok !== true) {
              const message = payload && payload.error ? payload.error : `HTTP ${response.status}`
              throw new Error(message)
            }
            const result = payload.result || {}
            if (result.summary && !silent) setNotice(result.summary)
            setError('')
            await reload()
            return result
          } catch (cause) {
            setError(cause && cause.message ? cause.message : String(cause))
            return null
          } finally {
            setBusy(false)
          }
        },
        [reload],
      )

      React.useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(''), 8000)
        return () => clearTimeout(timer)
      }, [notice])

      return { state, error, notice, busy, tab, setTab, reload, call, setNotice, setError }
    }

    // ── 面板外壳 ─────────────────────────────────────────────────────────
    const TABS = [
      ['tree', '知识树'],
      ['problems', '题目'],
      ['weak', '弱点'],
      ['accounts', '账号'],
    ]

    function Panel() {
      const app = useApp()
      const state = app.state
      const overview = state ? state.overview : null
      const [weakPick, setWeakPick] = React.useState(null)
      const [fullTree, setFullTree] = React.useState(false)

      const body = !state
        ? h(
            Empty,
            null,
            app.error
              ? app.error
              : '正在读取知识库……如果一直停在这里，说明 Host 接口没有连上（先看 DSH 里这个插件有没有加载成功）。',
          )
        : app.tab === 'tree'
          ? h(TreeTab)
          : app.tab === 'problems'
            ? h(ProblemsTab)
            : app.tab === 'weak'
              ? h(WeakTab)
              : h(AccountsTab)

      return h(
        StoreContext.Provider,
        { value: app },
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
              background: C.base,
              color: C.text,
              fontSize: 13,
            },
          },
          h('div', { 'data-window-drag': true, 'aria-hidden': true, style: { height: 10, flex: 'none' } }),
          h(
            'header',
            {
              style: {
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: '4px 10px',
                padding: '0 14px 8px',
                flex: 'none',
              },
            },
            h('div', { style: { fontSize: 15, fontWeight: 600 } }, 'OI 知识点树'),
            state
              ? h(
                  'div',
                  { style: { fontSize: 11.5, color: C.muted } },
                  `节点 ${overview.nodes} · 覆盖 ${overview.coveredPct}% · 题目 ${state.problems.length} · 洞察 ${overview.insights}`,
                )
              : null,
            h('div', { style: { flex: 1 } }),
            h(
              Btn,
              {
                onClick: async () => {
                  let result = await app.call('weakProblem', { exclude: weakSeenList() }, { silent: true })
                  if (result && !result.item) {
                    forgetWeakSeen()
                    result = await app.call('weakProblem', {}, { silent: true })
                  }
                  if (result && result.item) {
                    rememberWeakSeen(result.item.key)
                    setWeakPick(result)
                  }
                },
                disabled: app.busy || !state,
                title: '随机抽一批题，挑一道命中你最弱知识点的练习',
                tone: 'primary',
              },
              '🎯 薄弱题',
            ),
            h(
              Btn,
              { onClick: () => setFullTree(true), disabled: !state, title: '看成整棵树的掌握度' },
              '🌳 完整知识树',
            ),
            h(
              Btn,
              { onClick: app.reload, disabled: app.busy, title: '重新读取' },
              app.busy ? '处理中…' : '刷新',
            ),
          ),
          h(
            'nav',
            {
              style: {
                display: 'flex',
                gap: 4,
                padding: '0 12px',
                borderBottom: `1px solid ${C.border}`,
                flex: 'none',
              },
            },
            TABS.map((entry) =>
              h(
                'button',
                {
                  key: entry[0],
                  type: 'button',
                  onClick: () => app.setTab(entry[0]),
                  style: {
                    border: 'none',
                    borderBottom: `2px solid ${app.tab === entry[0] ? C.brand : 'transparent'}`,
                    background: 'transparent',
                    color: app.tab === entry[0] ? C.text : C.muted,
                    padding: '7px 10px 6px',
                    font: 'inherit',
                    fontSize: 12.5,
                    cursor: 'pointer',
                  },
                },
                entry[1],
              ),
            ),
          ),
          app.error
            ? h(
                'div',
                {
                  style: {
                    flex: 'none',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    padding: '6px 14px',
                    background: 'transparent',
                    color: C.error,
                    fontSize: 12,
                    borderBottom: `1px solid ${C.border}`,
                  },
                },
                h('span', { style: { flex: 1, whiteSpace: 'pre-wrap' } }, app.error),
                h(Btn, { onClick: () => app.setError('') }, '知道了'),
              )
            : null,
          app.notice
            ? h(
                'div',
                {
                  style: {
                    flex: 'none',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    padding: '6px 14px',
                    color: C.success,
                    fontSize: 12,
                    borderBottom: `1px solid ${C.border}`,
                  },
                },
                h('span', { style: { flex: 1, whiteSpace: 'pre-wrap' } }, app.notice),
                h(Btn, { onClick: () => app.setNotice('') }, '收起'),
              )
            : null,
          h('main', { style: { flex: 1, minHeight: 0, overflow: 'auto', padding: 12 } }, body),
          weakPick ? h(WeakPickOverlay, { result: weakPick, onClose: () => setWeakPick(null) }) : null,
          fullTree ? h(FullTreeOverlay, { onClose: () => setFullTree(false) }) : null,
        ),
      )
    }

    // ── 观察节点详情 ─────────────────────────────────────────────────────
    function ObsDetail(props) {
      const node = props.node
      const { state } = useStore()
      const descendants = new Set([node.id])
      let grew = true
      while (grew) {
        grew = false
        for (const item of state.obsNodes || []) {
          if (item.parent && descendants.has(item.parent) && !descendants.has(item.id)) {
            descendants.add(item.id)
            grew = true
          }
        }
      }
      const hits = []
      for (const problem of state.problems) {
        for (const insight of problem.insights || []) {
          if (insight.kind !== 'observation') continue
          if (!(insight.obsNodes || []).some((id) => descendants.has(id))) continue
          hits.push({ problem, insight, key: (problem.keyObservations || []).includes(insight.id) })
        }
      }
      return h(
        'div',
        { style: { flex: '2 1 340px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 10 } },
        h(
          Card,
          null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 120 } }, node.path),
            h(Pill, { color: node.count ? C.brand : C.muted }, `观察 ${node.count} 条`),
          ),
          node.summary
            ? h('div', { style: { fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.7 } }, node.summary)
            : null,
          h(
            'div',
            { style: { fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.7 } },
            '这一层记的是「看出了什么」，不是「用了什么算法」。往下挂的观察越多，说明这类关键跳跃你越熟。',
          ),
        ),
        (node.patterns || []).length
          ? h(
              Card,
              null,
              h(SectionTitle, { first: true }, `常见观察句式（${node.patterns.length}）`),
              node.patterns.map((pattern, index) =>
                h(
                  'div',
                  { key: index, style: { fontSize: 12, color: C.muted, lineHeight: 1.75, padding: '4px 0' } },
                  `· ${pattern}`,
                ),
              ),
            )
          : null,
        h(
          Card,
          null,
          h(SectionTitle, { first: true }, `挂在这个观察上的题（${hits.length}）`),
          hits.length
            ? hits.slice(0, 40).map((hit) =>
                h(
                  'div',
                  { key: `${hit.problem.id}:${hit.insight.id}`, style: { padding: '6px 0', borderBottom: `1px solid ${C.border}` } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, alignItems: 'baseline' } },
                    h(
                      'a',
                      {
                        href: hit.problem.url,
                        target: '_blank',
                        rel: 'noreferrer',
                        style: { fontSize: 12.5, color: C.text, textDecoration: 'none', flex: 1 },
                      },
                      `${hit.problem.title}（${hit.problem.key}${hit.problem.rating ? `，${hit.problem.rating}` : ''}）`,
                    ),
                    hit.key ? h(Pill, { color: C.brand }, '精髓') : null,
                  ),
                  h(
                    'div',
                    { style: { fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 1.7, whiteSpace: 'pre-wrap' } },
                    h(MathText, { text: hit.insight.text }),
                  ),
                ),
              )
            : h(Empty, null, '还没有观察落在这个节点上。录入题解时把观察挂到「观察/…」路径即可。'),
        ),
      )
    }

    // ── 知识树 ───────────────────────────────────────────────────────────
    function TreeTab() {
      const { state, call, busy } = useStore()
      const allNodes = state ? state.nodes : []
      const obsNodes = state && state.obsNodes ? state.obsNodes : []
      const [treeKind, setTreeKind] = React.useState('algo')
      const nodes = React.useMemo(
        () =>
          treeKind === 'obs'
            ? obsNodes
            : allNodes.filter((node) => (treeKind === 'idea' ? node.tree === 'idea' : node.tree !== 'idea')),
        [allNodes, obsNodes, treeKind],
      )
      const [query, setQuery] = React.useState('')
      const [selectedId, setSelectedId] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState({})

      React.useEffect(() => {
        setSelectedId(null)
      }, [treeKind])

      const children = React.useMemo(() => {
        const map = new Map()
        for (const node of nodes) {
          const parent = node.parent === null ? '__root__' : node.parent
          if (!map.has(parent)) map.set(parent, [])
          map.get(parent).push(node)
        }
        for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
        return map
      }, [nodes])

      const selected = React.useMemo(
        () => (selectedId ? nodes.find((node) => node.id === selectedId) || null : null),
        [nodes, selectedId],
      )

      const matches = React.useMemo(() => {
        const word = query.trim().toLowerCase()
        if (!word) return null
        return nodes.filter((node) => {
          const haystack = `${node.path} ${node.summary} ${(node.signals || []).join(' ')}`.toLowerCase()
          return haystack.includes(word)
        })
      }, [nodes, query])

      const toggle = (id) => setCollapsed((previous) => sx(previous, { [id]: !previous[id] }))

      const renderRow = (node, depth) => {
        const kids = children.get(node.id) || []
        const isCollapsed = Boolean(collapsed[node.id])
        const isSelected = node.id === selectedId
        const row = h(
          'div',
          {
            key: node.id,
            onClick: () => setSelectedId(node.id),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: `3px 6px 3px ${6 + depth * 13}px`,
              borderRadius: 6,
              cursor: 'pointer',
              background: isSelected ? C.layer2 : 'transparent',
            },
          },
          h(
            'span',
            {
              onClick: (event) => {
                if (!kids.length) return
                event.stopPropagation()
                toggle(node.id)
              },
              style: {
                width: 12,
                flex: 'none',
                color: C.muted,
                fontSize: 10,
                cursor: kids.length ? 'pointer' : 'default',
                userSelect: 'none',
              },
            },
            kids.length ? (isCollapsed ? '▸' : '▾') : '',
          ),
          h(
            'span',
            {
              title: LEVEL_LABEL[node.level] || '',
              style: { flex: 'none', fontSize: 10, color: LEVEL_COLOR[node.level] || C.muted },
            },
            LEVEL_GLYPH[node.level] || '○',
          ),
          h(
            'span',
            {
              style: {
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12.5,
                fontWeight: depth === 0 ? 600 : 400,
                color: node.level === 'unknown' ? C.muted : C.text,
              },
            },
            node.name,
          ),
          node.insightCount
            ? h(Pill, { style: { padding: '0 5px', fontSize: 10 }, color: C.brand }, `✨${node.insightCount}`)
            : null,
          node.tree === 'idea'
            ? node.linkedProblems
              ? h(Pill, { style: { padding: '0 5px', fontSize: 10 } }, `题${node.linkedProblems}`)
              : null
            : node.tree === 'obs'
              ? node.count
                ? h(Pill, { style: { padding: '0 5px', fontSize: 10 }, color: C.brand }, node.count)
                : null
              : node.solvedCount
                ? h(Pill, { style: { padding: '0 5px', fontSize: 10 } }, node.solvedCount)
                : null,
        )
        if (!kids.length || isCollapsed) return [row]
        const nested = []
        for (const kid of kids) {
          const rendered = renderRow(kid, depth + 1)
          for (const item of rendered) nested.push(item)
        }
        return [row].concat(nested)
      }

      const rows = []
      for (const root of children.get('__root__') || []) {
        const rendered = renderRow(root, 0)
        for (const item of rendered) rows.push(item)
      }

      const left = h(
        'div',
        {
          style: {
            flex: '1 1 250px',
            minWidth: 210,
            maxWidth: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 0,
          },
        },
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h(
            'div',
            {
              style: {
                display: 'flex',
                flex: 'none',
                border: `1px solid ${C.border}`,
                borderRadius: 7,
                overflow: 'hidden',
              },
            },
            [
              ['algo', '知识'],
              ['idea', '思路'],
              ['obs', '观察'],
            ].map(([value, label]) =>
              h(
                'button',
                {
                  key: value,
                  onClick: () => setTreeKind(value),
                  style: {
                    padding: '5px 10px',
                    fontSize: 11.5,
                    border: 'none',
                    cursor: 'pointer',
                    background: treeKind === value ? C.layer2 : 'transparent',
                    color: treeKind === value ? C.text : C.muted,
                    fontWeight: treeKind === value ? 600 : 400,
                  },
                },
                label,
              ),
            ),
          ),
          h('input', {
            value: query,
            placeholder: treeKind === 'idea' ? '搜索思路…' : treeKind === 'obs' ? '搜索观察…' : '搜索知识点…',
            onChange: (event) => setQuery(event.target.value),
            style: sx(inputStyle, { flex: 1 }),
          }),
          !allNodes.length
            ? h(Btn, { tone: 'primary', disabled: busy, onClick: () => call('seed') }, '初始化')
            : null,
        ),
        h(
          'div',
          {
            style: {
              flex: 1,
              minHeight: 120,
              overflow: 'auto',
              background: C.layer1,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: 6,
            },
          },
          nodes.length === 0
            ? h(
                Empty,
                null,
                !allNodes.length
                  ? '知识库还是空的。点「初始化」写入内置的 OI/ICPC 知识框架，然后就可以往节点上挂题了。'
                  : treeKind === 'idea'
                    ? '思路树还没有节点。点「初始化」写入内置思路框架。'
                    : treeKind === 'obs'
                      ? '观察树还没有节点。点「初始化」写入内置观察框架。'
                      : '知识树还没有节点。',
              )
            : matches
              ? matches.length
                ? matches.map((node) =>
                    h(
                      'div',
                      {
                        key: node.id,
                        onClick: () => setSelectedId(node.id),
                        style: {
                          padding: '4px 6px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: node.id === selectedId ? C.layer2 : 'transparent',
                        },
                      },
                      h('div', { style: { fontSize: 12.5 } }, node.path),
                      h(
                        'div',
                        { style: { fontSize: 11, color: C.muted } },
                        node.tree === 'idea'
                          ? `${LEVEL_LABEL[node.level]} · 关联题 ${node.linkedProblems} · 洞察 ${node.insightCount}`
                          : node.tree === 'obs'
                            ? `${node.assignments ? '● ' : '○ '}观察 ${node.assignments} 条`
                            : `${LEVEL_LABEL[node.level]} · 题 ${node.solvedCount} · 洞察 ${node.insightCount}`,
                      ),
                    ),
                  )
                : h(Empty, null, `没有匹配「${query}」的知识点。`)
              : rows,
        ),
      )

      const right = selected
        ? selected.tree === 'obs'
          ? h(ObsDetail, { key: selected.id, node: selected })
          : h(NodeDetail, { key: selected.id, node: selected, childrenOf: children })
        : h(
            'div',
            {
              style: {
                flex: '2 1 320px',
                minWidth: 230,
                display: 'flex',
                minHeight: 0,
              },
            },
            h(
              Card,
              { style: { flex: 1 } },
              h(SectionTitle, { first: true }, '怎么用'),
              h(
                'div',
                { style: { fontSize: 12.5, lineHeight: 1.8, color: C.muted } },
                '左边选一个知识点看它的掌握情况。想让 AI 帮你录题、提炼观察和套路，直接在对话里说：',
                h(
                  'div',
                  {
                    style: {
                      margin: '8px 0',
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: C.base,
                      color: C.text,
                      fontFamily: 'monospace',
                      fontSize: 11.5,
                      whiteSpace: 'pre-wrap',
                    },
                  },
                  '帮我录入 CF 1879D，题解：……，提炼这道题的精髓（观察 / 套路 / 思考方向），挂到思路节点上',
                ),
                'AI 会用 oi_problem / oi_kb 工具写进同一份数据；这个面板只负责查看和少量手工修改。',
              ),
            ),
          )

      return h(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' } },
        left,
        right,
      )
    }

    function NodeDetail(props) {
      const node = props.node
      const childrenOf = props.childrenOf
      const { state, call, busy } = useStore()

      const [name, setName] = React.useState(node.name)
      const [summary, setSummary] = React.useState(node.summary || '')
      const [signals, setSignals] = React.useState((node.signals || []).join('\n'))
      const [note, setNote] = React.useState(node.note || '')
      const [mastery, setMastery] = React.useState(node.mastery || 'auto')
      const [editing, setEditing] = React.useState(false)
      const [adding, setAdding] = React.useState(false)
      const [childName, setChildName] = React.useState('')
      const [childKind, setChildKind] = React.useState('concept')

      const subtreeIds = React.useMemo(() => {
        const children = new Map()
        for (const item of state.nodes) {
          if (!item.parent) continue
          if (!children.has(item.parent)) children.set(item.parent, [])
          children.get(item.parent).push(item.id)
        }
        const ids = new Set([node.id])
        const stack = [node.id]
        while (stack.length) {
          const current = stack.pop()
          for (const child of children.get(current) || []) {
            if (!ids.has(child)) {
              ids.add(child)
              stack.push(child)
            }
          }
        }
        return ids
      }, [node.id, state.nodes])

      const touches = (problem, ids) =>
        (problem.nodes || []).some((id) => ids.has(id)) ||
        problem.insights.some((insight) => (insight.nodes || []).some((id) => ids.has(id)))
      const directIds = React.useMemo(() => new Set([node.id]), [node.id])
      const directProblems = state.problems.filter((problem) => touches(problem, directIds))
      const problems = state.problems.filter((problem) => touches(problem, subtreeIds))
      const insights = []
      for (const problem of problems) {
        for (const insight of problem.insights) {
          if ((insight.nodes || []).includes(node.id)) insights.push({ problem, insight })
        }
      }

      const save = async () => {
        if (!name.trim()) return
        const result = await call('updateNode', {
          node: node.id,
          name: name.trim(),
          summary,
          signals: signals
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          note,
          mastery,
        })
        if (result) setEditing(false)
      }

      const addChild = async () => {
        if (!childName.trim()) return
        const result = await call('addNode', {
          parent: node.id,
          name: childName.trim(),
          kind: childKind,
        })
        if (result) {
          setChildName('')
          setAdding(false)
        }
      }

      const moveOptions = []
      for (const other of state.nodes) {
        if (other.id === node.id) continue
        if ((other.tree === 'idea') !== (node.tree === 'idea')) continue
        if (other.path === node.path || other.path.startsWith(`${node.path}/`)) continue
        moveOptions.push([other.id, other.path])
      }

      const isIdea = node.tree === 'idea'

      return h(
        'div',
        { style: { flex: '2 1 340px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 10 } },
        h(
          Card,
          null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 120 } }, node.path),
            h(
              Pill,
              { color: LEVEL_COLOR[node.level] },
              `${LEVEL_GLYPH[node.level]} ${LEVEL_LABEL[node.level]}`,
            ),
            isIdea
              ? h(Pill, null, `关联题 ${node.linkedProblems}`)
              : h(Pill, null, `75 分位 ${node.p75 != null ? Math.round(node.p75) : '—'}`),
          ),
          isIdea
            ? null
            : h(Bar, {
                value: node.score,
                color: LEVEL_COLOR[node.level],
                style: { margin: '8px 0 6px' },
              }),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: C.muted } },
            isIdea
              ? [
                  h('span', { key: 'linked' }, `关联 ${node.linkedProblems} 题`),
                  h('span', { key: 'ins' }, `洞察 ${node.insightCount} 条`),
                  (node.insightKinds || []).length
                    ? h('span', { key: 'kinds' }, `类型 ${node.insightKinds.join('/')}`)
                    : null,
                ]
              : [
                  h('span', { key: 'solved' }, `已通过 ${node.solvedCount} 题`),
                  h('span', { key: 'att' }, `尝试 ${node.attemptedCount} 题`),
                  h('span', { key: 'ins' }, `洞察 ${node.insightCount} 条`),
                  node.p75 ? h('span', { key: 'p75' }, `难度 75 分位 ${Math.round(node.p75)}`) : null,
                  h('span', { key: 'risk' }, `风险 ${(node.risk || 0).toFixed(2)}`),
                ],
          ),
          node.reasons && node.reasons.length
            ? h(
                'ul',
                { style: { margin: '8px 0 0', paddingLeft: 16, fontSize: 12, color: C.muted, lineHeight: 1.7 } },
                node.reasons.map((reason, index) => h('li', { key: index }, reason)),
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' } },
            h(Btn, { onClick: () => setEditing((value) => !value) }, editing ? '收起编辑' : '编辑'),
            h(Btn, { onClick: () => setAdding((value) => !value) }, adding ? '取消新增' : '添加子节点'),
          ),
        ),
        editing
          ? h(
              Card,
              null,
              h(SectionTitle, { first: true }, '编辑知识点'),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h(Field, { label: '名称' }, h('input', { value: name, onChange: (e) => setName(e.target.value), style: inputStyle })),
                h(
                  Field,
                  { label: '一句话说明' },
                  h('textarea', { value: summary, onChange: (e) => setSummary(e.target.value), style: textareaStyle }),
                ),
                h(
                  Field,
                  { label: '识别信号（每行一条）', hint: '比如「n ≤ 2e5 且要数点对 → 先想排序 + 树状数组」' },
                  h('textarea', { value: signals, onChange: (e) => setSignals(e.target.value), style: textareaStyle }),
                ),
                h(
                  Field,
                  { label: '备注' },
                  h('textarea', { value: note, onChange: (e) => setNote(e.target.value), style: textareaStyle }),
                ),
                isIdea
                  ? null
                  : h(
                      Field,
                      { label: '掌握度', hint: '手动覆盖自动评估；auto = 完全按题目和洞察算' },
                      h(Select, {
                        value: mastery,
                        onChange: (e) => setMastery(e.target.value),
                        options: MASTERY,
                      }),
                    ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6 } },
                  h(Btn, { tone: 'primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
                  h(Btn, { onClick: () => setEditing(false) }, '取消'),
                ),
              ),
            )
          : null,
        adding
          ? h(
              Card,
              null,
              h(SectionTitle, { first: true }, '添加子节点'),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h(Field, { label: '名称' }, h('input', { value: childName, onChange: (e) => setChildName(e.target.value), style: inputStyle })),
                h(Field, { label: '类型' }, h(Select, { value: childKind, onChange: (e) => setChildKind(e.target.value), options: NODE_KINDS })),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6 } },
                  h(Btn, { tone: 'primary', disabled: busy, onClick: addChild }, '创建'),
                  h(Btn, { onClick: () => setAdding(false) }, '取消'),
                ),
              ),
            )
          : null,
        h(
          Card,
          null,
          h(SectionTitle, { first: true }, '移动'),
          h(
            'div',
            { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h(
              'div',
              { style: { flex: 1, fontSize: 11.5, color: C.muted } },
              '换一个父节点（不能移到自己的子树里）：',
            ),
            h(Select, {
              value: '',
              options: [['', '选择新的父节点…']].concat(moveOptions),
              onChange: (event) => {
                const value = event.target.value
                if (value) call('moveNode', { node: node.id, parent: value })
              },
              style: { maxWidth: 260 },
            }),
          ),
        ),
        h(
          Card,
          null,
          h(SectionTitle, { first: true }, `关联题目（${problems.length}${problems.length > directProblems.length ? `，本节点 ${directProblems.length}` : ''}）`),
          problems.length
            ? problems.map((problem) =>
                h(
                  'div',
                  {
                    key: problem.id,
                    style: {
                      display: 'flex',
                      gap: 8,
                      alignItems: 'baseline',
                      padding: '3px 0',
                      borderBottom: `1px solid ${C.border}`,
                    },
                  },
                  h(Pill, null, problem.platform === 'codeforces' ? 'CF' : problem.platform === 'atcoder' ? 'AT' : 'LG'),
                  touches(problem, directIds) ? null : h(Pill, { color: C.muted, style: { padding: '0 4px', fontSize: 10 } }, '子节点'),
                  h(
                    'a',
                    {
                      href: problem.url || undefined,
                      target: '_blank',
                      rel: 'noreferrer',
                      style: { color: C.text, textDecoration: 'none', flex: 1, fontSize: 12.5 },
                    },
                    problem.title,
                  ),
                  problem.rating ? h('span', { style: { fontSize: 11.5, color: C.muted } }, problem.rating) : null,
                ),
              )
            : h('div', { style: { fontSize: 12, color: C.muted, padding: '4px 0' } }, '还没有题挂在这个节点上。'),
        ),
        h(
          Card,
          null,
          h(SectionTitle, { first: true }, `沉淀的洞察（${insights.length}）`),
          insights.length
            ? KINDS.map((entry) => {
                const [kind, label] = entry
                const list = insights.filter((item) => item.insight.kind === kind)
                if (!list.length) return null
                return h(
                  'div',
                  { key: kind, style: { marginBottom: 8 } },
                  h(Pill, { color: C.brand, style: { marginBottom: 4 } }, `${label} ${list.length}`),
                  list.map((item) =>
                    h(
                      'div',
                      {
                        key: item.insight.id,
                        style: { fontSize: 12.5, lineHeight: 1.65, padding: '3px 0 3px 2px' },
                      },
                      item.insight.text ? h(MathText, { text: item.insight.text }) : null,
                      h(
                        'div',
                        { style: { fontSize: 11, color: C.muted } },
                        `来自《${item.problem.title}》`,
                      ),
                    ),
                  ),
                )
              })
            : h('div', { style: { fontSize: 12, color: C.muted, padding: '4px 0' } }, '还没有洞察。让 AI 录入题解时会自动提炼。'),
        ),
      )
    }

    // ── 题目 ─────────────────────────────────────────────────────────────
    function ProblemsTab() {
      const { state, call, busy } = useStore()
      const [query, setQuery] = React.useState('')
      const [selectedId, setSelectedId] = React.useState(null)
      const [adding, setAdding] = React.useState(false)

      const problems = React.useMemo(() => {
        const word = query.trim().toLowerCase()
        const list = state.problems.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        if (!word) return list
        return list.filter((problem) =>
          `${problem.title} ${problem.key} ${problem.platform} ${(problem.tags || []).join(' ')} ${(problem.nodePaths || []).join(' ')}`
            .toLowerCase()
            .includes(word),
        )
      }, [state.problems, query])

      const selected = selectedId ? state.problems.find((problem) => problem.id === selectedId) || null : null

      const left = h(
        'div',
        { style: { flex: '1 1 260px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 } },
        h(
          'div',
          { style: { display: 'flex', gap: 6 } },
          h('input', {
            value: query,
            placeholder: '按标题 / 题号 / tag / 知识点筛选…',
            onChange: (event) => setQuery(event.target.value),
            style: sx(inputStyle, { flex: 1 }),
          }),
          h(Btn, { tone: 'primary', onClick: () => setAdding((value) => !value) }, adding ? '收起' : '录题'),
        ),
        adding ? h(AddProblemForm, { onDone: () => setAdding(false) }) : null,
        h(
          'div',
          {
            style: {
              flex: 1,
              minHeight: 120,
              overflow: 'auto',
              background: C.layer1,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: 6,
            },
          },
          problems.length === 0
            ? h(Empty, null, state.problems.length ? `没有匹配「${query}」的题目。` : '还没有题目。可以直接在对话里跟 AI 说「把这道题录入」，也可以点「录题」手工填。')
            : problems.map((problem) =>
                h(
                  'div',
                  {
                    key: problem.id,
                    onClick: () => setSelectedId(problem.id),
                    style: {
                      padding: '5px 6px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: problem.id === selectedId ? C.layer2 : 'transparent',
                    },
                  },
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, alignItems: 'baseline' } },
                    h('span', { style: { fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, problem.title),
                    problem.rating ? h('span', { style: { fontSize: 11, color: C.muted, flex: 'none' } }, problem.rating) : null,
                  ),
                  h(
                    'div',
                    { style: { fontSize: 11, color: C.muted, display: 'flex', gap: 6, flexWrap: 'wrap' } },
                    h('span', null, `${problem.platform} ${problem.key}`),
                    h('span', null, `· 洞察 ${problem.insights.length}`),
                    problem.stuckStage ? h('span', { style: { color: C.warn } }, `· 卡在${STUCK_LABEL[problem.stuckStage] || problem.stuckStage}`) : null,
                    problem.nodePaths.slice(0, 2).map((path) => h('span', { key: path }, `· ${path}`)),
                  ),
                ),
              ),
        ),
      )

      const right = selected
        ? h(ProblemDetail, { key: selected.id, problem: selected })
        : h(
            'div',
            { style: { flex: '2 1 340px', minWidth: 240, display: 'flex' } },
            h(
              Card,
              { style: { flex: 1 } },
              h(SectionTitle, { first: true }, '题目库'),
              h(
                'div',
                { style: { fontSize: 12.5, lineHeight: 1.8, color: C.muted } },
                `共 ${state.problems.length} 道，其中未分类 ${state.unclassified.length} 道。左边点一道题看它的题面、题解和提炼出来的知识点。`,
                '想让 AI 一次性整理一批题，可以在对话里说「同步 CF 账号，把最近的题按知识点分类并标出弱点」。',
              ),
            ),
          )

      return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' } }, left, right)
    }

    function AddProblemForm(props) {
      const { call, busy } = useStore()
      const [platform, setPlatform] = React.useState('codeforces')
      const [key, setKey] = React.useState('')
      const [url, setUrl] = React.useState('')
      const [verdict, setVerdict] = React.useState('solved')
      const [tags, setTags] = React.useState('')
      const [essence, setEssence] = React.useState('')
      const [statement, setStatement] = React.useState('')
      const [solution, setSolution] = React.useState('')
      const [insightKind, setInsightKind] = React.useState('observation')
      const [insightText, setInsightText] = React.useState('')

      const submit = async () => {
        if (!key.trim() && !url.trim()) return
        const insights = insightText.trim() ? [{ kind: insightKind, text: insightText.trim() }] : []
        const result = await call('addProblem', {
          platform,
          key: key.trim(),
          url: url.trim(),
          verdict,
          tags: splitTags(tags),
          essence,
          statement,
          solution,
          insights,
        })
        if (result) props.onDone()
      }

      return h(
        Card,
        { padding: '10px 12px' },
        h(SectionTitle, { first: true }, '手工录入题目'),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h(
            'div',
            { style: { display: 'flex', gap: 6 } },
            h(Select, { value: platform, onChange: (e) => setPlatform(e.target.value), options: PLATFORMS, style: { width: 118 } }),
            h('input', {
              value: key,
              placeholder: '题号，如 1879D / abc300_f / P1234',
              onChange: (e) => setKey(e.target.value),
              style: inputStyle,
            }),
          ),
          h('input', {
            value: url,
            placeholder: '或者直接贴题目链接',
            onChange: (e) => setUrl(e.target.value),
            style: inputStyle,
          }),
          h(
            'div',
            { style: { display: 'flex', gap: 6 } },
            h(Select, { value: verdict, onChange: (e) => setVerdict(e.target.value), options: VERDICTS, style: { width: 118 } }),
            h('input', { value: tags, placeholder: 'tags：dp, graphs', onChange: (e) => setTags(e.target.value), style: inputStyle }),
          ),
          h('input', {
            value: essence,
            placeholder: '一句话精髓：这题最关键的那一步是什么（强烈建议写）',
            onChange: (e) => setEssence(e.target.value),
            style: inputStyle,
          }),
          h('textarea', {
            value: statement,
            placeholder: '题意（可省略）',
            onChange: (e) => setStatement(e.target.value),
            style: sx(textareaStyle, { minHeight: 50 }),
          }),
          h('textarea', {
            value: solution,
            placeholder: '题解 / 做法（可省略）',
            onChange: (e) => setSolution(e.target.value),
            style: sx(textareaStyle, { minHeight: 60 }),
          }),
          h(
            'div',
            { style: { display: 'flex', gap: 6, alignItems: 'flex-start' } },
            h(Select, { value: insightKind, onChange: (e) => setInsightKind(e.target.value), options: KINDS.map((entry) => [entry[0], entry[1]]), style: { width: 100 } }),
            h('textarea', {
              value: insightText,
              placeholder: '顺手记一条观察/套路（可省略），AI 会按文字自动挂知识点',
              onChange: (e) => setInsightText(e.target.value),
              style: sx(textareaStyle, { minHeight: 44 }),
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 6 } },
            h(Btn, { tone: 'primary', disabled: busy, onClick: submit }, busy ? '保存中…' : '录入'),
            h(Btn, { onClick: props.onDone }, '取消'),
          ),
        ),
      )
    }

    function ProblemDetail(props) {
      const problem = props.problem
      const { state, call, busy } = useStore()
      const [detail, setDetail] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [tick, setTick] = React.useState(0)
      const [kind, setKind] = React.useState('observation')
      const [text, setText] = React.useState('')
      const [editingBody, setEditingBody] = React.useState(false)
      const [essence, setEssence] = React.useState('')
      const [statement, setStatement] = React.useState('')
      const [solution, setSolution] = React.useState('')

      React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        fetch(apiUrl(`problem?id=${encodeURIComponent(problem.id)}`), { credentials: 'same-origin', cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((value) => {
            if (cancelled) return
            const entity = value && value.problem ? value.problem : null
            setDetail(entity)
            if (entity) {
              setEssence(entity.essence || '')
              setStatement(entity.statement || '')
              setSolution(entity.solution || '')
            }
          })
          .catch(() => {
            if (!cancelled) setDetail(null)
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [problem.id, tick])

      const addInsight = async () => {
        if (!text.trim()) return
        const result = await call('addInsight', { problem: problem.id, kind, text: text.trim() })
        if (result) {
          setText('')
          setTick((value) => value + 1)
        }
      }

      const saveBody = async () => {
        const result = await call('updateProblem', { problem: problem.id, essence, statement, solution })
        if (result) {
          setEditingBody(false)
          setTick((value) => value + 1)
        }
      }

      const entity = detail || problem
      const insights = entity.insights || []
      const grouped = KINDS.map((entry) => ({
        kind: entry[0],
        label: entry[1],
        list: insights.filter((insight) => insight.kind === entry[0]),
      })).filter((group) => group.list.length)

      return h(
        'div',
        { style: { flex: '2 1 380px', minWidth: 250, display: 'flex', flexDirection: 'column', gap: 10 } },
        h(
          Card,
          null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
            h(
              'a',
              {
                href: entity.url || undefined,
                target: '_blank',
                rel: 'noreferrer',
                style: { color: C.text, textDecoration: 'none', fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 120 },
              },
              entity.title,
            ),
            h(Pill, null, `${entity.platform === 'codeforces' ? 'CF' : entity.platform === 'atcoder' ? 'AT' : 'LG'} ${entity.key}`),
            entity.rating ? h(Pill, null, `${entity.rating}`) : null,
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' } },
            h(Select, {
              value: entity.verdict,
              options: VERDICTS,
              style: { width: 108 },
              onChange: async (event) => {
                const result = await call('updateProblem', { problem: problem.id, verdict: event.target.value })
                if (result) setTick((value) => value + 1)
              },
            }),
            h(Btn, {
              disabled: busy,
              onClick: async () => {
                const result = await call('classifyProblem', { problem: problem.id })
                if (result) setTick((value) => value + 1)
              },
            }, '重新分类'),
            h(Btn, { onClick: () => setEditingBody((value) => !value) }, editingBody ? '收起题面' : '编辑题面/题解'),
            h(Btn, {
              tone: 'danger',
              disabled: busy,
              onClick: () => {
                if (typeof window !== 'undefined' && !window.confirm(`删除《${entity.title}》？题目和它的洞察都会从库里去掉。`)) return
                call('removeProblem', { problem: problem.id })
              },
            }, '删除'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { style: { fontSize: 11.5, color: C.textDim } }, '卡在哪一步'),
            STUCK_STAGES.map(([value, label, hint]) =>
              h(
                Btn,
                {
                  key: value,
                  tone: entity.stuckStage === value ? 'primary' : undefined,
                  title: hint,
                  disabled: busy,
                  onClick: async () => {
                    const next = entity.stuckStage === value ? '' : value
                    const result = await call('markStuck', { problem: problem.id, stage: next })
                    if (result) setTick((tickValue) => tickValue + 1)
                  },
                },
                label,
              ),
            ),
            entity.stuckStage
              ? h(
                  Btn,
                  {
                    disabled: busy,
                    onClick: async () => {
                      const result = await call('markStuck', { problem: problem.id, stage: '' })
                      if (result) setTick((tickValue) => tickValue + 1)
                    },
                  },
                  '清除',
                )
              : null,
          ),

          (entity.tags || []).length
            ? h(
                'div',
                { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 } },
                entity.tags.map((tag) => h(Pill, { key: tag }, tag)),
              )
            : null,
          (entity.nodePaths || []).length
            ? h(
                'div',
                { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 } },
                entity.nodePaths.map((path) => h(Pill, { key: path, color: C.brand }, path)),
              )
            : h('div', { style: { marginTop: 6, fontSize: 11.5, color: C.warn } }, '还没挂到任何知识点，点「重新分类」试试。'),
          entity.essence
            ? h(
                'div',
                {
                  style: {
                    marginTop: 8,
                    padding: '6px 9px',
                    borderLeft: `2px solid ${C.brand}`,
                    background: C.base,
                    fontSize: 12.5,
                    lineHeight: 1.7,
                  },
                },
                h('span', { style: { color: C.muted, marginRight: 6 } }, '精髓'),
                h(MathText, { text: entity.essence }),
              )
            : null,
          loading ? h('div', { style: { marginTop: 6, fontSize: 11.5, color: C.muted } }, '读取题面中…') : null,
        ),
        editingBody
          ? h(
              Card,
              null,
              h(SectionTitle, { first: true }, '精髓'),
              h('textarea', {
                value: essence,
                placeholder: '一句话说清这题最关键的那一步',
                onChange: (e) => setEssence(e.target.value),
                style: sx(textareaStyle, { minHeight: 52 }),
              }),
              h(SectionTitle, null, '题面'),
              h('textarea', { value: statement, onChange: (e) => setStatement(e.target.value), style: sx(textareaStyle, { minHeight: 90 }) }),
              h(SectionTitle, null, '题解 / 做法'),
              h('textarea', { value: solution, onChange: (e) => setSolution(e.target.value), style: sx(textareaStyle, { minHeight: 110 }) }),
              h(
                'div',
                { style: { display: 'flex', gap: 6, marginTop: 8 } },
                h(Btn, { tone: 'primary', disabled: busy, onClick: saveBody }, '保存'),
                h(Btn, { onClick: () => setEditingBody(false) }, '取消'),
              ),
            )
          : null,
        !editingBody && (entity.statement || entity.solution)
          ? h(
              Card,
              null,
              entity.statement
                ? h(
                    'div',
                    null,
                    h(SectionTitle, { first: true }, '题意'),
                    h('div', { style: { fontSize: 12.5, lineHeight: 1.75, whiteSpace: 'pre-wrap' } }, h(MathText, { text: entity.statement })),
                  )
                : null,
              entity.solution
                ? h(
                    'div',
                    null,
                    h(SectionTitle, { first: !entity.statement }, '题解 / 做法'),
                    h('div', { style: { fontSize: 12.5, lineHeight: 1.75, whiteSpace: 'pre-wrap' } }, h(MathText, { text: entity.solution })),
                  )
                : null,
            )
          : null,
        h(
          Card,
          null,
          h(SectionTitle, { first: true }, `知识点洞察（${insights.length}）`),
          grouped.length
            ? grouped.map((group) =>
                h(
                  'div',
                  { key: group.kind, style: { marginBottom: 8 } },
                  h(Pill, { color: C.brand, style: { marginBottom: 4 } }, `${group.label} ${group.list.length}`),
                  group.list.map((insight) =>
                    h(
                      'div',
                      { key: insight.id, style: { display: 'flex', gap: 8, padding: '3px 0', fontSize: 12.5, lineHeight: 1.65 } },
                      h('span', { style: { flex: 1 } }, h(MathText, { text: insight.text })),
                      h(
                        'button',
                        {
                          type: 'button',
                          title: '删除这条',
                          onClick: async () => {
                            const result = await call('removeInsight', { problem: problem.id, insight: insight.id })
                            if (result) setTick((value) => value + 1)
                          },
                          style: { border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer', fontSize: 12 },
                        },
                        '×',
                      ),
                    ),
                  ),
                ),
              )
            : h('div', { style: { fontSize: 12, color: C.muted, padding: '2px 0 6px' } }, '还没有提炼洞察。可以自己加一条，或让 AI 读题解后提炼。'),
          h(
            'div',
            { style: { display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 6 } },
            h(Select, { value: kind, onChange: (e) => setKind(e.target.value), options: KINDS.map((entry) => [entry[0], entry[1]]), style: { width: 96 } }),
            h('textarea', {
              value: text,
              placeholder: '这条题的观察 / 套路 / 思路 / 思考方向 / 坑点…',
              onChange: (e) => setText(e.target.value),
              style: sx(textareaStyle, { minHeight: 46 }),
            }),
          ),
          h(Btn, { tone: 'primary', disabled: busy || !text.trim(), onClick: addInsight, style: { marginTop: 6 } }, '添加洞察'),
        ),
      )
    }

    // ── 弱点 ─────────────────────────────────────────────────────────────
    function WeakTab() {
      const { state, call, busy } = useStore()
      const [novelInput, setNovelInput] = React.useState('')
      const [novelThreshold, setNovelThreshold] = React.useState('0.3')
      const [novelResult, setNovelResult] = React.useState(null)
      const [novelLoading, setNovelLoading] = React.useState(false)
      const overview = state.overview

      const runNovel = async () => {
        const candidates = novelInput
          .split(/[\s,，;；]+/)
          .map((item) => item.trim())
          .filter(Boolean)
        setNovelLoading(true)
        try {
          const result = await call('recommendNovel', {
            candidates,
            threshold: Number(novelThreshold) || 0.3,
          })
          if (result) setNovelResult(result)
        } finally {
          setNovelLoading(false)
        }
      }

      const calibrate = async () => {
        const result = await call('calibrate', {})
        if (result && result.recommendedThreshold != null) {
          setNovelThreshold(String(result.recommendedThreshold))
        }
      }

      const stuck = overview.stuck || {}
      const stuckTotal = STUCK_STAGES.reduce((sum, [value]) => sum + (stuck[value] || 0), 0)
      const stuckTop = STUCK_STAGES.map(([value, label]) => [label, stuck[value] || 0]).sort((a, b) => b[1] - a[1])[0]

      const cards = [
        ['覆盖', `${overview.coveredPct}%`, `已触达 ${overview.covered}/${Math.max(0, overview.nodes - 1)} 个节点`],
        ['非常熟练', overview.expert, '◆ 稳定到能当工具用'],
        ['熟练', overview.strong, '● 基本稳，偶尔失手'],
        ['还行', overview.ok, '◐ 有基础但不够稳'],
        ['不熟练', overview.weak, '▲ 做过但明显不够'],
        ['非常不熟练', overview.poor, '▽ 只沾过边'],
        ['空白', overview.blank, '○ 完全没碰过'],
        ['同步', overview.syncedSolved, '来自账号同步的已通过题'],
        ['手录', overview.manualProblems, `其中已通过 ${overview.manualSolved}`],
        ['思路覆盖', `${overview.ideaNodes ? Math.round((overview.ideaCovered / Math.max(1, overview.ideaNodes - 1)) * 100) : 0}%`, `已沉淀 ${overview.ideaCovered}/${Math.max(0, overview.ideaNodes - 1)} 个思路`],
        ['思路洞察', overview.ideaInsights, '挂在思路节点上的洞察'],
        ['观察树', `${overview.keyObservations || 0} 条`, `未归类 ${overview.obsUnassigned || 0} 条 / ${overview.obsNodes || 0} 节点`],
        ['卡点', stuckTotal || '—', stuckTotal ? `最多：${stuckTop[0]} ${stuckTop[1]}` : '还没记录卡点'],
        ['洞察', overview.insights, `卡住的题 ${overview.manualStuck}`],
      ]

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(
          'div',
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          cards.map((entry) =>
            h(
              Card,
              { key: entry[0], style: { flex: '1 1 104px', minWidth: 96, padding: '8px 10px' } },
              h('div', { style: { fontSize: 11, color: C.muted } }, entry[0]),
              h('div', { style: { fontSize: 18, fontWeight: 600, margin: '2px 0' } }, String(entry[1])),
              h('div', { style: { fontSize: 10.5, color: C.muted, lineHeight: 1.5 } }, entry[2]),
            ),
          ),
        ),
        stuckTotal
          ? h(
              Card,
              null,
              h(SectionTitle, { first: true }, '卡在哪一步'),
              h(
                'div',
                { style: { fontSize: 11.5, color: C.muted, marginBottom: 6, lineHeight: 1.6 } },
                '过没过只是结果。这个分布才告诉你下一步该练观察、推导、实现还是调试。',
              ),
              STUCK_STAGES.map(([value, label, hint]) => {
                const count = stuck[value] || 0
                const ratio = stuckTotal ? count / stuckTotal : 0
                return h(
                  'div',
                  { key: value, style: { padding: '6px 0', borderBottom: `1px solid ${C.border}` } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
                    h('span', { style: { flex: 1, fontSize: 12.5 } }, `${label}`),
                    h('span', { style: { fontSize: 11, color: C.muted } }, hint),
                    h('span', { style: { fontSize: 12, width: 40, textAlign: 'right' } }, `${count}`),
                    h('span', { style: { fontSize: 11, color: C.muted, width: 44, textAlign: 'right' } }, `${Math.round(ratio * 100)}%`),
                  ),
                  h(Bar, { value: ratio, color: C.brand, style: { margin: '5px 0 3px' } }),
                )
              }),
            )
          : null,
        h(
          Card,
          null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(SectionTitle, { first: true, style: { margin: 0, flex: 1 } }, '最该补的知识点'),
          ),
          state.top.length
            ? state.top.slice(0, 14).map((row) =>
                h(
                  'div',
                  { key: row.id, style: { padding: '6px 0', borderBottom: `1px solid ${C.border}` } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
                    h('span', { style: { fontSize: 10, color: LEVEL_COLOR[row.level] } }, LEVEL_GLYPH[row.level]),
                    h('span', { style: { flex: 1, fontSize: 12.5 } }, row.path),
                    h(Pill, { color: LEVEL_COLOR[row.level] }, LEVEL_LABEL[row.level]),
                    h('span', { style: { fontSize: 11, color: C.muted, width: 62, textAlign: 'right' } }, `风险 ${row.risk.toFixed(2)}`),
                  ),
                  h(Bar, { value: row.risk, color: LEVEL_COLOR[row.level], style: { margin: '5px 0 3px' } }),
                  h(
                    'div',
                    { style: { fontSize: 11, color: C.muted, lineHeight: 1.6 } },
                    row.reasons && row.reasons.length ? row.reasons.join('；') : '证据不足',
                  ),
                ),
              )
            : h(Empty, null, '还没有分析结果。先初始化知识树并同步账号，或手工录几道题。'),
          state.ideaTop && state.ideaTop.length
            ? h(
                'div',
                { style: { marginTop: 14 } },
                h(SectionTitle, { first: true }, '最该补的思路'),
                h(
                  'div',
                  { style: { fontSize: 11.5, color: C.muted, marginBottom: 6, lineHeight: 1.6 } },
                  '这些方向还没沉淀成套路。做过再多题，不写观察和思考方向就只是刷题记录。',
                ),
                state.ideaTop.slice(0, 12).map((row) =>
                  h(
                    'div',
                    { key: row.id, style: { padding: '5px 0', borderBottom: `1px solid ${C.border}` } },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
                      h('span', { style: { fontSize: 10, color: LEVEL_COLOR[row.level] } }, LEVEL_GLYPH[row.level]),
                      h('span', { style: { flex: 1, fontSize: 12.5 } }, row.path),
                      h(Pill, { style: { padding: '0 5px', fontSize: 10 } }, `题${row.linkedProblems}`),
                      h(Pill, { style: { padding: '0 5px', fontSize: 10 }, color: C.brand }, `✨${row.insightCount}`),
                    ),
                    h(
                      'div',
                      { style: { fontSize: 11, color: C.muted, lineHeight: 1.6 } },
                      row.reasons && row.reasons.length
                        ? row.reasons.join('；')
                        : '有记录，但条数还不够形成套路',
                    ),
                  ),
                ),
              )
            : null,
        ),
        h(
          Card,
          null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(SectionTitle, { first: true, style: { margin: 0, flex: 1 } }, '反套路推荐'),
            h(Btn, { disabled: busy, onClick: calibrate }, '校准阈值'),
          ),
          h(
            'div',
            { style: { fontSize: 11.5, color: C.muted, marginBottom: 8, lineHeight: 1.7 } },
            '相似度只算「精髓观察（60%）+ 其他洞察（22%）+ 算法知识点（18%）」，不算题面文字。候选和库内题目最像的一道都低于阈值，就说明你没见过这类想法。候选需要先经题解消化（sample 入库）才能比较；不填则取最近消化的 10 道。',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' } },
            h(
              Field,
              { label: '候选（题号或链接，空格/逗号分隔；留空取最近 10 道）', style: { flex: '1 1 240px' } },
              h('textarea', {
                value: novelInput,
                placeholder: '如 abc300_f  agc070_a',
                onChange: (e) => setNovelInput(e.target.value),
                style: sx(textareaStyle, { minHeight: 46 }),
              }),
            ),
            h(
              Field,
              { label: '阈值' },
              h('input', {
                type: 'number',
                step: '0.05',
                min: '0',
                max: '1',
                value: novelThreshold,
                onChange: (e) => setNovelThreshold(e.target.value),
                style: sx(inputStyle, { width: 82 }),
              }),
            ),
            h(Btn, { tone: 'primary', disabled: busy || novelLoading, onClick: runNovel }, novelLoading ? '比较中…' : '推荐'),
          ),
          novelResult
            ? h(
                'div',
                { style: { marginTop: 10 } },
                h(
                  'div',
                  { style: { fontSize: 11.5, color: C.muted, marginBottom: 4 } },
                  `阈值 ${novelResult.threshold} · 候选 ${novelResult.sampled} 道 · 通过 ${(novelResult.recommended || []).length} 道`,
                ),
                (novelResult.rows || []).slice(0, 12).map((row) => {
                  const problem = row.problem
                  return h(
                    'div',
                    { key: problem.id, style: { padding: '6px 0', borderBottom: `1px solid ${C.border}` } },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
                      h('span', { style: { fontSize: 11, color: row.recommended ? C.brand : C.muted, width: 12, flex: 'none' } }, row.recommended ? '★' : '·'),
                      h(
                        'a',
                        { href: problem.url, target: '_blank', rel: 'noreferrer', style: { flex: 1, fontSize: 12.5, color: C.text, textDecoration: 'none' } },
                        `${problem.title}（${problem.key}${problem.rating ? `，${problem.rating}` : ''}）`,
                      ),
                      h('span', { style: { fontSize: 11, color: row.recommended ? C.brand : C.muted } }, `${Math.round(row.minSimilarity * 100)}%`),
                    ),
                    h(Bar, { value: row.minSimilarity, color: row.recommended ? C.brand : C.border, style: { margin: '5px 0 3px' } }),
                    h(
                      'div',
                      { style: { fontSize: 11, color: C.muted, lineHeight: 1.6 } },
                      row.nearest ? `最像《${row.nearest.title}》` : '库里没有可比对象',
                      row.shared && row.shared.obs && row.shared.obs.length
                        ? `；共同观察：${row.shared.obs.slice(0, 2).join('、')}`
                        : '；精髓观察完全不重叠',
                    ),
                  )
                }),
              )
            : h(
                'div',
                { style: { marginTop: 8 } },
                h(Empty, null, '点「推荐」后，这里会按陌生程度列出候选题目。'),
              ),
        ),
        h(
          Card,
          null,
          h(SectionTitle, { first: true }, 'tag 覆盖（已通过题数最少的排前面）'),
          state.gaps.length
            ? h(
                'div',
                null,
                state.gaps.slice(0, 24).map((gap) =>
                  h(
                    'div',
                    { key: gap.tag, style: { display: 'flex', gap: 8, padding: '3px 0', fontSize: 12, borderBottom: `1px solid ${C.border}` } },
                    h('span', { style: { width: 148, flex: 'none' } }, gap.tag),
                    h('span', { style: { width: 46, flex: 'none', color: C.muted } }, `${gap.solved} 题`),
                    h('span', { style: { width: 78, flex: 'none', color: C.muted } }, gap.medianRating ? `中位 ${gap.medianRating}` : '—'),
                    h('span', { style: { flex: 1, color: gap.mappedPath ? C.muted : C.warn } }, gap.mappedPath || '未映射知识点'),
                  ),
                ),
              )
            : h(Empty, null, '同步账号后这里会按 tag 统计你已经做过的题。'),
        ),
        h(
          Card,
          null,
          h(SectionTitle, { first: true }, `未分类题目（${state.unclassified.length}）`),
          state.unclassified.length
            ? state.unclassified.map((problem) =>
                h(
                  'div',
                  { key: problem.id, style: { display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 } },
                  h('span', { style: { flex: 1 } }, problem.title),
                  h('span', { style: { color: C.muted } }, `${problem.platform} ${problem.key}`),
                ),
              )
            : h('div', { style: { fontSize: 12, color: C.muted } }, '每道题都至少挂了一个知识点。'),
        ),
      )
    }

    // ── 账号 ─────────────────────────────────────────────────────────────
    function AccountsTab() {
      const { state, call, busy } = useStore()
      const [platform, setPlatform] = React.useState('codeforces')
      const [handle, setHandle] = React.useState('')
      const [cookie, setCookie] = React.useState('')
      const [force, setForce] = React.useState(false)

      const submit = async () => {
        if (!handle.trim()) return
        const result = await call('addAccount', { platform, handle: handle.trim(), cookie: cookie.trim() })
        if (result) {
          setHandle('')
          setCookie('')
        }
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(
          Card,
          null,
          h(SectionTitle, { first: true }, '绑定账号'),
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Select, { value: platform, onChange: (e) => setPlatform(e.target.value), options: PLATFORMS, style: { width: 128 } }),
            h('input', {
              value: handle,
              placeholder: platform === 'luogu' ? '洛谷数字 UID 或主页链接' : 'handle（用户名）',
              onChange: (e) => setHandle(e.target.value),
              style: sx(inputStyle, { flex: '1 1 160px' }),
            }),
            h(Btn, { tone: 'primary', disabled: busy, onClick: submit }, '添加'),
          ),
          platform === 'luogu'
            ? h(
                'div',
                { style: { marginTop: 8 } },
                h(Field, {
                  label: '洛谷 Cookie（可选，私有提交记录需要）',
                  hint: '只保存在本机的 kb.json 里；公开提交一般不需要。',
                }, h('textarea', { value: cookie, onChange: (e) => setCookie(e.target.value), style: sx(textareaStyle, { minHeight: 44 }) })),
              )
            : null,
          h(
            'label',
            { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, fontSize: 12, color: C.muted } },
            h('input', { type: 'checkbox', checked: force, onChange: (e) => setForce(e.target.checked) }),
            '同步时强制刷新题目标签缓存（AtCoder 题库 / Codeforces problemset，约 7 天过期）',
          ),
          h(
            'div',
            { style: { fontSize: 11.5, color: C.muted, lineHeight: 1.7, marginTop: 8 } },
            'Codeforces 走官方 user.status 接口（只取 AC）；AtCoder 走 kenkoooo 的公开数据；洛谷没有公开 API，用题目列表尽力解析，失败时会如实报错。',
          ),
        ),
        state.accounts.length
          ? state.accounts.map((account) =>
              h(
                Card,
                { key: account.id },
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
                  h(Pill, null, account.platform),
                  h('span', { style: { fontSize: 13, fontWeight: 600, flex: 1 } }, account.handle),
                  h('span', { style: { fontSize: 11.5, color: C.muted } }, `已同步 ${account.solvedCount} 题`),
                ),
                h(
                  'div',
                  { style: { fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.6 } },
                  account.lastSyncAt
                    ? `上次同步 ${String(account.lastSyncAt).slice(0, 16).replace('T', ' ')}`
                    : '还没同步过',
                  account.lastResult && account.lastResult.ok === false
                    ? `；上次失败：${account.lastResult.message}`
                    : '',
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, marginTop: 8 } },
                  h(
                    Btn,
                    {
                      tone: 'primary',
                      disabled: busy,
                      onClick: () => call('syncAccount', { platform: account.platform, handle: account.handle, force }),
                    },
                    busy ? '同步中…' : '同步已通过',
                  ),
                  h(
                    Btn,
                    {
                      tone: 'danger',
                      disabled: busy,
                      onClick: () => {
                        if (typeof window !== 'undefined' && !window.confirm(`移除 ${account.platform} 账号 ${account.handle}？同步缓存也会删掉。`)) return
                        call('removeAccount', { platform: account.platform, handle: account.handle })
                      },
                    },
                    '移除',
                  ),
                ),
              ),
            )
          : h(Card, null, h(Empty, null, '还没有绑定账号。绑定后点「同步已通过」，面板就会按知识点统计你的做题分布。')),
        h(
          Card,
          null,
          h(SectionTitle, { first: true }, '数据位置'),
          h('div', { style: { fontSize: 11.5, color: C.muted, lineHeight: 1.7, wordBreak: 'break-all' } }, state.dataDir),
          h(
            'div',
            { style: { fontSize: 11.5, color: C.muted, lineHeight: 1.7, marginTop: 6 } },
            `最后更新：${String(state.updatedAt || '').slice(0, 16).replace('T', ' ')} · revision ${state.revision}`,
          ),
        ),
      )
    }

    // ── 侧栏图标 ─────────────────────────────────────────────────────────
    function SidebarIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      const stroke = 'currentColor'
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M12 4.5v3.2M12 7.7 6.5 11M12 7.7 17.5 11M6.5 11v3.4M17.5 11v3.4',
          stroke,
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 12, cy: 3.6, r: 1.7, fill: stroke }),
        h('circle', { cx: 6.5, cy: 15.8, r: 1.7, fill: stroke }),
        h('circle', { cx: 12, cy: 15.8, r: 1.7, fill: stroke }),
        h('circle', { cx: 17.5, cy: 15.8, r: 1.7, fill: stroke }),
        h('circle', { cx: 12, cy: 20.4, r: 1.4, fill: stroke, opacity: 0.65 }),
      )
    }

    // ── 注册 ─────────────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.slots.inject('main', () =>
        ctx.slots.inject('sidebar.panellist', () => {
          const stopMain = ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel)
          let stopIcon
          try {
            stopIcon = ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 32,
                label: () => 'OI 知识点',
                locale: 'oi-knowledge',
              },
              SidebarIcon,
            )
          } catch (error) {
            stopIcon = undefined
            stopMain()
            throw error
          }
          return () => {
            if (stopIcon) stopIcon()
            stopMain()
          }
        }),
      )
    }

    return {
      inject: ['slots'],
      name: 'dsh-oi-knowledge',
      apply,
      __test: { MathText, richTextNodes, mathTokens },
    }
  },
})
