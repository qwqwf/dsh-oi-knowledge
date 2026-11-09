// 路由自测：不启动 Web 宿主，用桩 ctx 拿到 /plugins/dsh-oi-knowledge/api 的 route，
// 再用假 req/res 验证鉴权、state 返回与 gzip 分支。
import zlib from 'node:zlib'
import { apply } from '../index.js'

const routes = []
let rejection = undefined
const ctx = {
  effect(fn) {
    fn()
    return () => {}
  },
  inject(names, callback) {
    if (names.includes('connection')) {
      callback({ connection: { requestRejection: () => rejection } })
      return
    }
    if (names.includes('webServer')) {
      callback({
        effect(fn) {
          fn()
          return () => {}
        },
        webServer: {
          register(route) {
            routes.push(route)
            return () => {}
          },
        },
      })
    }
  },
  tools: {
    register() {
      return () => {}
    },
  },
}

apply(ctx, {})

const route = routes.find((item) => item.path === '/plugins/dsh-oi-knowledge/api')
if (!route) throw new Error('没有注册 api 路由')
if (route.kind !== 'prefix') throw new Error(`路由 kind 应为 prefix，实际 ${route.kind}`)

function fakeRequest(url, headers) {
  return { method: 'GET', url, headers }
}

function postRequest(url, payload) {
  const chunks = Buffer.from(JSON.stringify(payload), 'utf8')
  const handlers = new Map()
  const req = {
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', 'content-length': String(chunks.length) },
    on(event, callback) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(callback)
      return req
    },
    destroy() {},
  }
  setTimeout(() => {
    for (const callback of handlers.get('data') || []) callback(chunks)
    for (const callback of handlers.get('end') || []) callback()
  }, 0)
  return req
}

function run(handler, req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const res = {
      writeHead(status, headers) {
        res.status = status
        res.headers = headers
      },
      end(body) {
        if (body) chunks.push(Buffer.from(body))
        resolve({ status: res.status, headers: res.headers, body: Buffer.concat(chunks) })
      },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

const results = []
function check(name, fn) {
  try {
    fn()
    results.push(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name} — ${error.message}`)
    process.exitCode = 1
  }
}

const plain = await run(route.handler, fakeRequest('/plugins/dsh-oi-knowledge/api/state', {}))
check('identity 返回 200', () => {
  if (plain.status !== 200) throw new Error(`status ${plain.status}`)
})
check('identity 是 JSON', () => {
  const parsed = JSON.parse(plain.body.toString('utf8'))
  if (!Array.isArray(parsed.problems) || !Array.isArray(parsed.nodes)) throw new Error('state 形状不对')
})

const gz = await run(route.handler, fakeRequest('/plugins/dsh-oi-knowledge/api/state', { 'accept-encoding': 'gzip, deflate' }))
check('gzip 分支带 content-encoding', () => {
  if (gz.headers['content-encoding'] !== 'gzip') throw new Error('没有 gzip')
})
check('gzip 能解回同一份 JSON', () => {
  const unzipped = zlib.gunzipSync(gz.body)
  const parsed = JSON.parse(unzipped.toString('utf8'))
  if (parsed.revision === undefined) throw new Error('解压后数据不对')
  if (String(gz.headers['content-length']) !== String(gz.body.length)) {
    throw new Error(`content-length=${gz.headers['content-length']} 实际=${gz.body.length}`)
  }
})
check('gzip 比明文小', () => {
  if (!(gz.body.length < plain.body.length)) throw new Error('压缩后反而更大')
})

const missing = await run(route.handler, fakeRequest('/plugins/dsh-oi-knowledge/api/nope', {}))
check('未知路径 404', () => {
  if (missing.status !== 404) throw new Error(`status ${missing.status}`)
})

const badProblem = await run(route.handler, fakeRequest('/plugins/dsh-oi-knowledge/api/problem?id=__nope__', {}))
check('未知题目返回 400 JSON', () => {
  if (badProblem.status !== 400) throw new Error(`status ${badProblem.status}`)
  const parsed = JSON.parse(badProblem.body.toString('utf8'))
  if (typeof parsed.error !== 'string' || parsed.error.length < 4) throw new Error(`错误形状不对：${parsed.error}`)
})

const call = await run(route.handler, postRequest('/plugins/dsh-oi-knowledge/api/call', { op: 'status', args: {} }))
check('POST call 返回摘要', () => {
  if (call.status !== 200) throw new Error(`status ${call.status}`)
  const parsed = JSON.parse(call.body.toString('utf8'))
  if (parsed.ok !== true) throw new Error('ok 不为 true')
  if (typeof parsed.result?.summary !== 'string' || !parsed.result.summary.includes('节点')) {
    throw new Error('result.summary 不对')
  }
})

const badOp = await run(route.handler, postRequest('/plugins/dsh-oi-knowledge/api/call', { op: '__nope__', args: {} }))
check('未知操作返回 400', () => {
  if (badOp.status !== 400) throw new Error(`status ${badOp.status}`)
})

rejection = 401
const denied = await run(route.handler, fakeRequest('/plugins/dsh-oi-knowledge/api/state', {}))
check('鉴权失败返回 401', () => {
  if (denied.status !== 401) throw new Error(`status ${denied.status}`)
  const parsed = JSON.parse(denied.body.toString('utf8'))
  if (parsed.error !== 'unauthorized') throw new Error(`error=${parsed.error}`)
})

for (const line of results) console.log(line)
console.log(results.every((line) => line.startsWith('PASS')) ? '\nALL PASS' : '\nSOME FAILED')
