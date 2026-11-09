/**
 * 轻量 LaTeX 渲染自测：不需要浏览器，用桩 React 把 element 树拍平成字符串。
 * 运行：& $node dev\math-test.mjs（工作目录为插件根目录）
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children }
  },
  useMemo(fn) {
    return fn()
  },
  useState(value) {
    return [value, () => {}]
  },
  useEffect() {},
  useLayoutEffect() {},
  useCallback(fn) {
    return fn
  },
  useContext() {
    return null
  },
  useRef(value) {
    return { current: value }
  },
  createContext(defaultValue) {
    return { _default: defaultValue, Provider: (props) => (props ? props.children : null) }
  },
}
React.default = React

let entry = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      entry = spec
    },
  },
}

const fakeRequire = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
}

const clientPath = path.resolve('client.js')
await import(pathToFileURL(clientPath).href)
if (!entry || entry.id !== 'dsh-oi-knowledge') throw new Error('client module entry not loaded')
const moduleExports = entry.factory(fakeRequire)
const test = moduleExports.__test
if (!test || typeof test.MathText !== 'function') throw new Error('__test hooks missing')

function flatten(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatten).join('')
  const { type, props, children } = node
  if (typeof type === 'function') return flatten(type(props || {}))
  const inner = (children || []).map(flatten).join('')
  if (typeof type !== 'string') return inner
  const style = props && props.style ? props.style : null
  if (style && style.borderBottom) return `<frac>${inner}</frac>`
  if (style && style.borderTop) return `<root>${inner}</root>`
  return `<${type}>${inner}</${type}>`
}

function render(text) {
  return flatten(test.MathText({ text }))
}

const cases = []
function check(name, actual, predicate, hint) {
  const ok = predicate(actual)
  cases.push({ name, ok, actual, hint })
}

check('纯文本原样', render('just text'), (out) => out === '<span>just text</span>', '<span>just text</span>')
check('行内命令', render('$O(N\\log N)$'), (out) => out.includes('O(Nlog N)'), '包含 O(Nlog N)')
check('下标', render('$dp_{i,j}$'), (out) => out.includes('<sub>i,j</sub>'), '包含 <sub>i,j</sub>')
check('上标', render('$2^{i-a+1}$'), (out) => out.includes('<sup>i-a+1</sup>'), '包含 <sup>i-a+1</sup>')
check('分式', render('$\\frac{a}{b}$'), (out) => out.includes('<frac>') && out.includes('a') && out.includes('b'), '包含 <frac>')
check('根号', render('$\\sqrt{2}$'), (out) => out.includes('<root>2</root>'), '包含 <root>2</root>')
check('符号映射', render('$x \\le y \\cdot z$'), (out) => out.includes('x ≤ y · z'), '包含 x ≤ y · z')
check('文本命令', render('$\\text{and}$'), (out) => out.includes('and') && !out.includes('text'), '只保留 and')
check('mathrm', render('$\\mathrm{laminar}$'), (out) => out.includes('laminar') && !out.includes('mathrm'), '只保留 laminar')
check('mathbb', render('$\\mathbb{R}$'), (out) => out.includes('ℝ'), '包含 ℝ')
check('括号数学', render(String.raw`前 \(n\) 后`), (out) => out.includes('前') && out.includes('<span>n</span>') && out.includes('后'), '前后文与 n')
check('块级数学', render('$$a+b$$'), (out) => out.includes('display') || out.includes('a+b'), '包含 a+b')
check('未闭合美元', render('价格 $5 元'), (out) => out.includes('$5'), '保留原始 $5')
check('多个数学段', render('$a$ 和 $b$'), (out) => (out.match(/<span>/g) || []).length >= 2 && out.includes('和'), '两段数学与连接词')

let failed = 0
for (const item of cases) {
  console.log(`${item.ok ? 'ok  ' : 'FAIL'}  ${item.name}${item.ok ? '' : `  → ${JSON.stringify(item.actual)}`}`)
  if (!item.ok) failed += 1
}
if (failed) {
  console.error(`\n${failed} / ${cases.length} 项失败`)
  process.exitCode = 1
} else {
  console.log(`\n全部 ${cases.length} 项通过`)
}
