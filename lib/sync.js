/**
 * 账号同步：Codeforces / AtCoder / 洛谷。
 *
 * 三个平台都没有「官方授权」这回事，全是公开接口：
 *  - CF     user.status（全部提交，过滤 OK），problemset.problems 拿 rating/tags
 *  - AtCoder kenkoooo 的非官方 API（提交记录 + 难度表），没有 tag
 *  - 洛谷   记录页的 _contentOnly 接口，反爬严，且通常需要登录 Cookie
 *
 * 所有函数只负责「拿数据」，落库与合并交给 service。
 */

const UA = 'dsh-oi-knowledge/1.0 (DeepSeek Harness plugin; local use)'
const DEFAULT_TIMEOUT = 30000

export class SyncError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SyncError'
  }
}

async function getJson(url, options = {}) {
  const timeout = options.timeoutMs || DEFAULT_TIMEOUT
  let response
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(timeout),
    })
  } catch (error) {
    throw new SyncError(`请求 ${new URL(url).host} 失败：${error?.message || error}`)
  }
  const text = await response.text()
  if (!response.ok) {
    if (response.status === 403) throw new SyncError(`${new URL(url).host} 返回 403（被反爬拦了，洛谷一般要 Cookie）`)
    if (response.status === 429) throw new SyncError(`${new URL(url).host} 限流了（429），过几分钟再同步`)
    throw new SyncError(`${new URL(url).host} 返回 HTTP ${response.status}`)
  }
  try {
    return JSON.parse(text)
  } catch (_) {
    throw new SyncError(`${new URL(url).host} 返回的不是 JSON（大概率被反爬页面替换了）`)
  }
}

/**
 * Codeforces：按题目去重，返回两类
 *  - solved：至少有一次 OK 的题
 *  - attempted：提交过多次但从未 OK 的题（这是「不会」的强证据）
 */
export async function fetchCodeforcesActivity(handle) {
  const name = String(handle || '').trim()
  if (name === '') throw new SyncError('Codeforces 账号不能为空')
  const solved = new Map()
  const touched = new Map()
  let from = 1
  for (let page = 0; page < 8; page += 1) {
    const data = await getJson(
      `https://codeforces.com/api/user.status?handle=${encodeURIComponent(name)}&from=${from}&count=10000`,
      { timeoutMs: 45000 },
    )
    if (data.status !== 'OK') {
      const comment = String(data.comment || '')
      if (/not found|does not exist/i.test(comment)) throw new SyncError(`Codeforces 上找不到用户「${name}」`)
      throw new SyncError(`Codeforces 返回失败：${comment || 'unknown'}`)
    }
    const submissions = data.result || []
    for (const submission of submissions) {
      const problem = submission.problem || {}
      if (problem.contestId == null || !problem.index) continue
      const key = `${problem.contestId}${problem.index}`
      const time = submission.creationTimeSeconds || 0
      const meta = touched.get(key) || {
        key,
        title: problem.name || key,
        url: `https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`,
        rating: problem.rating ?? null,
        tags: problem.tags || [],
        lastSubmitAt: 0,
        submissions: 0,
        wrongSubmissions: 0,
      }
      meta.lastSubmitAt = Math.max(meta.lastSubmitAt, time)
      meta.submissions += 1
      if (submission.verdict !== 'OK') meta.wrongSubmissions += 1
      touched.set(key, meta)
      if (submission.verdict === 'OK' && !solved.has(key)) {
        solved.set(key, {
          key,
          title: meta.title,
          url: meta.url,
          rating: meta.rating,
          tags: meta.tags,
          solvedAt: time ? new Date(time * 1000).toISOString() : '',
        })
      }
    }
    if (submissions.length < 10000) break
    from += 10000
  }
  const attempted = [...touched.values()]
    .filter((meta) => !solved.has(meta.key))
    .map((meta) => ({
      key: meta.key,
      title: meta.title,
      url: meta.url,
      rating: meta.rating,
      tags: meta.tags,
      attemptedAt: meta.lastSubmitAt ? new Date(meta.lastSubmitAt * 1000).toISOString() : '',
      submissions: meta.submissions,
      wrongSubmissions: meta.wrongSubmissions,
    }))
  return { solved: [...solved.values()], attempted }
}

/** 兼容旧调用：只要 AC 列表。 */
export async function fetchCodeforcesSolved(handle) {
  const { solved } = await fetchCodeforcesActivity(handle)
  return solved
}

/** 当前 Codeforces rating（用于「比现有水平高 200–400 分」的抽题窗口）。 */
export async function fetchCodeforcesRating(handle) {
  const name = String(handle || '').trim()
  if (name === '') throw new SyncError('Codeforces 账号不能为空')
  const data = await getJson(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(name)}`)
  const row = Array.isArray(data.result) ? data.result[0] : null
  const rating = row && Number.isFinite(row.rating) ? row.rating : null
  if (rating == null) throw new SyncError(`Codeforces 没有拿到 ${name} 的 rating（可能还没打过 rated 比赛）`)
  return { rating, handle: row.handle || name, maxRating: Number.isFinite(row.maxRating) ? row.maxRating : null }
}

/** 当前 AtCoder rating：用户提交历史 JSON 的最后一条 NewRating。 */
export async function fetchAtCoderRating(handle) {
  const name = String(handle || '').trim()
  if (name === '') throw new SyncError('AtCoder 账号不能为空')
  const history = await getJson(`https://atcoder.jp/users/${encodeURIComponent(name)}/history/json`)
  if (!Array.isArray(history) || !history.length) {
    throw new SyncError(`AtCoder 没有拿到 ${name} 的比赛历史`)
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const row = history[index]
    // 只认 rated 且有正 rating 的记录；否则未 rated 的 0 分会把窗口压成 800–400。
    if (row && row.IsRated === false) continue
    const rating = Number(row && row.NewRating)
    if (Number.isFinite(rating) && rating > 0) {
      return { rating, handle: name, contest: row.ContestScreenName || '', at: row.EndTime || '' }
    }
  }
  throw new SyncError(`AtCoder 比赛历史里没有 ${name} 的 rated rating`)
}

/** AtCoder：kenkoooo 提交 API，AC 去重；难度尽力从 problem-models 补。 */
export async function fetchAtCoderSolved(handle, options = {}) {
  const name = String(handle || '').trim()
  if (name === '') throw new SyncError('AtCoder 账号不能为空')
  const items = new Map()
  let from = 0
  for (let page = 0; page < 60; page += 1) {
    const rows = await getJson(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(name)}&from_second=${from}`,
      { timeoutMs: 30000 },
    )
    if (!Array.isArray(rows)) throw new SyncError('AtCoder 提交接口返回格式异常')
    if (rows.length === 0) break
    for (const row of rows) {
      if (row.result !== 'AC') continue
      const key = String(row.problem_id || '')
      if (key === '' || items.has(key)) continue
      items.set(key, {
        key,
        title: options.titleOf?.(key) || key,
        url: row.contest_id ? `https://atcoder.jp/contests/${row.contest_id}/tasks/${key}` : `https://atcoder.jp/tasks/${key}`,
        rating: null,
        tags: [],
        solvedAt: row.epoch_second ? new Date(row.epoch_second * 1000).toISOString() : '',
      })
    }
    const last = Number(rows[rows.length - 1].epoch_second || 0)
    if (rows.length < 500 || last + 1 <= from) break
    from = last + 1
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return [...items.values()]
}

/** AtCoder 资源表（题目名 / 难度），单独缓存，失败不影响主流程。 */
export async function loadAtCoderResources(store, options = {}) {
  const WEEK = 7 * 24 * 3600 * 1000
  const cached = options.force ? null : store.readCache('atcoder-resources.json', WEEK)
  if (cached && cached.problems) return cached
  const titles = await getJson('https://kenkoooo.com/atcoder/resources/problems.json', { timeoutMs: 45000 })
  const difficulties = {}
  try {
    const models = await getJson('https://kenkoooo.com/atcoder/resources/problem-models.json', { timeoutMs: 60000 })
    for (const [id, model] of Object.entries(models || {})) {
      const value = Number(model?.difficulty)
      if (Number.isFinite(value) && value > 0) difficulties[id] = Math.round(value / 100) * 100
    }
  } catch (_) {
    /* 难度拿不到就先空着，rating 留 null */
  }
  const problems = {}
  for (const problem of Array.isArray(titles) ? titles : []) {
    if (!problem?.id) continue
    problems[problem.id] = {
      title: problem.title || problem.id,
      // 抽新题时要拼题面 URL，必须知道比赛 id（不能靠 key 前缀猜，如 nikkei2019_qual_a）
      contest: problem.contest_id || '',
      difficulty: difficulties[problem.id] ?? null,
    }
  }
  const payload = { fetchedAt: new Date().toISOString(), problems }
  store.writeCache('atcoder-resources.json', payload)
  return payload
}

export function applyAtCoderResources(items, resources) {
  const problems = resources?.problems || {}
  for (const item of items) {
    const meta = problems[item.key]
    if (!meta) continue
    if (meta.title) item.title = meta.title
    if (meta.difficulty != null) item.rating = meta.difficulty
  }
  return items
}

const ATCODER_WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

// Host 侧的翻译 / 网页抓取能力（由 index.js 注入；没有时退回本机直连与 MyMemory）。
let hostTranslate = null
let hostTranslateProbe = null
let hostWebFetch = null
// 最近一次工具调用所属的会话；某些翻译 provider（deepseek-*）需要 sessionId。
let translateSession = null

export function setHostTranslate(fn) {
  hostTranslate = typeof fn === 'function' ? fn : null
}

export function setHostTranslateProbe(fn) {
  hostTranslateProbe = typeof fn === 'function' ? fn : null
}

export function setTranslateSession(sessionId) {
  translateSession = sessionId ? String(sessionId) : null
}

export function setHostWebFetch(fn) {
  hostWebFetch = typeof fn === 'function' ? fn : null
}

// Host 侧模型生成能力（用于给新抽的题写精髓与洞察）；由 index.js 注入。
let hostGenerate = null

export function setHostGenerate(fn) {
  hostGenerate = typeof fn === 'function' ? fn : null
}

export function hasGenerator() {
  return Boolean(hostGenerate)
}

export async function generateModel(prompt, options = {}) {
  if (!hostGenerate) return ''
  try {
    return String((await hostGenerate(String(prompt || ''), options)) || '').trim()
  } catch (_) {
    return ''
  }
}

export async function probeTranslate(text) {
  if (!hostTranslateProbe) return [{ provider: '(none)', ok: false, note: '宿主没有 translator 服务' }]
  try {
    return await hostTranslateProbe(text)
  } catch (error) {
    return [{ provider: '(error)', ok: false, note: String(error?.message || error) }]
  }
}

/** 有没有可用的翻译通道（面板判断是否需要提示）。 */
export function hasTranslator() {
  return Boolean(hostTranslate)
}

function looksBlocked(html) {
  return /Just a moment|Checking your browser|Attention Required|cf-browser-verification|challenge-platform/i.test(String(html).slice(0, 4000))
}

/** 把英文题面拆成 ≤450 字的段，逐段走 MyMemory（没有 Host 翻译时的兜底）。 */
async function translateWithMyMemory(text) {
  const source = String(text || '').replace(/[ \t]+/g, ' ').trim()
  if (!source) return ''
  const parts = []
  let rest = source
  while (rest.length && parts.length < 12) {
    let cut = Math.min(450, rest.length)
    const boundary = rest.slice(0, cut).search(/[.!?]\s(?=[A-Z])/g)
    if (boundary > 80) cut = boundary + 1
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  const out = []
  for (const part of parts) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(part)}&langpair=en%7Czh-CN`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) continue
      const data = await response.json()
      const translated = data?.responseData?.translatedText
      if (translated) out.push(String(translated).replace(/&#39;/g, "'").replace(/&quot;/g, '"'))
    } catch (_) {
      /* 单段失败就跳过 */
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return out.join(' ').trim()
}

/** 英文 → 中文；优先 Host 的翻译服务，失败再退 MyMemory。 */
export async function translateToChinese(text, options = {}) {
  const source = String(text || '').trim()
  if (!source) return ''
  if (hostTranslate) {
    try {
      const chunks = []
      let rest = source.slice(0, 6000)
      while (rest.length) {
        let cut = Math.min(1800, rest.length)
        const boundary = rest.slice(0, cut).search(/[.!?]\s(?=[A-Z])/g)
        if (boundary > 300) cut = boundary + 1
        chunks.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      const parts = []
      for (const chunk of chunks) parts.push(await hostTranslate(chunk, { sessionId: translateSession, ...options }))
      const joined = parts.join(' ').trim()
      if (joined && /[\u4e00-\u9fff]/.test(joined)) return joined
      // 整段偶尔失败：用更小的片段再试一次，避免翻译服务对长文本报错时全军覆没。
      const small = source.slice(0, 700)
      const single = String((await hostTranslate(small, { sessionId: translateSession, ...options })) || '').trim()
      if (single && /[\u4e00-\u9fff]/.test(single)) return single
    } catch (_) {
      /* 走兜底 */
    }
  }
  return translateWithMyMemory(source)
}

async function getHtml(url, options = {}) {
  const timeout = options.timeoutMs || 20000
  let lastError = null
  for (let attempt = 0; attempt < (options.attempts || 2); attempt += 1) {
    let response
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': ATCODER_WEB_UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8',
        },
        signal: AbortSignal.timeout(timeout),
      })
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 900))
      continue
    }
    if (!response.ok) {
      lastError = new SyncError(`${new URL(url).host} 返回 HTTP ${response.status}`)
      break
    }
    const text = await response.text()
    if (looksBlocked(text)) {
      lastError = new Error('blocked by anti-bot challenge')
      break
    }
    return text
  }
  if (hostWebFetch) {
    if (/codeforces\.com/i.test(url)) {
      try {
        const mirrored = await hostWebFetch(url.replace('https://codeforces.com/', 'https://mirror.codeforces.com/'))
        if (mirrored?.body?.content) return mirrored.body.content
      } catch (_) {
        /* 镜像不通就试原站 */
      }
    }
    try {
      const fetched = await hostWebFetch(url)
      if (fetched?.body?.content) return fetched.body.content
    } catch (_) {
      /* 继续抛下面的错误 */
    }
  }
  throw new SyncError(`抓取 ${new URL(url).host} 失败：${lastError?.message || lastError}`)
}


function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&(nbsp|ensp|emsp|thinsp);/g, ' ')
    .replace(/&(le|leq);/g, '≤')
    .replace(/&(ge|geq);/g, '≥')
    .replace(/&(ne|neq);/g, '≠')
    .replace(/&times;/g, '×')
    .replace(/&divide;/g, '÷')
    .replace(/&plusmn;/g, '±')
    .replace(/&infin;/g, '∞')
    .replace(/&sum;/g, '∑')
    .replace(/&prod;/g, '∏')
    .replace(/&radic;/g, '√')
    .replace(/&rarr;/g, '→')
    .replace(/&larr;/g, '←')
    .replace(/&harr;/g, '↔')
    .replace(/&rArr;/g, '⇒')
    .replace(/&isin;/g, '∈')
    .replace(/&sube;/g, '⊆')
    .replace(/&middot;/g, '·')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * 抽一道 AtCoder 新题时用：抓题面（优先英文）与官方题解正文。
 * 题解可能只有整场 PDF（返回空字符串），这时就只剩题面可用。
 */
export async function fetchAtCoderTaskBundle(item) {
  const contest = item.contest || String(item.key || '').replace(/_[^_]+$/, '')
  const base = `https://atcoder.jp/contests/${contest}/tasks/${item.key}`
  const result = { statement: '', editorial: '', contest }
  try {
    const page = await getHtml(`${base}?lang=en`)
    const marker = page.indexOf('id="task-statement"')
    const start = marker >= 0 ? page.indexOf('>', marker) + 1 : -1
    if (start > 0) {
      const rest = page.slice(start)
      const end = rest.search(/<(?:h2|div)[^>]*id="task-(?:constraints|input|output)/i)
      let section = end > 0 ? rest.slice(0, end) : rest.slice(0, 12000)
      // 题面页同时放日文与英文两份，优先英文块。
      const english = section.indexOf('class="lang-en"')
      if (english >= 0) {
        const open = section.indexOf('>', english)
        section = section.slice(open >= 0 ? open + 1 : english)
      }
      result.statement = htmlToText(section).slice(0, 4000)
    }
  } catch (_) {
    /* 题面抓不到就留空，面板会提示 */
  }
  try {
    const listPage = await getHtml(`${base}/editorial?lang=en`)
    const links = []
    const linkRe = /href="(\/contests\/[a-z0-9_]+\/editorial\/\d+)"[^>]*>([^<]*)</gi
    let linkMatch = linkRe.exec(listPage)
    while (linkMatch) {
      links.push({ href: linkMatch[1], label: linkMatch[2].trim() })
      linkMatch = linkRe.exec(listPage)
    }
    // 同一题可能有多篇题解；优先英文版（链接文字是 Editorial 而不是 解説）。
    links.sort((a, b) => (/(editorial)/i.test(b.label) ? 1 : 0) - (/(editorial)/i.test(a.label) ? 1 : 0))
    for (const link of links.slice(0, 3)) {
      const editorialPage = await getHtml(`https://atcoder.jp${link.href}?lang=en`)
      if (/Task not found|404 Page Not Found/i.test(editorialPage)) continue
      const marker = editorialPage.indexOf('id="main-container"')
      const section = editorialPage.slice(marker >= 0 ? editorialPage.indexOf('>', marker) + 1 : 0)
      // 题解正文在「B - … Editorial」标题后的第一条分隔线下；导航栏里也有 lang-en，不能直接取。
      const divider = section.indexOf('<hr class="mt-1">')
      let candidates = []
      if (divider >= 0) {
        const body = htmlToText(section.slice(divider + 17, divider + 16000))
          .split(/\n(?:Terms of Use|Privacy Policy|Back to Home|日本語)/)[0]
          .trim()
        if (body.length >= 200) candidates.push({ lang: 'en', text: body })
      }
      if (!candidates.length) {
        const langRe = /class="lang-(en|ja)"/g
        let langMatch = langRe.exec(section)
        while (langMatch) {
          const open = section.indexOf('>', langMatch.index)
          const text = open >= 0 ? htmlToText(section.slice(open + 1, open + 24000)) : ''
          if (text) candidates.push({ lang: langMatch[1], text })
          langMatch = langRe.exec(section)
        }
        candidates.sort((a, b) => (a.lang === 'en' ? -1 : 1) - (b.lang === 'en' ? -1 : 1) || b.text.length - a.text.length)
      }
      const text = (candidates[0]?.text || htmlToText(section)).slice(0, 6000)
      if (text.length >= 200) {
        result.editorial = text
        break
      }
    }
  } catch (_) {
    /* 题解抓不到就留空 */
  }
  return result
}

/** 抓一道 Codeforces 新题的题面（借助 Host 的网页抓取能力绕开站内反爬）。 */
export async function fetchCodeforcesTaskBundle(problem) {
  const url = `https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`
  const result = { statement: '', editorial: '', url }
  try {
    const page = await getHtml(url, { timeoutMs: 25000 })
    const marker = page.indexOf('class="problem-statement"')
    let text = ''
    if (marker >= 0) {
      const start = page.indexOf('>', marker) + 1
      text = htmlToText(page.slice(start, start + 30000)).slice(0, 4500)
    } else {
      // Host 的 web.fetch 可能已经把 HTML 转成纯文本，此时没有 class 标记：按 “standard output” 到 “Examples/Note” 切。
      const startMatch = /standard\s+output/i.exec(page)
      let body = startMatch ? page.slice(startMatch.index + startMatch[0].length) : page
      const endMatch = /\n(?:Examples?|Note)\s*\n/i.exec(body)
      if (endMatch) body = body.slice(0, endMatch.index)
      text = htmlToText(body).replace(/\s+\n/g, '\n').trim().slice(0, 4500)
    }
    // CF 用 $$$…$$$ 表示行内公式、$$$$…$$$$ 表示块级公式；只归一这两种。
    // 不能把普通 $$…$$ 也降级成 $…$，否则块级公式语义会丢。
    text = text
      .replace(/\$\$\$([^$]+?)\$\$\$/g, (_, body) => `$${body}$`)
      .replace(/\$\$\$\$/g, '$$')
    // 去掉题面抬头（标题、时间/内存限制、input/output 说明），只留任务描述。
    const lines = text.split('\n')
    const boiler =
      /^(?:[A-Z][.．]\s*.*|每个测试(?:点)?的?时间限制.*|时间限制.*|内存限制.*|standard\s+(?:input|output)|input|output|输入|输出|标准输入|标准输出)\s*$/i
    let begin = 0
    while (begin < lines.length && begin < 10 && (lines[begin].trim() === '' || boiler.test(lines[begin].trim()))) begin += 1
    text = lines.slice(begin).join('\n').trim()
    if (text.length >= 60) result.statement = text
  } catch (_) {
    /* 抓不到就留空，面板会用标题+链接 */
  }
  return result
}

const LUOGU_DIFFICULTY = { 0: 800, 1: 1100, 2: 1400, 3: 1700, 4: 2000, 5: 2300, 6: 2700 }
const LUOGU_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/** 从响应里取出 C3VK 挑战 cookie（洛谷的反爬握手）。 */
function c3vkOf(response) {
  let list = []
  try {
    list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  } catch (_) {
    list = []
  }
  if (!list.length) {
    const raw = response.headers.get('set-cookie') || ''
    if (raw) list = raw.split(/,(?=[^;]+=)/)
  }
  const hit = list.find((item) => String(item).startsWith('C3VK='))
  return hit ? String(hit).split(';')[0] : ''
}

/** 从洛谷页面内嵌的 lentille-context 里取记录表。 */
function parseLuoguList(html) {
  const match = String(html).match(/<script[^>]*id="lentille-context"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return null
  try {
    const context = JSON.parse(match[1])
    const records = context?.data?.records
    if (records && Array.isArray(records.result)) return records
    const fallback = context?.currentData?.records
    if (fallback && Array.isArray(fallback.result)) return fallback
  } catch (_) {
    return null
  }
  return null
}

/** 洛谷站内镜像题号（CF1234A / AT_abc345_a）→ 原平台题号。 */
function mirrorTarget(pid) {
  const cf = /^CF(\d+)([A-Z][0-9]?)$/i.exec(pid)
  if (cf) {
    const index = cf[2].toUpperCase()
    return { platform: 'codeforces', key: `${cf[1]}${index}`, url: `https://codeforces.com/problemset/problem/${cf[1]}/${index}` }
  }
  const at = /^AT_([a-z0-9_]+)$/i.exec(pid)
  if (at) {
    const key = at[1].toLowerCase()
    const contest = key.slice(0, key.lastIndexOf('_'))
    return { platform: 'atcoder', key, url: `https://atcoder.jp/contests/${contest}/tasks/${key}` }
  }
  return null
}

/**
 * 洛谷：记录页接口，AC 去重。支持数字 UID / 用户名 / 用户主页链接。
 * 洛谷现在用 C3VK 握手 + 页面内嵌 JSON，这条路径比「接口直接吐 JSON」更稳。
 */
export async function fetchLuoguSolved(handle, options = {}) {
  let uid = String(options.uid || handle || '').trim()
  const matched = uid.match(/\/user\/(\d+)/)
  if (matched) uid = matched[1]
  const baseCookie = String(options.cookie || '')
  if (!/^\d+$/.test(uid)) {
    // 用户名 → UID：站内搜索接口，无需登录
    try {
      const search = await getJson(`https://www.luogu.com.cn/api/user/search?keyword=${encodeURIComponent(uid)}`, {
        headers: baseCookie ? { Cookie: baseCookie } : {},
        timeoutMs: 20000,
      })
      const users = Array.isArray(search?.users) ? search.users : []
      const exact = users.find((user) => String(user.name || '').toLowerCase() === uid.toLowerCase()) || users[0]
      if (!exact || !exact.uid) throw new Error('no such user')
      uid = String(exact.uid)
    } catch (_) {
      throw new SyncError(`洛谷用户名「${uid}」解析失败（搜索接口被反爬挡了）：请把账号改成数字 UID，或用户主页链接`)
    }
  }

  let cookie = baseCookie
  const requestPage = async (page) => {
    const url = `https://www.luogu.com.cn/record/list?user=${uid}&status=12&page=${page}&_contentOnly=1`
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
      headers: {
        'user-agent': LUOGU_UA,
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9',
        referer: `https://www.luogu.com.cn/record/list?user=${uid}`,
        'x-luogu-type': 'content-only',
        ...(cookie ? { cookie } : {}),
      },
    })
    const next = c3vkOf(response)
    if (next) cookie = cookie ? `${baseCookie}; ${next}` : next
    if (response.status === 302) return { retry: true, records: null }
    if (response.status !== 200) throw new SyncError(`洛谷返回 HTTP ${response.status}（可能需要更新 Cookie）`)
    const body = await response.text()
    // 老接口会直接给 JSON；新接口是页面 + 内嵌 lentille-context，两种都认
    if (body.trimStart().startsWith('{')) {
      try {
        const data = JSON.parse(body)
        const records = data?.currentData?.records || data?.records
        if (records && Array.isArray(records.result)) return { retry: false, records }
      } catch (_) {
        /* 落到 HTML 解析 */
      }
    }
    const records = parseLuoguList(body)
    if (records) return { retry: false, records }
    if (/登录|login/i.test(body.slice(0, 4000)) && body.length < 4000) {
      throw new SyncError('洛谷要求登录：请在账号里填入 __client_id 与 _uid 的 Cookie')
    }
    throw new SyncError('洛谷页面结构变了，解析不到记录列表（接口改版时会出现）')
  }

  let first = await requestPage(1)
  if (first.retry) first = await requestPage(1)
  if (!first.records) throw new SyncError('洛谷没有返回记录列表，Cookie 可能已失效')

  const perPage = first.records.perPage || 20
  const total = first.records.count ?? first.records.result.length
  const pages = Math.max(1, Math.ceil(total / perPage))
  const buckets = [first.records.result]
  const pageNumbers = []
  for (let page = 2; page <= pages; page += 1) pageNumbers.push(page)

  // 并发 4，避免把洛谷惹毛
  const queue = [...pageNumbers]
  const worker = async () => {
    while (queue.length) {
      const page = queue.shift()
      try {
        let result = await requestPage(page)
        if (result.retry) result = await requestPage(page)
        if (result.records?.result?.length) buckets.push(result.records.result)
      } catch (_) {
        /* 单页失败先跳过，最后按拿到的记录算 */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pageNumbers.length) }, worker))

  const items = new Map()
  for (const records of buckets) {
    for (const record of records) {
      const problem = record.problem || {}
      const pid = problem.pid || record.pid
      if (!pid) continue
      if (record.status != null && Number(record.status) !== 12) continue
      // 洛谷站内有一批 CF / AtCoder 镜像题：认出来就归到原平台，便于去重与借标签
      const mirror = mirrorTarget(pid)
      const key = mirror ? mirror.key : pid
      const uid = `${mirror ? mirror.platform : 'luogu'}:${key}`
      if (items.has(uid)) continue
      const difficulty = problem.difficulty
      items.set(uid, {
        key,
        platform: mirror ? mirror.platform : 'luogu',
        title: problem.name || problem.title || key,
        url: mirror ? mirror.url : `https://www.luogu.com.cn/problem/${pid}`,
        rating: Number.isFinite(difficulty) ? LUOGU_DIFFICULTY[difficulty] ?? null : null,
        tags: [],
        solvedAt: record.submitTime ? new Date(record.submitTime * 1000).toISOString() : '',
      })
    }
  }
  if (items.size === 0) throw new SyncError('洛谷没解析到任何 AC 记录：通常是需要登录 Cookie，或接口被反爬替换')
  return [...items.values()]
}

/** Codeforces 题库缓存（7 天），用于推荐练习。 */
export async function loadCodeforcesProblemset(store, options = {}) {
  const WEEK = 7 * 24 * 3600 * 1000
  if (!options.force) {
    const cached = store.readCache('cf-problemset.json', WEEK)
    if (cached && Array.isArray(cached.problems)) return cached
  }
  const data = await getJson('https://codeforces.com/api/problemset.problems', { timeoutMs: 60000 })
  if (data.status !== 'OK') throw new SyncError(`Codeforces 题库拉取失败：${data.comment || 'unknown'}`)
  const problems = []
  for (const problem of data.result?.problems || []) {
    if (problem.type === 'special') continue
    if (problem.rating == null) continue
    problems.push({
      contestId: problem.contestId,
      index: problem.index,
      name: problem.name,
      rating: problem.rating,
      tags: problem.tags || [],
    })
  }
  const payload = { fetchedAt: new Date().toISOString(), problems }
  store.writeCache('cf-problemset.json', payload)
  return payload
}
