/**
 * dsh-oi-knowledge —— OI / ICPC 知识点树 + 题目洞察归档 + 账号弱点分析
 *
 * Host 侧：
 *   · 三个工具：oi_kb / oi_problem / oi_account
 *   · 面板数据接口：/plugins/dsh-oi-knowledge/api/{state, problem, call}
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KbError, KbStore, defaultDataDir } from './lib/store.js'
import { KnowledgeService } from './lib/service.js'

export const inject = ['tools']

const SUMMARY_OUTPUT = {
  schema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string' },
    },
    required: ['summary'],
    additionalProperties: true,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.summary ?? '') }]
  },
}

function toolOk(payload) {
  return { ok: true, ...payload }
}

function toolError(error) {
  if (error instanceof KbError) return { ok: false, summary: `操作失败：${error.message}` }
  return { ok: false, summary: `操作失败：${error?.message || String(error)}` }
}

function registerTools(ctx, service) {
  const disposers = []

  disposers.push(
    ctx.tools.register({
      name: 'oi_kb',
      description: [
        '维护 OI/ICPC 两棵树：算法知识树（考什么）与思路树（怎么想出来的），并给出掌握度与弱点分析。',
        'action 取值：',
        '  tree — 打印树；tree=algo 知识树、tree=idea 思路树、tree=all 全部。可传 root/depth；',
        '  show — 看单个知识点/思路的掌握度、识别信号、相关题与洞察（node）；',
        '  add / update / move / remove — 增删改节点（name/parent/summary/signals/note/mastery/kind）；',
        '  search — 按名字/别名搜节点（query）；',
        '  map_tag — 把 Codeforces 标签映射到知识点（tag + node，留空删映射）；',
        '  link_problem / unlink_problem — 把已有题目挂到/摘离知识点（problem + node）；',
        '  seed — 首次使用或补齐内置两棵树（幂等，不覆盖手写内容）；',
        '  report — 总览 + 最该补的知识点 + 思路树空白方向（limit）；',
        '  gaps — 按 tag 统计「从未通过」的盲区；',
        '  recommend — 按弱点从 Codeforces 题库推题（node/tag/ratingMin/ratingMax/limit）；',
        '  weak — 面板「薄弱题」同款：先随机抽一批候选，再挑出命中你最弱知识点的那道；',
        '  similar — 比两题的「想法」相似度（a + b），或单题找库内最像的（a），或一批候选排序（candidates）；只比观察/洞察/算法节点，不比题面文字；',
        '  novel — 反套路推荐：候选里挑与库内最不像的（candidates 或最近消化的题，threshold 默认 0.3）；',
        '  obs_tree — 打印观察树（精髓观察的层级结构）及每个节点上的观察数；',
        '  obs_patterns — 列出观察树里沉淀的「常见观察句式」，可按 query 过滤（如 二分、逆序对、gcd）；',
        '  obs_unassigned — 列出还没挂到观察节点的观察，并按句式给出候选节点（limit 默认 20、上限 200）；',
        '  calibrate — 用已做题的最近邻相似度分布校准阈值；',
        '  status — 数据目录、节点/题目/账号数量。',
        '节点可以用 id、路径「父/子」、或唯一名字指定。',
        '思路树是重点：每道题真正的收获是观察、套路、推导性思路和思考方向，算法名只是载体。',
      ].join('\n'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['tree', 'show', 'add', 'update', 'move', 'remove', 'search', 'map_tag', 'link_problem', 'unlink_problem', 'seed', 'report', 'gaps', 'recommend', 'weak', 'similar', 'novel', 'obs_tree', 'obs_patterns', 'obs_unassigned', 'calibrate', 'status'],
          },
          node: { type: 'string', description: '知识点：id、路径（如「动态规划/背包/01 背包」）或唯一名字' },
          parent: { type: 'string', description: '父节点（add / move 用；留空表示根级）' },
          name: { type: 'string', description: '新节点名字（add）' },
          kind: { type: 'string', enum: ['domain', 'topic', 'concept'], description: '节点层级（add / update）' },
          summary: { type: 'string', description: '一句话说明这个知识点在考什么' },
          signals: { type: 'array', items: { type: 'string' }, description: '看到什么样的题面特征就该想到它' },
          note: { type: 'string', description: '个人笔记' },
          mastery: { type: 'string', enum: ['auto', 'strong', 'ok', 'weak', 'unknown'], description: '手动修正掌握度，auto 表示按数据算' },
          aliases: { type: 'array', items: { type: 'string' }, description: '别名（用于自动识别题解里提到的知识点）' },
          mode: { type: 'string', enum: ['subtree', 'reparent'], description: 'remove 时子节点怎么处理，默认 subtree 一起删' },
          query: { type: 'string', description: 'search / obs_patterns 的关键词' },
          tag: { type: 'string', description: 'Codeforces 标签，如 dp / graphs / binary search' },
          problem: { type: 'string', description: '题目：id、platform:key 或链接（link_problem / unlink_problem）' },
          root: { type: 'string', description: 'tree 从哪个节点开始打印' },
          depth: { type: 'number', description: 'tree 的打印层数' },
          tree: { type: 'string', enum: ['algo', 'idea', 'all'], description: '打印哪棵树：algo 算法知识树（默认）、idea 思路树、all 全部' },
          limit: { type: 'number', description: 'report / recommend 返回条数' },
          ratingMin: { type: 'number', description: 'recommend 的难度下限' },
          ratingMax: { type: 'number', description: 'recommend 的难度上限' },
          refresh: { type: 'boolean', description: 'recommend 时强制刷新 Codeforces 题库缓存' },
          a: { type: 'string', description: 'similar：第一道题（id、platform:key 或链接）' },
          b: { type: 'string', description: 'similar：第二道题；不给则找库里最像 a 的那道' },
          candidates: { type: 'array', items: { type: 'string' }, description: 'similar/novel：候选题目列表（id 或题号）' },
          threshold: { type: 'number', description: 'similar/novel：陌生阈值，默认 0.3；与库内最像的一道相似度低于它才推荐' },
          exclude: {
            type: 'array',
            items: { type: 'string' },
            description: 'recommend/weak：已经推荐过、这次要排除的题号（面板「换一批」用）',
          },
        },
      },
      timeoutMs: 120000,
      output: SUMMARY_OUTPUT,
      async execute(args) {
        try {
          switch (args.action) {
            case 'tree':
              return toolOk(service.tree({ root: args.root, depth: args.depth, tree: args.tree }))
            case 'show':
              return toolOk(service.showNode({ node: args.node }))
            case 'add':
              return toolOk(service.addNode(args))
            case 'update':
              return toolOk(service.updateNode(args))
            case 'move':
              return toolOk(service.moveNode({ node: args.node, parent: args.parent }))
            case 'remove':
              return toolOk(service.removeNode({ node: args.node, mode: args.mode }))
            case 'search':
              return toolOk(service.searchNodes({ query: args.query, limit: args.limit }))
            case 'map_tag':
              return toolOk(service.mapTag({ tag: args.tag, node: args.node }))
            case 'link_problem':
              return toolOk(service.linkProblem({ problem: args.problem, node: args.node }))
            case 'unlink_problem':
              return toolOk(service.unlinkProblem({ problem: args.problem, node: args.node }))
            case 'seed':
              return toolOk(service.seed())
            case 'report':
              return toolOk(service.report({ limit: args.limit }))
            case 'gaps':
              return toolOk(service.gaps())
            case 'recommend':
              return toolOk(await service.recommend(args))
            case 'weak':
              return toolOk(await service.weakProblem(args))
            case 'obs_tree':
              return toolOk(service.obsTree({ depth: args.depth }))
            case 'obs_patterns':
              return toolOk(service.obsPatterns({ query: args.query }))
            case 'obs_unassigned':
              return toolOk(service.obsUnassigned({ limit: args.limit }))
            case 'similar':
              return toolOk(service.similar({ a: args.a, b: args.b, candidates: args.candidates, threshold: args.threshold }))
            case 'novel':
              return toolOk(service.recommendNovel({ candidates: args.candidates, threshold: args.threshold, limit: args.limit }))
            case 'calibrate':
              return toolOk(service.calibrateThreshold())
            case 'status':
              return toolOk(service.status())
            default:
              return { ok: false, summary: `未知 action：${args.action}` }
          }
        } catch (error) {
          return toolError(error)
        }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'oi_problem',
      description: [
        '录入/维护题目与题解洞察。核心不是记题号，而是把「这题最精髓的部分」拆出来：观察、套路、推导性通用思路、思考方向、坑点。',
        '写 essence / 洞察 / 题面题解时，数学记号一律用 $…$ 包起来（如 $A_i$、$dp_{i,j}$、$O(N\\log N)$），面板 KaTeX 只渲染 $…$ 里的内容。',
        '数组下标写成下标形式：用 $dp_{i,j}$，不要写 $dp[i][j]$；构造序列（如 1,2,1,2,…）用反引号包成代码。',
        'action 取值：',
        '  add — 录题：platform + key（CF 1879D / AtCoder abc300_f / 洛谷 P1234）或 url；强烈建议同时给 essence（一句话精髓）和 insights；',
        '  add_insight — 给已有题补一条洞察（problem + kind + text + nodes?）；kind 可用英文或中文（观察/套路/思路/思考方向/坑点），nodes 可挂算法节点或思路节点；',
        '  remove_insight — 删一条洞察（problem + insight=id 或文本片段）；',
        '  update — 改题目字段（problem + title/url/rating/tags/verdict/essence/statement/solution/nodes）；',
        '  stuck — 记录这题卡在哪一步（problem + stage：observe/derive/implement/debug，留空清除）；',
        '  show — 看题目全文、精髓与所有洞察；',
        '  list — 列表，可按 platform/verdict/node/query 过滤；',
        '  search — 按标题/题号/tag/题解/洞察全文搜；',
        '  link_node / unlink_node — 手动挂/摘知识点；',
        '  classify — 按 tag 和题解文字重新推断该挂哪些节点（apply=false 只看不写）；',
        '  remove — 删除题目。',
        '录入题目后如果文字里出现了节点名，会自动挂到那些节点；思路树节点请用 nodes 显式指定，或在洞察里点名。',
        '每道题至少写一条 observation 和一条 direction，否则它只是刷题记录。',
      ].join('\n'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'add_insight', 'remove_insight', 'update', 'stuck', 'show', 'list', 'search', 'link_node', 'unlink_node', 'classify', 'remove'],
          },
          problem: { type: 'string', description: '题目：id、platform:key（如 codeforces:1879D）或题目链接' },
          platform: { type: 'string', enum: ['codeforces', 'atcoder', 'luogu', 'other'], description: '平台' },
          key: { type: 'string', description: '题号：CF 1879D，AtCoder abc300_f，洛谷 P1234' },
          url: { type: 'string', description: '题目链接（可替代 platform + key）' },
          title: { type: 'string', description: '题目标题' },
          rating: { type: 'number', description: '难度分（CF rating / 洛谷换算分）' },
          tags: { type: 'array', items: { type: 'string' }, description: '题目标签，如 ["dp","greedy"]' },
          verdict: { type: 'string', enum: ['solved', 'attempted', 'unsolved', 'unknown'], description: '状态：已通过 / 试过没过 / 没做出来 / 未知' },
          difficulty: { type: 'string', description: '自定义难度标记' },
          essence: { type: 'string', description: '一句话说清这题最精髓的部分（核心观察或最关键的转化），比题解重要' },
          statement: { type: 'string', description: '题意摘要' },
          solution: { type: 'string', description: '题解（可整段贴）' },
          nodes: { type: 'array', items: { type: 'string' }, description: '要挂的知识点（id / 路径 / 名字）' },
          pool: {
            type: 'string',
            enum: ['quiz'],
            description: 'quiz：只进未通过出题池（不挂知识树、不计统计、不进相似度基线）',
          },
          insights: {
            type: 'array',
            description: '随题一起录入的洞察',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', description: 'observation / trick / idea / direction / pitfall，或中文' },
                text: { type: 'string', description: '一句话说清这条洞察' },
                nodes: { type: 'array', items: { type: 'string' }, description: '挂到哪些知识点（留空则按文字自动识别）' },
                obsNodes: { type: 'array', items: { type: 'string' }, description: '观察树节点（留空则按文字自动识别）' },
                key: { type: 'boolean', description: '是否这题的精髓观察（分析中最久的那一步）' },
              },
              required: ['kind', 'text'],
            },
          },
          kind: { type: 'string', description: 'add_insight 的洞察类型' },
          text: { type: 'string', description: 'add_insight 的洞察内容' },
          key: { type: 'boolean', description: 'add_insight：标记为精髓观察' },
          obsNodes: { type: 'array', items: { type: 'string' }, description: 'add_insight：观察树节点（名字或 id）' },
          insight: { type: 'string', description: 'remove_insight 的洞察 id 或文本片段' },
          node: { type: 'string', description: 'link_node / unlink_node 的目标知识点' },
          query: { type: 'string', description: 'list / search 的关键词' },
          verdict_filter: { type: 'string', enum: ['solved', 'attempted', 'unsolved', 'unknown'], description: 'list 的状态过滤' },
          stage: { type: 'string', enum: ['observe', 'derive', 'implement', 'debug', ''], description: 'stuck：卡点阶段，留空表示清除' },
          apply: { type: 'boolean', description: 'classify 是否写回，默认 true' },
          limit: { type: 'number', description: 'list 返回条数' },
        },
      },
      timeoutMs: 60000,
      output: SUMMARY_OUTPUT,
      async execute(args) {
        try {
          switch (args.action) {
            case 'add':
              return toolOk(service.addProblem(args))
            case 'add_insight':
              return toolOk(
                service.addInsight({
                  problem: args.problem,
                  kind: args.kind || (args.insights && args.insights[0]?.kind),
                  text: args.text,
                  nodes: args.nodes,
                  obsNodes: args.obsNodes,
                  key: args.key,
                }),
              )
            case 'remove_insight':
              return toolOk(service.removeInsight({ problem: args.problem, insight: args.insight }))
            case 'update':
              return toolOk(
                service.updateProblem({
                  problem: args.problem,
                  patch: {
                    title: args.title,
                    url: args.url,
                    rating: args.rating,
                    tags: args.tags,
                    verdict: args.verdict,
                    difficulty: args.difficulty,
                    essence: args.essence,
                    statement: args.statement,
                    solution: args.solution,
                    nodes: args.nodes,
                  },
                }),
              )
            case 'stuck':
              return toolOk(service.markStuck({ problem: args.problem, stage: args.stage }))
            case 'show':
              return toolOk(service.showProblem({ problem: args.problem }))
            case 'list':
              return toolOk(
                service.listProblems({
                  platform: args.platform,
                  verdict: args.verdict_filter,
                  node: args.node,
                  query: args.query,
                  limit: args.limit,
                }),
              )
            case 'search':
              return toolOk(service.listProblems({ query: args.query, limit: args.limit }))
            case 'link_node':
              return toolOk(service.linkProblem({ problem: args.problem, node: args.node }))
            case 'unlink_node':
              return toolOk(service.unlinkProblem({ problem: args.problem, node: args.node }))
            case 'classify':
              return toolOk(service.classifyProblem({ problem: args.problem, apply: args.apply }))
            case 'remove':
              return toolOk(service.removeProblem({ problem: args.problem }))
            default:
              return { ok: false, summary: `未知 action：${args.action}` }
          }
        } catch (error) {
          return toolError(error)
        }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'oi_account',
      description: [
        '绑定 atcoder / codeforces / luogu 账号，同步已通过的题，作为掌握度分析的证据。',
        'action 取值：',
        '  add — 绑定账号（platform + handle；洛谷需要数字 UID 和可选的 cookie）；',
        '  list — 看已绑定账号与同步状态；',
        '  remove — 解绑（platform + handle）；',
        '  sync — 同步：platform 留空则同步第一个账号；force=true 忽略缓存。',
        '同步会按 tag 把通过的题计到知识点上，重复同步不会重复计数。',
      ].join('\n'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'remove', 'sync'] },
          platform: { type: 'string', enum: ['codeforces', 'atcoder', 'luogu'], description: '平台' },
          handle: { type: 'string', description: '账号名；洛谷填数字 UID 或主页链接' },
          cookie: { type: 'string', description: '洛谷 Cookie（可选，单次 sync 也可传）' },
          force: { type: 'boolean', description: '忽略缓存，强制重新拉取' },
        },
      },
      timeoutMs: 120000,
      output: SUMMARY_OUTPUT,
      async execute(args) {
        try {
          switch (args.action) {
            case 'add':
              return toolOk(service.addAccount({ platform: args.platform, handle: args.handle, cookie: args.cookie }))
            case 'list':
              return toolOk(service.listAccounts())
            case 'remove':
              return toolOk(service.removeAccount({ platform: args.platform, handle: args.handle }))
            case 'sync':
              return toolOk(await service.syncAccount({ platform: args.platform, handle: args.handle, cookie: args.cookie, force: args.force }))
            default:
              return { ok: false, summary: `未知 action：${args.action}` }
          }
        } catch (error) {
          return toolError(error)
        }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'oi_train',
      description: [
        '训练：观察召回闪卡、新题方向定向（quiz 池 + 对话判分）、组卷器。',
        'action 取值：',
        '  card — 抽一张闪卡（kind=pattern 补结论 / problem 看题找观察，留空随机）；',
        '  mark — 记录闪卡复习结果（cardId + level: again/hard/good/easy，可带 ms）；',
        '  attempt — 提交一道新题的思路（problem + text，不揭示答案）；',
        '  review — 判方向是否命中（problem + hit + round），命中或第二轮才返回真值；',
        '  reveal — 直接看真值；',
        '  grade — 记录成绩（problem + result: hit1/hit2/miss）；',
        '  session_start / session_touch / session_finish — 组卷：开始、记开题时间、结算（acTimes 传 key→时间戳）；',
        '  stats — 召回率与方向命中统计。',
        '判方向时由模型对照真值判断，工具只负责记录与揭示。',
      ].join('\n'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['card', 'mark', 'attempt', 'review', 'reveal', 'grade', 'session_start', 'session_touch', 'session_finish', 'stats'],
          },
          kind: { type: 'string', enum: ['pattern', 'problem'], description: 'card：卡片类型' },
          node: { type: 'string', description: 'card：限定某个观察节点' },
          cardId: { type: 'string', description: 'mark：闪卡 id' },
          level: { type: 'string', enum: ['again', 'hard', 'good', 'easy'], description: 'mark：复习结果' },
          problem: { type: 'string', description: '题目：id、platform:key 或链接' },
          text: { type: 'string', description: 'attempt：你写的思路' },
          hit: { type: 'boolean', description: 'review：方向是否命中' },
          round: { type: 'number', description: 'review：第几轮（1 / 2）' },
          ms: { type: 'number', description: '用时的毫秒数' },
          result: { type: 'string', enum: ['hit1', 'hit2', 'miss'], description: 'grade：最终成绩' },
          note: { type: 'string', description: 'grade：评语' },
          session: { type: 'string', description: '组卷场次 id' },
          keys: { type: 'array', items: { type: 'string' }, description: 'session_start：题号列表' },
          acTimes: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'session_finish：题号 → AC 时间（ISO 或毫秒时间戳）',
          },
        },
      },
      timeoutMs: 60000,
      output: SUMMARY_OUTPUT,
      async execute(args) {
        try {
          switch (args.action) {
            case 'card':
              return toolOk(service.trainCard({ kind: args.kind, node: args.node }))
            case 'mark':
              return toolOk(service.trainMarkCard({ cardId: args.cardId, level: args.level, ms: args.ms }))
            case 'attempt':
              return toolOk(service.trainAttempt({ problem: args.problem, text: args.text, ms: args.ms }))
            case 'review':
              return toolOk(service.trainReview({ problem: args.problem, hit: args.hit, round: args.round }))
            case 'reveal':
              return toolOk(service.trainReveal({ problem: args.problem }))
            case 'grade':
              return toolOk(service.trainGrade({ problem: args.problem, result: args.result, note: args.note, ms: args.ms }))
            case 'session_start':
              return toolOk(service.sessionStart({ keys: args.keys }))
            case 'session_touch':
              return toolOk(service.sessionTouch({ session: args.session, problem: args.problem }))
            case 'session_finish':
              return toolOk(service.sessionFinish({ session: args.session, acTimes: args.acTimes }))
            case 'stats':
              return toolOk(service.trainStats())
            default:
              return { ok: false, summary: `未知 action：${args.action}` }
          }
        } catch (error) {
          return toolError(error)
        }
      },
    }),
  )

  return () => {
    for (const dispose of disposers) {
      try {
        dispose?.()
      } catch (_) {
        // 卸载阶段忽略
      }
    }
  }
}

// ── Web 面板数据接口 ───────────────────────────────────────────────────────

const API_PREFIX = '/plugins/dsh-oi-knowledge/api'
const ASSET_PREFIX = '/plugins/dsh-oi-knowledge/assets'
const ASSET_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')
const ASSET_MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
}

// 静态资源（KaTeX 的 js / css / 字体）。不参与 connection 鉴权：
// <script> / <link> 拿不到自定义头，且这些文件没有用户数据。
function createAssetRoute() {
  return {
    kind: 'prefix',
    path: ASSET_PREFIX,
    handler(req, res) {
      const url = new URL(req.url || '/', 'http://localhost')
      let rel = url.pathname.slice(ASSET_PREFIX.length).replace(/^\/+/, '')
      try {
        rel = decodeURIComponent(rel)
      } catch (_) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('bad path')
        return
      }
      const target = path.resolve(ASSET_ROOT, rel)
      if (target !== ASSET_ROOT && !target.startsWith(ASSET_ROOT + path.sep)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('forbidden')
        return
      }
      fs.readFile(target, (error, buffer) => {
        if (error) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('not found')
          return
        }
        res.writeHead(200, {
          'content-type': ASSET_MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'public, max-age=86400',
          'content-length': buffer.length,
        })
        res.end(buffer)
      })
    },
  }
}

function sendJson(res, status, payload, req) {
  const body = JSON.stringify(payload)
  const acceptsGzip = String(req?.headers?.['accept-encoding'] || '').includes('gzip')
  if (acceptsGzip && body.length > 16 * 1024) {
    const gzipped = zlib.gzipSync(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-encoding': 'gzip',
      'content-length': gzipped.length,
    })
    res.end(gzipped)
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function createApiRoute(service, getAdmission) {
  return {
    kind: 'prefix',
    path: API_PREFIX,
    async handler(req, res) {
      // Connection 在 Web 宿主里负责 Host/Origin 校验与浏览器认证。
      const admission = getAdmission()
      let rejection = undefined
      if (admission) {
        try {
          rejection = admission(req.headers)
        } catch (_) {
          rejection = 401
        }
      }
      if (rejection) {
        const status = typeof rejection === 'number' ? rejection : rejection?.status || 403
        sendJson(res, status, { error: status === 401 ? 'unauthorized' : 'forbidden' }, req)
        return
      }

      const url = new URL(req.url || '/', 'http://localhost')
      const route = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '')
      try {
        if (req.method === 'GET' && route === 'state') {
          sendJson(res, 200, service.state(), req)
          return
        }
        if (req.method === 'GET' && route === 'problem') {
          sendJson(res, 200, service.problemDetail({ id: url.searchParams.get('id') || '' }), req)
          return
        }
        if (req.method === 'POST' && route === 'call') {
          const raw = await readBody(req)
          const payload = raw ? JSON.parse(raw) : {}
          const result = await service.uiCall(String(payload.op || ''), payload.args || {})
          sendJson(res, 200, { ok: true, result }, req)
          return
        }
        sendJson(res, 404, { error: 'not_found' }, req)
      } catch (error) {
        const status = error instanceof KbError ? 400 : 500
        sendJson(res, status, { error: error?.message || String(error) }, req)
      }
    },
  }
}

// ── 入口 ──────────────────────────────────────────────────────────────────

function disposeOf(handle) {
  if (!handle) return
  if (typeof handle === 'function') handle()
  else if (typeof handle.dispose === 'function') handle.dispose()
}

export function apply(ctx, config = {}) {
  const configured = typeof config?.dataDir === 'string' ? config.dataDir.trim() : ''
  const store = new KbStore({ dir: configured || defaultDataDir() })
  const service = new KnowledgeService(store)

  ctx.effect(() => {
    const disposeTools = registerTools(ctx, service)
    return () => disposeOf(disposeTools)
  }, 'oi-knowledge.tools')

  // webServer / connection 只在 Web 宿主里存在；没有也不影响工具
  let admission = null
  ctx.inject(['connection'], (c) => {
    const connection = c.connection
    admission = (headers) => connection.requestRejection({ headers })
  })

  ctx.inject(['webServer'], (c) => {
    c.effect(() => c.webServer.register(createApiRoute(service, () => admission)), 'oi-knowledge.http')
    c.effect(() => c.webServer.register(createAssetRoute()), 'oi-knowledge.assets')
  })
}
