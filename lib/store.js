/**
 * 知识库存储层：单文件 JSON + 原子写。
 *
 * 设计取舍：
 *  - 没有现成插件数据库惯例可抄，数据量也不大（千级题目、百级知识点），
 *    一个 kb.json 足够，手工可读、可直接备份。
 *  - 所有写入走 tmp + rename，避免进程中断留下半个文件。
 *  - 读入时做一次 normalize，旧版本/手改坏了的字段不会把整个面板搞崩。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export class KbError extends Error {
  constructor(message) {
    super(message)
    this.name = 'KbError'
  }
}

export function fail(message) {
  throw new KbError(message)
}

export function nowIso() {
  return new Date().toISOString()
}

export function defaultDataDir() {
  return path.join(os.homedir(), '.dsh', 'oi-knowledge')
}

export const VERDICTS = ['solved', 'attempted', 'unsolved', 'unknown']
export const MASTERY = ['auto', 'expert', 'strong', 'ok', 'weak', 'poor', 'unknown']
export const KINDS = ['observation', 'trick', 'idea', 'direction', 'pitfall']
export const NODE_KINDS = ['domain', 'topic', 'concept']
export const STUCK_STAGES = ['observe', 'derive', 'implement', 'debug']
export const CARD_LEVELS = ['again', 'hard', 'good', 'easy']
export const CARD_LEVEL_LABEL = { again: '忘了', hard: '勉强想起', good: '想起来了', easy: '太简单' }
export const QUIZ_RESULTS = ['hit1', 'hit2', 'miss']
export const QUIZ_RESULT_LABEL = { hit1: '第一轮命中', hit2: '第二轮命中', miss: '两轮都没中' }

export const STUCK_LABEL = {
  observe: '没找到观察',
  derive: '推不到可写形式',
  implement: '会做但写不对',
  debug: '写完调不出',
}

export const KIND_LABEL = {
  observation: '观察',
  trick: '套路',
  idea: '思路',
  direction: '思考方向',
  pitfall: '坑点',
}

export const VERDICT_LABEL = {
  solved: '已通过',
  attempted: '试过未过',
  unsolved: '未解决',
  unknown: '未标注',
}

export function emptyKb() {
  const t = nowIso()
  return {
    schema: 1,
    createdAt: t,
    updatedAt: t,
    seq: 0,
    nodes: [],
    obsNodes: [],
    problems: [],
    accounts: [],
    solved: {},
    attempted: {},
    training: { reviews: {}, attempts: [], sessions: [], quizShown: {}, translateQueue: [] },
    meta: { tagMap: {}, lastSeedAt: null, lastSyncAt: null, problemset: null },
  }
}

function str(value) {
  return typeof value === 'string' ? value : ''
}

function strList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
}

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : null
}

export function normalizePatterns(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === 'string' || (item && typeof item === 'object'))
    .map((item) => (typeof item === 'string' ? { text: item.trim(), examples: [], verified: false } : item))
    .filter((item) => typeof item.text === 'string' && item.text.trim())
    .map((item) => ({
      text: item.text.trim(),
      examples: (Array.isArray(item.examples) ? item.examples : [])
        .filter((entry) => entry && (typeof entry === 'string' || typeof entry.id === 'string'))
        .map((entry) => (typeof entry === 'string' ? { id: entry, title: '' } : { id: entry.id, title: str(entry.title) })),
      verified: item.verified === true,
      reviews: (Array.isArray(item.reviews) ? item.reviews : [])
        .filter((review) => review && Number.isFinite(Number(review.at)) && CARD_LEVELS.includes(review.level))
        .slice(-60)
        .map((review) => ({
          at: Number(review.at),
          level: review.level,
          ms: Number.isFinite(Number(review.ms)) ? Math.max(0, Math.round(Number(review.ms))) : null,
        })),
    }))
}

function normalizeNode(raw, index) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id === '') return null
  const node = {
    id: raw.id,
    parent: typeof raw.parent === 'string' && raw.parent !== '' ? raw.parent : null,
    name: str(raw.name).trim() || raw.id,
    kind: NODE_KINDS.includes(raw.kind) ? raw.kind : 'concept',
    summary: str(raw.summary),
    signals: strList(raw.signals),
    aliases: strList(raw.aliases),
    patterns: normalizePatterns(raw.patterns),
    cfTags: strList(raw.cfTags),
    note: str(raw.note),
    mastery: MASTERY.includes(raw.mastery) ? raw.mastery : 'auto',
    order: Number.isFinite(raw.order) ? raw.order : index,
    createdAt: str(raw.createdAt) || nowIso(),
    updatedAt: str(raw.updatedAt) || nowIso(),
  }
  if (raw.tree === 'idea') node.tree = 'idea'
  return node
}

function normalizeInsight(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const text = str(raw.text).trim()
  if (!text) return null
  return {
    id: str(raw.id) || `i${index + 1}`,
    kind: KINDS.includes(raw.kind) ? raw.kind : 'idea',
    text,
    nodes: strList(raw.nodes),
    obsNodes: strList(raw.obsNodes),
    key: raw.key === true,
    createdAt: str(raw.createdAt) || nowIso(),
  }
}

function normalizeProblem(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const platform = str(raw.platform) || 'other'
  const key = str(raw.key)
  if (!key) return null
  const insights = Array.isArray(raw.insights)
    ? raw.insights.map((item, i) => normalizeInsight(item, i)).filter(Boolean)
    : []
  return {
    id: str(raw.id) || `p${index + 1}`,
    platform,
    key,
    title: str(raw.title) || key,
    titleZh: str(raw.titleZh),
    url: str(raw.url),
    rating: num(raw.rating),
    tags: strList(raw.tags),
    verdict: VERDICTS.includes(raw.verdict) ? raw.verdict : 'unknown',
    stuckStage: STUCK_STAGES.includes(raw.stuckStage) ? raw.stuckStage : null,
    difficulty: str(raw.difficulty),
    essence: str(raw.essence),
    statement: str(raw.statement),
    statementZh: str(raw.statementZh),
    solution: str(raw.solution),
    nodes: strList(raw.nodes),
    keyObservations: strList(raw.keyObservations),
    insights,
    source: str(raw.source) || 'manual',
    sample: raw.sample === true,
    pool: raw.pool === 'quiz' ? 'quiz' : null,
    createdAt: str(raw.createdAt) || nowIso(),
    updatedAt: str(raw.updatedAt) || nowIso(),
  }
}

function normalizeAccount(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const platform = str(raw.platform)
  const handle = str(raw.handle).trim()
  if (!platform || !handle) return null
  return {
    id: str(raw.id) || `a${index + 1}`,
    platform,
    handle,
    cookie: str(raw.cookie),
    createdAt: str(raw.createdAt) || nowIso(),
    lastSyncAt: str(raw.lastSyncAt) || null,
    lastResult: raw.lastResult && typeof raw.lastResult === 'object' ? raw.lastResult : null,
  }
}

export function normalizeKb(raw) {
  const kb = emptyKb()
  if (!raw || typeof raw !== 'object') return kb
  kb.createdAt = str(raw.createdAt) || kb.createdAt
  kb.updatedAt = str(raw.updatedAt) || kb.updatedAt
  kb.seq = Number.isFinite(raw.seq) ? raw.seq : 0
  kb.nodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode).filter(Boolean) : []
  kb.obsNodes = Array.isArray(raw.obsNodes)
    ? raw.obsNodes.map(normalizeNode).filter(Boolean).map((node) => ({ ...node, tree: 'obs' }))
    : []
  kb.problems = Array.isArray(raw.problems) ? raw.problems.map(normalizeProblem).filter(Boolean) : []
  kb.accounts = Array.isArray(raw.accounts) ? raw.accounts.map(normalizeAccount).filter(Boolean) : []

  // 早期手工建的节点没有 tree 字段：从父链继承，避免思路节点被当成算法树散根。
  const byId = new Map(kb.nodes.map((node) => [node.id, node]))
  for (const node of kb.nodes) {
    let cursor = node
    for (let guard = 0; cursor && !cursor.tree && cursor.parent && byId.has(cursor.parent) && guard < 64; guard += 1) {
      cursor = byId.get(cursor.parent)
    }
    if (cursor && !node.tree && (cursor.tree === 'idea' || cursor.tree === 'obs')) node.tree = cursor.tree
  }
  const readBucket = (source) => {
    const out = {}
    if (!source || typeof source !== 'object') return out
    for (const [platform, handles] of Object.entries(source)) {
      if (!handles || typeof handles !== 'object') continue
      out[platform] = {}
      for (const [handle, map] of Object.entries(handles)) {
        if (!map || typeof map !== 'object') continue
        out[platform][handle] = {}
        for (const [key, item] of Object.entries(map)) {
          if (!item || typeof item !== 'object') continue
          out[platform][handle][key] = {
            key,
            title: str(item.title) || key,
            url: str(item.url),
            rating: num(item.rating),
            tags: strList(item.tags),
            solvedAt: str(item.solvedAt),
          }
        }
      }
    }
    return out
  }
  kb.solved = readBucket(raw.solved)
  kb.attempted = readBucket(raw.attempted)
  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
  kb.meta = {
    tagMap: meta.tagMap && typeof meta.tagMap === 'object' ? { ...meta.tagMap } : {},
    lastSeedAt: str(meta.lastSeedAt) || null,
    lastSyncAt: str(meta.lastSyncAt) || null,
    problemset: meta.problemset && typeof meta.problemset === 'object' ? meta.problemset : null,
    // 平台分数缓存：失败条目也要保留（rating:null + reason），否则每次调用都会重新拉取。
    platformRatings: (() => {
      const source = meta.platformRatings && typeof meta.platformRatings === 'object' ? meta.platformRatings : {}
      const out = {}
      for (const platform of ['codeforces', 'atcoder']) {
        const row = source[platform]
        if (!row || typeof row !== 'object') continue
        const rating = num(row.rating)
        out[platform] = {
          rating: Number.isFinite(rating) ? rating : null,
          fetchedAt: str(row.fetchedAt) || null,
          source: str(row.source) || null,
          reason: str(row.reason) || null,
        }
      }
      return out
    })(),
  }
  const training = raw.training && typeof raw.training === 'object' ? raw.training : {}
  kb.training = {
    reviews: (() => {
      const source = training.reviews && typeof training.reviews === 'object' ? training.reviews : {}
      const out = {}
      for (const [cardId, list] of Object.entries(source)) {
        if (!cardId || !Array.isArray(list)) continue
        out[cardId] = list
          .filter((review) => review && Number.isFinite(Number(review.at)) && CARD_LEVELS.includes(review.level))
          .slice(-60)
          .map((review) => ({
            at: Number(review.at),
            level: review.level,
            ms: Number.isFinite(Number(review.ms)) ? Math.max(0, Math.round(Number(review.ms))) : null,
          }))
      }
      return out
    })(),
    attempts: (Array.isArray(training.attempts) ? training.attempts : [])
      .filter((item) => item && typeof item.problemKey === 'string' && item.problemKey)
      .slice(-400)
      .map((item, index) => ({
        id: str(item.id) || `a${index + 1}`,
        problemKey: item.problemKey,
        text: str(item.text),
        at: Number.isFinite(Number(item.at)) ? Number(item.at) : Date.now(),
        ms: Number.isFinite(Number(item.ms)) ? Math.max(0, Math.round(Number(item.ms))) : null,
        round: Number.isFinite(Number(item.round)) ? Math.max(1, Math.round(Number(item.round))) : 1,
        result: QUIZ_RESULTS.includes(item.result) ? item.result : null,
        note: str(item.note),
      })),
    sessions: (Array.isArray(training.sessions) ? training.sessions : [])
      .filter((item) => item && typeof item.id === 'string')
      .slice(-40)
      .map((item) => ({
        id: item.id,
        startedAt: Number.isFinite(Number(item.startedAt)) ? Number(item.startedAt) : Date.now(),
        endedAt: Number.isFinite(Number(item.endedAt)) ? Number(item.endedAt) : null,
        keys: strList(item.keys),
        startTimes: item.startTimes && typeof item.startTimes === 'object' ? { ...item.startTimes } : {},
        results: item.results && typeof item.results === 'object' ? { ...item.results } : {},
      })),
    quizShown: (() => {
      const source = training.quizShown && typeof training.quizShown === 'object' ? training.quizShown : {}
      const out = {}
      for (const [key, at] of Object.entries(source)) {
        if (!key || !Number.isFinite(Number(at))) continue
        out[key] = Number(at)
      }
      return out
    })(),
    translateQueue: (Array.isArray(training.translateQueue) ? training.translateQueue : [])
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim())
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(-200),
  }
  // 清理悬空引用：节点被删掉后题目/洞察/标签映射不应继续指向它
  const ids = new Set(kb.nodes.map((node) => node.id))
  for (const node of kb.nodes) {
    if (node.parent !== null && !ids.has(node.parent)) node.parent = null
  }
  const obsIds = new Set(kb.obsNodes.map((node) => node.id))
  for (const node of kb.obsNodes) {
    if (node.parent !== null && !obsIds.has(node.parent)) node.parent = null
  }
  for (const problem of kb.problems) {
    problem.nodes = problem.nodes.filter((id) => ids.has(id))
    problem.keyObservations = problem.keyObservations.filter((id) =>
      problem.insights.some((insight) => insight.id === id),
    )
    for (const insight of problem.insights) {
      insight.nodes = insight.nodes.filter((id) => ids.has(id))
      insight.obsNodes = insight.obsNodes.filter((id) => obsIds.has(id))
    }
  }
  for (const [tag, id] of Object.entries(kb.meta.tagMap)) {
    if (!ids.has(id)) delete kb.meta.tagMap[tag]
  }
  return kb
}

export class KbStore {
  constructor(options = {}) {
    const configured = typeof options.dir === 'string' ? options.dir : options.dataDir
    const dir = typeof configured === 'string' ? configured.trim() : ''
    this.dir = dir !== '' ? path.resolve(dir) : defaultDataDir()
    this.file = path.join(this.dir, 'kb.json')
    this.cache = null
    this.revision = 0
    // 加载失败（文件损坏）时置为错误信息：此后拒绝写盘，避免用空库覆盖原文件。
    this.loadError = null
    this.backupFile = null
  }

  read() {
    if (!this.cache) this.load()
    return this.cache
  }

  load() {
    let raw = null
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        // 坏文件不静默丢弃：留个备份，并进入「拒绝写盘」保护模式。
        try {
          const backup = `${this.file}.broken-${Date.now()}`
          fs.copyFileSync(this.file, backup)
          this.backupFile = backup
          console.warn(`[oi-knowledge] kb.json 解析失败，已备份到 ${backup}：${error.message}`)
        } catch (_) {
          /* 备份失败也不该阻断插件启动 */
        }
        this.loadError = error.message
      }
      raw = null
    }
    this.cache = normalizeKb(raw)
    return this.cache
  }

  write() {
    const kb = this.cache
    if (!kb) return
    if (this.loadError) {
      throw new KbError(
        `数据文件 kb.json 损坏，已停止写入以免覆盖：${this.loadError}` +
          (this.backupFile ? `\n备份：${this.backupFile}` : '') +
          '\n请修复或删除该文件后重载插件（修复前可以只读查看）。',
      )
    }
    kb.updatedAt = nowIso()
    fs.mkdirSync(this.dir, { recursive: true })
    const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
    this.revision += 1
  }

  mutate(fn) {
    const kb = this.read()
    // 失败要回滚：否则 "内存已半改、磁盘未改" 会被下一次写入带进文件。
    const snapshot = JSON.parse(JSON.stringify(kb))
    try {
      const result = fn(kb)
      this.write()
      return result
    } catch (error) {
      this.cache = snapshot
      throw error
    }
  }

  nextId(kb, prefix) {
    kb.seq = (Number.isFinite(kb.seq) ? kb.seq : 0) + 1
    return `${prefix}${kb.seq.toString(36)}`
  }

  /** 大块缓存（CF problemset）单独放一个文件，别污染 kb.json。 */
  cacheFile(name) {
    return path.join(this.dir, name)
  }

  readCache(name, maxAgeMs) {
    try {
      const file = this.cacheFile(name)
      const stat = fs.statSync(file)
      if (maxAgeMs && Date.now() - stat.mtimeMs > maxAgeMs) return null
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (_) {
      return null
    }
  }

  writeCache(name, value) {
    fs.mkdirSync(this.dir, { recursive: true })
    const file = this.cacheFile(name)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value), 'utf8')
    fs.renameSync(tmp, file)
  }
}
