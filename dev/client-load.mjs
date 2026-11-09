/**
 * client.js 的无浏览器加载测试。
 *
 * 不需要 React：用最小桩验证
 *   1) 模块能被 __ModuleLoader__ 读取（没有顶层语法/引用错误）；
 *   2) apply() 注册了 main 面板与 sidebar.panellist 图标，id 一致；
 *   3) 侧栏图标的 order / locale / label 符合预期。
 * 真正的视觉与交互无法在这里验证。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const dummyReact = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  createContext: (value) => ({ __context: value }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useContext: () => null,
  useRef: () => ({ current: null }),
}

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry
    },
  },
}

await import(pathToFileURL(path.resolve('client.js')).href)

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  console.log(`PASS  ${message}`)
}

assert(captured !== null, '模块调用了 window.__ModuleLoader__.load')
assert(captured.id === 'dsh-oi-knowledge', '模块 id 与包名一致')

const mod = captured.factory((id) => {
  if (id === 'react') return dummyReact
  throw new Error(`意外的 require('${id}')`)
})

assert(mod.inject && mod.inject.includes('slots'), 'inject 声明了 slots')
assert(typeof mod.apply === 'function', '导出 apply()')

const registrations = []
const ctx = {
  slots: {
    inject(_key, factory) {
      return factory()
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return () => {}
    },
  },
}
mod.apply(ctx)

const main = registrations.find((entry) => entry.spec.name === 'main')
const icon = registrations.find((entry) => entry.spec.name === 'sidebar.panellist')

assert(main && main.spec.key === 'oi-knowledge', '注册了 key=oi-knowledge 的 main 面板')
assert(icon && icon.spec.id === 'oi-knowledge', '侧栏注册 id 与面板 key 一致')
assert(icon.spec.order === 32, '侧栏 order 固定为 32')
assert(icon.spec.locale === 'oi-knowledge' && typeof icon.spec.label === 'function', '侧栏有 locale 与 label 函数')
assert(icon.spec.label() === 'OI 知识点', '侧栏标题为「OI 知识点」')
assert(typeof main.component === 'function' && typeof icon.component === 'function', '两个注册都带组件函数')

// 图标是纯函数组件，可以直接展开成元素树检查。
const iconTree = icon.component({ size: 20 })
assert(iconTree && iconTree.type === 'svg', 'SidebarIcon 渲染 svg')

console.log('\nALL PASS  (client.js 可加载，panel/icon 注册形状正确；视觉未验证)')
