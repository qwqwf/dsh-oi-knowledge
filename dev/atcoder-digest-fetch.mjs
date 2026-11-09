/**
 * AtCoder 题解摄入：把"已通过但还没写过精髓"的题抓成「题面 + 官方题解」纯文本，
 * 放进 dev/digest/inbox/，交给模型提炼 essence / 洞察。
 *
 * 用法：
 *   node dev/atcoder-digest-fetch.mjs --stats
 *   node dev/atcoder-digest-fetch.mjs --min 2800 --limit 28
 *   node dev/atcoder-digest-fetch.mjs --tasks abc300_f,agc070_a --refetch
 *
 * 只写 dev/digest/ 下的文件，不碰 kb.json（知识库写入一律走插件工具或 digest-apply）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIGEST_DIR = path.join(ROOT, 'dev', 'digest')
const INBOX_DIR = path.join(DIGEST_DIR, 'inbox')
const KB_FILE = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const RESOURCE_CACHE = path.join(DIGEST_DIR, 'atcoder-resources.json')
const WEEK = 7 * 24 * 3600 * 1000
const UA = 'dsh-oi-knowledge/1.0 (DeepSeek Harness plugin; local use)'

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const next = process.argv[index + 1]
  return next && !next.startsWith('--') ? next : true
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

async function getText(url, timeoutMs = 30000) {
  let lastError = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en,ja;q=0.8' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (response.status === 429) throw new Error('429')
      if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}：${url}`)
      return response.text()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function getJson(url, timeoutMs = 60000) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}`)
  return response.json()
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
}

/** 粗糙但够用的 HTML 转文本：保留 \( \) 与 $...$ 里的公式。 */
export function htmlToText(html) {
  let text = String(html || '')
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div|li|tr|h[1-6]|pre|summary|details)>/gi, '\n')
  text = text.replace(/<li[^>]*>/gi, '- ')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  text = text.replace(/\r/g, '')
  text = text.replace(/[ \t\u00a0]+/g, ' ')
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

async function loadResources(force = false) {
  ensureDir(DIGEST_DIR)
  if (!force && fs.existsSync(RESOURCE_CACHE)) {
    const cached = JSON.parse(fs.readFileSync(RESOURCE_CACHE, 'utf8'))
    if (Date.now() - Date.parse(cached.fetchedAt || 0) < WEEK) return cached
  }
  console.log('拉取 kenkoooo 题库与难度表...')
  const problems = await getJson('https://kenkoooo.com/atcoder/resources/problems.json')
  const models = await getJson('https://kenkoooo.com/atcoder/resources/problem-models.json')
  const payload = {
    fetchedAt: new Date().toISOString(),
    problems: problems.map((item) => ({
      id: item.id,
      contest: item.contest_id,
      title: item.title,
      difficulty: Number.isFinite(Number(models[item.id]?.difficulty))
        ? Math.round(Number(models[item.id].difficulty) / 100) * 100
        : null,
    })),
  }
  fs.writeFileSync(RESOURCE_CACHE, JSON.stringify(payload), 'utf8')
  return payload
}

function loadKb() {
  return JSON.parse(fs.readFileSync(KB_FILE, 'utf8'))
}

/** 已通过且还没写精髓的 AtCoder 题（key 去重）。 */
export function planTargets(kb, resources) {
  const meta = new Map(resources.problems.map((item) => [item.id, item]))
  const solved = new Map()
  for (const handles of Object.values(kb.solved?.atcoder || {})) {
    for (const [key, item] of Object.entries(handles)) solved.set(key, item)
  }
  const digested = new Set(
    (kb.problems || [])
      .filter((problem) => problem.platform === 'atcoder' && String(problem.essence || '').trim() !== '')
      .map((problem) => problem.key),
  )
  const targets = []
  for (const [key, item] of solved) {
    if (digested.has(key)) continue
    const extra = meta.get(key) || {}
    const contest = extra.contest || (key.includes('_') ? key.slice(0, key.indexOf('_')) : '')
    targets.push({
      key,
      title: extra.title || item.title || key,
      contest,
      rating: extra.difficulty ?? item.rating ?? null,
      url: `https://atcoder.jp/contests/${contest}/tasks/${key}`,
    })
  }
  return targets
}

function statsOf(targets) {
  const bands = [[0, 1200], [1200, 1600], [1600, 2000], [2000, 2400], [2400, 2800], [2800, 9999]]
  const rows = bands.map(([low, high]) => ({
    band: `${low}-${high === 9999 ? '+' : high}`,
    count: targets.filter((item) => item.rating != null && item.rating >= low && item.rating < high).length,
  }))
  return { total: targets.length, rows, unknown: targets.filter((item) => item.rating == null).length }
}

/** HTML 题解：英文 Official 优先，其次任意 Official。 */
export function pickEditorialLink(html, contest) {
  const pattern = new RegExp(`href="(/contests/${contest}/editorial/\\d+)"[^>]*>([^<]*)<`, 'g')
  const links = []
  let match
  while ((match = pattern.exec(html))) links.push({ href: match[1], label: match[2] })
  const unique = []
  const seen = new Set()
  for (const link of links) {
    if (seen.has(link.href)) continue
    seen.add(link.href)
    unique.push(link)
  }
  return (
    unique.find((link) => /^editorial$/i.test(link.label.trim())) ||
    unique.find((link) => /解説|editorial/i.test(link.label)) ||
    unique[0] ||
    null
  )
}

/** 整场题解的 PDF（老比赛常见）。 */
export function pickPdfLink(html) {
  const source = String(html)
  const direct = source.match(/href="(https?:\/\/[^"]+?\.pdf)"/i)
  if (direct) return direct[1]
  // 老比赛的官方题解走 /jump?url=<百分号编码的 PDF 地址>，例如 agc004。
  const jump = source.match(/href="\/jump\?url=([^"]+)"/i)
  if (jump) {
    let url = jump[1].replace(/&amp;/g, '&')
    try {
      url = decodeURIComponent(url)
    } catch (_) {
      return null
    }
    if (/\.pdf(\?|$)/i.test(url)) return url
  }
  return null
}

/** 用户博客题解（外链兜底）。 */
export function pickExternalEditorial(html) {
  const pattern = /href="(https?:\/\/[^"]+)"[^>]*>([^<]*)</g
  const skip = /(atcoder\.jp|twitter\.com|youtu\.be|youtube\.com|addtoany|creativecommons|img\.atcoder)/i
  const wanted = /解説|editorial|solution|実装/i
  let match
  while ((match = pattern.exec(html))) {
    const href = match[1]
    const label = match[2].trim()
    if (skip.test(href) || /\.pdf(\?|$)/i.test(href)) continue
    if (wanted.test(label) || /editorial/i.test(href)) return { href, label }
  }
  return null
}

async function fetchPdfEditorial(url, letter) {
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!response.ok) return ''
  ensureDir(DIGEST_DIR)
  const file = path.join(DIGEST_DIR, `editorial-${Date.now()}.pdf`)
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  let text = ''
  try {
    text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (_) {
    text = ''
  } finally {
    fs.rmSync(file, { force: true })
  }
  if (text.trim() === '') return ''
  const escaped = letter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 老比赛的整场题解 PDF 先日文后英文：从 "For International Readers" 之后找英文小节。
  const english = /For International Readers/i.exec(text)
  const searchFrom = english ? english.index : 0
  const body = text.slice(searchFrom)
  const heading = new RegExp(`^[ \\t]*${escaped}(?![A-Za-z])[ \\t]*[:：.\\-–—][ \\t]*`, 'm').exec(body)
  // 切不出小节时整篇保留：消化方可自己在整场题解里找目标题的小节。
  if (!heading) return text.slice(0, 25000).trim()
  const rest = body.slice(heading.index + 1)
  const next = /^[ \t]*[A-H](?![A-Za-z])[ \t]*[:：.][ \t]*/m.exec(rest)
  const section = (next ? rest.slice(0, next.index) : rest).slice(0, 25000).trim()
  return section.length >= 500 ? section : text.slice(0, 25000).trim()
}

async function fetchTaskText(task) {
  const page = await getText(`${task.url}?lang=en`)
  const start = page.indexOf('id="task-statement"')
  return htmlToText(start === -1 ? page : page.slice(start))
}

async function fetchEditorialText(task) {
  const listHtml = await getText(`${task.url}/editorial?lang=en`)
  const link = pickEditorialLink(listHtml, task.contest)
  if (link) {
    try {
      const page = await getText(`https://atcoder.jp${link.href}?lang=en`)
      const start = page.indexOf('id="main-container"')
      const text = htmlToText(start === -1 ? page : page.slice(start))
      if (text.length > 300) return { text, url: `https://atcoder.jp${link.href}` }
    } catch (_) {
      /* 官方页面抓不动，继续兜底 */
    }
  }
  const pdf = pickPdfLink(listHtml)
  if (pdf) {
    try {
      // 老 ARC 的 key 后缀与页面显示字母会错位（arc070_d 实际是 F 题），优先用标题前缀。
      const titleLetter = /^\s*([A-H])[.\s]/.exec(task.title || '')
      const letter = titleLetter ? titleLetter[1].toUpperCase() : task.key.slice(-1).toUpperCase()
      const text = await fetchPdfEditorial(pdf, letter)
      if (text.length > 300) return { text, url: pdf }
    } catch (_) {
      /* PDF 也失败，继续试外链 */
    }
  }
  const external = pickExternalEditorial(listHtml)
  if (external) {
    try {
      const text = htmlToText(await getText(external.href))
      if (text.length > 300) return { text, url: external.href }
    } catch (_) {
      /* 外链失败就当没有题解 */
    }
  }
  return { text: '', url: null }
}

async function main() {
  const kb = loadKb()
  const resources = await loadResources(arg('force'))
  const targets = planTargets(kb, resources)

  if (arg('stats')) {
    const stats = statsOf(targets)
    console.log(`未消化的 AtCoder 已通过题：${stats.total}（其中难度未知 ${stats.unknown}）`)
    for (const row of stats.rows) console.log(`  ${row.band}: ${row.count}`)
    return
  }

  let picked
  const explicit = arg('tasks')
  if (typeof explicit === 'string') {
    picked = explicit
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((key) => {
        const hit = targets.find((task) => task.key === key)
        if (hit) return hit
        const known = resources.problems.find((item) => item.id === key)
        const contest = known?.contest || key.slice(0, key.indexOf('_'))
        return { key, title: known?.title || key, contest, rating: known?.difficulty ?? null, url: `https://atcoder.jp/contests/${contest}/tasks/${key}` }
      })
  } else {
    const min = Number(arg('min', 0))
    const max = Number(arg('max', 9999))
    const limit = Number(arg('limit', 8))
    picked = targets
      .filter((task) => task.rating != null && task.rating >= min && task.rating <= max)
      .filter((task) => !fs.existsSync(path.join(INBOX_DIR, `${task.key}.txt`)))
      .sort((a, b) => b.rating - a.rating || a.key.localeCompare(b.key))
      .slice(0, limit)
  }

  ensureDir(INBOX_DIR)
  const manifest = []
  for (const task of picked) {
    const file = path.join(INBOX_DIR, `${task.key}.txt`)
    if (fs.existsSync(file) && !arg('refetch')) {
      console.log(`跳过（已抓过）${task.key}`)
      manifest.push({ ...task, file })
      continue
    }
    process.stdout.write(`抓取 ${task.key}（${task.rating ?? '?'}）... `)
    try {
      const statement = await fetchTaskText(task)
      let editorial = { text: '', url: null }
      try {
        editorial = await fetchEditorialText(task)
      } catch (error) {
        editorial = { text: `（题解抓取失败：${error.message}）`, url: null }
      }
      const body = [
        `# ${task.key} ${task.title}`,
        `rating: ${task.rating ?? 'unknown'}`,
        `url: ${task.url}`,
        `editorial: ${editorial.url || '（没有找到）'}`,
        '',
        '## Statement',
        statement,
        '',
        '## Editorial',
        editorial.text || '（没有找到官方题解）',
        '',
      ].join('\n')
      fs.writeFileSync(file, body, 'utf8')
      manifest.push({ ...task, file, statementChars: statement.length, editorialChars: editorial.text.length })
      console.log(`题面 ${statement.length} 字 / 题解 ${editorial.text.length} 字`)
      await new Promise((resolve) => setTimeout(resolve, 1200))
    } catch (error) {
      console.log(`失败：${error.message}`)
      manifest.push({ ...task, file: null, error: error.message })
    }
  }

  fs.writeFileSync(path.join(DIGEST_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`\n清单：${path.join(DIGEST_DIR, 'manifest.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
