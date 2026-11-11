# dsh-oi-knowledge 只读代码审查报告（第二轮）

- **审查对象**：`dsh-oi-knowledge` @ `065c47c`（v1.3.25，评审主体）＋`706ae72`（v1.3.26，审查期间合入，已增量复核，文中标【706ae72】）
- **审查方式**：只读静态审查，未修改仓库任何文件
- **基线**：上一轮报告 `dsh-oi-knowledge-code-review-2026-11-10.md`（基线 `f1294c0`）
- **规模**：client.js 3936 行、lib/service.js 3542 行、index.js 774 行（706ae72）；其余 lib/*.js 合计约 4500 行；无 lint、无测试、无依赖
- **行号约定**：未标【706ae72】的按 `065c47c`；标注的按 `706ae72`。v1.3.26 对 service.js 的插入使其行号整体下移 23～88 行，定位时以函数名和代码片段为准。

---

## 一、结论摘要

1. 上轮 **2 个 P0 已全部修复**；8 个 P1 中 5 个完全修复、3 个部分修复。
2. 本轮新发现 **5 个 P1**：1 个必现崩溃、1 个新装即失效的功能、1 个可能清空整个知识库的数据安全缺陷、1 个会覆盖已有中文题面的数据丢失路径、1 个随 706ae72 引入的翻译队列持久化缺口。
3. 结构性主因很集中：**同一份契约/遍历/统计被手抄了 3～4 份**，且工程上没有 lint/test 兜底。`findObsNode` 这种裸调用崩溃，`no-undef` 一条规则就能拦住。
4. 706ae72 把「本地已译池秒回」改成「实时抽题 + 翻译排队」，方向可行，但落地留下了死代码（`localPool`）、只写不读的 `quizShown`、不持久的 `translateQueue` 和 9s 超时不取消的翻译，说明这段改动缺测试与端到端验证。
5. 建议先修 P1（都是小改动），再按「action 注册表 → service 拆分 → 统计口径统一 → client 拆分」做结构治理；不要先动算法。

| 级别 | 数量 | 说明 |
| --- | --- | --- |
| P1 | 5 | 崩溃 / 功能失效 / 数据安全 |
| P2 | 11 | 正确性边缘、性能、契约不一致 |
| P3 | 18+ | 死代码、格式、重复实现、可维护性 |

---

## 二、P1（建议发布前修复）

### P1-1 `oi_train card` 带 `node` 参数必崩：`findObsNode` 裸调用

`findObsNode` 只作为 class 方法存在（`065c47c` 的 `lib/service.js:526`；`706ae72` 的 `lib/service.js:549`），其他调用点都写 `this.findObsNode`（`lib/service.js:642`、`1002`、`1013`；`706ae72`：`665`、`1025`、`1036`），但 `trainCard` 里写成了裸函数（`706ae72` 中行号已到 `lib/service.js:2813`）：

```js
// lib/service.js:2810-2816（706ae72）
let nodeId = null
if (input.node) {
  const found = findObsNode(kb, input.node)
  if (!found) fail(`找不到观察节点「${input.node}」，先用 oi_kb action=tree tree=obs 看路径`)
  nodeId = found.id
}
```

- **触发**：`oi_train { action: 'card', kind: 'pattern', node: '观察/...' }`
- **结果**：`ReferenceError: findObsNode is not defined`，工具直接报错；数据无损。
- **根因**：没有 `no-undef` 检查；注释里写的「先看路径」提示也拿不到执行。
- **修复**：改成 `this.findObsNode(kb, input.node)`，并补一条回归测试。

> 这是本轮最典型的「结构问题导致正确性问题」：方法的 `this` 依赖没有在类型/lint 层表达出来。

### P1-2 新装后 seed 出的观察句式闪卡永远为 0（字符串 pattern 与对象 pattern 混用）

新建观察节点时，`patterns` 直接把字符串塞进库：

```js
// lib/service.js:363（706ae72）
patterns: [...(spec.patterns || [])],
```

但读取句式卡时只认对象：

```js
// lib/service.js:2368 起（706ae72；065c47c 为 2349-2351）
;(node.patterns || []).forEach((pattern, index) => {
  if (!pattern || !pattern.text) return
  cards.push({ cardId: ..., nodeId: node.id, nodePath: chain, pattern })
})
```

而 `store.mutate()` 不调用归一化（`lib/store.js:385-397`），`normalizeNode()` 只在加载时把字符串转成对象（`lib/store.js:108-112`）。于是一条链路变成：

1. 新装 → `oi_kb action=seed`：`seedObservationTree` 建节点，`patterns` 是字符串数组（`lib/service.js:332-346`），同进程内不会归一化。
2. `oi_train action=card kind=pattern`：`patternCards` 用 `!pattern.text` 跳过所有字符串 → `cards=[]` → 报「观察树还没有句式」。
3. 重启插件后重新加载，字符串才被 `normalizeNode` 转成对象，功能「自己好了」。

服务端 `cardStats` 还会按 `cardId` 去 `training.reviews` 查记录（`lib/service.js:2336-2343`），所以同一张句式卡在重启前后的「已复习次数」也会断档。客户端对字符串 pattern 做了兼容（`client.js:1739`、`1778`），所以面板显示正常，问题只在闪卡侧，更隐蔽。

- **修复**：抽一个 `normalizePattern(textOrObject)`（`store.js` 已有同样的映射逻辑，把它导出复用），在 `seedObservationTree` 创建/更新时统一转对象；`patternCards` 用现成的 `patternText()` / `patternVerified()` 兼容两种形态，双保险。
- 这与 `patternText`/`patternVerified` 的存在是矛盾的——说明设计上本来就打算兼容字符串，只是写入侧漏了归一化。

### P1-3 损坏的 `kb.json` 被静默当成空库，下一次写入会覆盖原文件

```js
// lib/store.js:353-372
load() {
  let raw = null
  try {
    raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
  } catch (error) {
    if (error && error.code !== 'ENOENT') { /* 备份 <file>.broken-<ts> */ }
    raw = null            // ← 注释写「坏文件不静默丢弃」，实际仍然静默降级
  }
  this.cache = normalizeKb(raw)
  return this.cache
}
```

```js
// lib/store.js:374-383：write 不区分「加载失败」
write() {
  const kb = this.cache
  if (!kb) return
  ...
  fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
  fs.renameSync(tmp, this.file)
}
```

- **触发**：`kb.json` 半截写入、手工编辑出错、跨版本字段损坏等。插件启动不报错，UI 显示空知识库。
- **后果**：只要用户做任意一次写操作（seed、录题、训练、同步），`mutate` 就会把空库写回 `kb.json`。备份文件存在，但没有在 UI/工具返回里提示，普通用户不会去找。
- **修复**（三选一，建议前两条都做）：
  1. `load()` 记录 `this.loadError`，`write()` 在 `loadError && file exists` 时拒绝写入并报「数据文件损坏，已备份到 X，请修复后重启」；
  2. 自动从最近的 `.broken-*` 备份恢复（或进入只读模式），并让 `status()`/面板显式展示健康状态；
  3. 写前比较 `this.cache` 是否为空库且原文件非空 → 拒绝。

### P1-4 `repairQuizStatements` 翻译失败时用空串覆盖已有中文题面

```js
// lib/service.js:2738-2748（706ae72；065c47c 为 2650-2658）
const statementZh = await sync.translateToChinese(statement.slice(0, 2400))
const titleZh = problem.titleZh || (await sync.translateToChinese(problem.title || problem.key))
if (statementZh) translated += 1
this.mutate((target) => {
  const entity = target.problems.find((item) => item.id === problem.id)
  if (!entity) return
  entity.statement = statement
  entity.statementZh = statementZh   // ← 失败时是 ''
  entity.titleZh = titleZh
  ...
})
```

- **触发条件**：题目 `statement` 很短（`<80`，因此进入 `todo`）但已有中文 `statementZh`；`translateToChinese` 所有通道失败返回 `''`。
- **后果**：该题已有的中文题面被清空。翻译渠道越不稳定，越容易踩。
- **修复**：只有 `statementZh` 非空才赋值；失败项进 `failed`，不要污染既有数据。同类问题也检查 `titleZh`（当前至少用 `||` 保留了旧标题）。

### P1-5【706ae72】`translateQueue` 不持久化：重载后 pending/apply_zh 静默失效

`sampleQuiz` 把没译出来的题写进 `kb.training.translateQueue`（`lib/service.js:2563-2573`），面板也提示「已排进翻译队列」。但队列：

- 不在 `emptyKb()` 的 training 里（`lib/store.js:78` 只有 `reviews/attempts/sessions/quizShown`）；
- 不在 `normalizeKb` 重建 training 的字段里（`lib/store.js:261-312`）。

`KbStore.mutate` 只写不归一化，而 `load()` 每次都走 `normalizeKb`（`lib/store.js:353-371`）。于是插件一重载，内存里的队列被丢掉；下一次任何写操作再把它从 `kb.json` 里抹掉。

- **触发**：抽一批题 → 有题没译出 → 重载插件（重启 DSH / 更新插件；面板「刷新」不会重载）。
- **后果**：`oi_train action=pending` 返回「队列是空的」，`apply_zh` 也无队列可删；题目还在（英文题面存着），但「排队等模型翻译」这条新流程断了，且没有任何提示。
- **修复**：`emptyKb`/`normalizeKb` 增加 `translateQueue`（去重、限长，如 200）；测试补「写队列 → 落盘 → 重载 → pending 仍有题」。

---

## 三、P2（正确性与性能）

### P2-1 训练轮次有两套口径：提交时按「全部 attempts」算，判分时按「未判分 attempts」算

```js
// lib/service.js:2886（706ae72；065c47c 为 2798）
round: (kb.training.attempts || []).filter((item) => item.problemKey === problem.key).length + 1,
```

```js
// lib/service.js:2950-2955（706ae72；065c47c 为 2857-2868）
let start = 0
attempts.forEach((item, index) => {
  if (item.problemKey === problem.key && item.result) start = index + 1
})
const pending = attempts.slice(start).filter((item) => item.problemKey === problem.key).length
return Math.min(2, pending + 1)
```

第一次提交被判 miss 后，再提交一次，`trainAttempt` 会给出 `round=3`，摘要显示「第 3 轮」，而 `trainJudge` 只认 1/2 轮。训练统计与 UI 都会出现「第 3 轮」。

**修复**：抽 `currentRound(kb, key)` 一处实现，`trainAttempt` 用 `Math.min(2, pending+1)`，摘要不要直接展示未 clamp 的字段。

### P2-2【706ae72】实时抽题：本地池是死代码、逐题写盘、串行 9s 翻译

```js
// lib/service.js:2409-2419
// 面板点「换一批」：走实时抽题。本地已译池只作为网络失败时的兜底。
const localPool = kb.problems.filter(...)
```

`localPool` 算完后从未被使用（全文件仅此一处定义），注释承诺的「网络失败兜底」并不存在：AtCoder/CF 两个池都拉不到时直接 `fail`（`lib/service.js:2458-2460`），即使池里已有几十道译好的 quiz 题。这是 065c47c「本地池秒回」逻辑被替换后的残留。

其余实时抽题的成本问题：

- `wanted = size * 3`（`2464`），逐题 `fetchAtCoderTaskBundle`（题面 + 题解两次请求），每题最多 3 次串行 `translateFast`（题面 `2484`、题解 `2485`、标题 `2486`），单次上限 9s；`size=3` 时最坏 80s+，面板没有超时，用户只看到「正在准备题目…」。
- 每道题调一次 `this.addProblem`（`2492`、`2530`）→ N 次全量 `JSON.stringify` + 磁盘写，各自失效一次 analysis 缓存。应收集后一次 `mutate`。
- `translateFast`（`lib/service.js:45-63`）用 `Promise.race` 到 9s 就返回 `''`，但不取消底层 `sync.translateToChinese`；超时后请求继续跑、继续占用 provider 配额。
- `quizShown` 只写（`2566`）。抽题过滤用 `known = 全部 kb.problems`（`2407`），已在库的题永不再抽，3 天窗口（`2412`、`2418`）实际不起作用；客户端「自动跳过做过的和已在池里的」文案也因此变成「跳过池里所有题」。

### P2-3 `syncAccount` 的 await 之后 `entity` 可能不存在

```js
// lib/service.js:1855-1862
this.mutate((target) => {
  const entity = this.findAccount(target, account.platform, account.handle)
  entity.lastSyncAt = ...      // ← 同步期间账号被删 → TypeError
  entity.lastResult = ...
})
```

网络同步可能几十秒，用户此时删除账号就会 500。修：`if (!entity) return`。同时 `attempted` 只重建 `account.platform` 桶（`1857-1859`），洛谷镜像到 CF/AT 的旧 attempted 不会被清，跨平台口径会残留。

### P2-4 `findAccount` 空 handle 是通配，`syncAccount` 可能误同步第一个账号

```js
// lib/service.js:1684-1687
findAccount(kb, platform, handle) {
  const wanted = String(handle ?? '').trim().toLowerCase()
  return kb.accounts.find((account) => account.platform === platform && (wanted === '' || account.handle.toLowerCase() === wanted))
}
```

`removeAccount` 已在 `1748-1752` 拦住空 handle，但 `syncAccount` 走同一条路径：`oi_account action=sync platform=codeforces`（不带 handle）会静默同步该平台第一个账号。另外 `1779` 无 platform 时用大小写敏感的 `item.handle === input.handle`，与 `findAccount` 的 `toLowerCase` 两套匹配。建议：`findAccount` 空 handle 返回 `null`，把「批量/第一个」做成显式参数。

### P2-5 `recommend` 的 limit 没有下限，且返回数可能小于请求数

```js
// lib/service.js:2058-2067
const wanted = Math.min(Number(input.limit) || 10, 30)
const picked = []
...
limit: Math.min(wanted + exclude.size, 30),
items: picked.slice(0, wanted),
```

`limit=-1` 时 `wanted=-1`，`slice(0,-1)` 返回除最后一条外的全部题；`exclude` 较大时 `wanted + exclude.size` 也会误导客户端。建议 `clampLimit(v, 1, 30, 10)` 一处实现，`recommend`/`weak`/`sample` 共用。

### P2-6 统计口径三套：quiz/sample 有时排除、有时不排除

| 位置 | 行为 |
| --- | --- |
| `lib/analysis.js:157-158` | 只 `if (problem.pool === 'quiz') continue`，**sample 题的洞察仍进 insightMap** |
| `lib/analysis.js:183-190` | `linkedMap` 完全不过滤，节点详情的「关联题目」会把训练题算进去 |
| `lib/analysis.js:81`、`442-455`、`467`、`487` | overview 统计同时排除 sample + quiz |
| `lib/service.js:3295-3305` | `obsAssigned` / `keyObservations` / `obsUnassigned` 不过滤 quiz/sample |
| `lib/service.js:1889` | report 的「无精髓题目」统计含 quiz/sample |
| `lib/service.js:574` | `showObsNode` 的 rows 含 quiz/sample，而 `obsUnassigned`（`1469`）排除 |

后果：训练池会虚高知识点覆盖与「未归类观察」，弱点/推荐方向被污染。建议在 `problemFeatures`/统计入口统一一个 `isTracked(problem)` 谓词（`pool !== 'quiz' && !sample`），所有聚合只走它。

### P2-7 索引每次重建，多个入口退化为 $O(N^2)$

`lib/tree.js:12` 的 `nodeIndex()` 每次调用都重建 Map，而 `pathOf`（`32`）、`ancestorIds`（`45`）各自再调一次：

- `lib/service.js:478-490` `tree()` 用 `kb.nodes.find(...)` 逐行判断，$O(N^2)$；
- `lib/service.js:3319-3328` `problemDetail` 每个 node id 做一次 `find` + `pathOf`，$O(n^2)$；
- `lib/service.js:3265-3271` 每个观察节点向上 `kb.obsNodes.find` 拼 path，$O(N \cdot d)$；
- `lib/analysis.js` 的 `targetNodes` 每题重建索引、`ancestorIds` 每个节点重建；
- `lib/service.js:242` `isAncestorOf` 在 `ensureTaxonomy` 里每 tag 调一次（`O(T \cdot N)`）。

**修复**：引入一次性上下文 `buildIndex(kb)`（nodeMap、children、path、obs 链），在 `state()`/`tree()`/`problemDetail()`/`analysis` 单次请求内复用；`pathOf/ancestorIds` 接受可选 index 参数。缓存键可以用 `store.revision`，避免跨请求失效问题。

### P2-8 `weakProblem` 串行抓取最多 10 道 AtCoder 题，120s 超时风险

```js
// lib/service.js:2223-2251
const want = Math.max(1, Math.min(10, Number(input.candidates) || 6))
...
for (const pick of picked) {
  ...
  bundle = await sync.fetchAtCoderTaskBundle(pick)   // 题面 + 题解，两次 HTTP，串行
```

即使最终只返回 1 道，也会把抽到的每道 AtCoder 题抓一遍（最多 10 道 × 2 请求，每请求超时 20s + 重试），`oi_kb` 的工具超时是 120s，网络差时必然超时。建议：

- 并行抓取（`Promise.allSettled`，并发上限 3）；
- 或先只用标题/CF 标签粗排，只对 top 3 抓题面；
- catch 里的空文本可以加「未抓到题面」标记，避免把无标签题当成「无弱点」。

同函数还有：`quantileOf`（`2115`）与 `analysis.quantile` 重复；`collectSolved` 调两次（`2111`、`2167`）；`node.cfTags` 循环（`2148-2151`）是死代码——`cfTags` 从未被写入（见 P3）。

### P2-9 同步抓取：HTML 实体解码不全 + `$$$` 粗暴替换

- `lib/sync.js:336` `htmlToText` 只解 `&nbsp; &lt; &gt; &amp; &quot; &#39;`，CF 题面常见的 `&le;`、`&ge;`、`&ne;`、数字实体（`&#8804;`）会原样残留，直接进知识库。
- `lib/sync.js:431` 起把 `$$$` 全替换成 `$`，遇到本来就含 `$` 的公式会破坏定界符。
- `lib/sync.js:402` `divider + 17` 是魔法数，应写 `'<hr class="mt-1">'.length`；`12000/16000/24000` 等切片常量散落在函数里。
- `lib/sync.js:512` 洛谷 `C3VK` 每次从 `baseCookie` 重建，旧 cookie 里的 `C3VK` 会丢；`608` 内层 `const uid = \`${platform}:${key}\`` 与外层数字 `uid` 同名遮蔽，建议改名 `itemId`。

### P2-10 客户端：错误语义与链接兜底

- `client.js:2841` 平台徽标把非 CF/AT 一律显示成 `LG`，`other` 平台会被误标；服务端 `addProblem` 不校验 platform（`normalizePlatform` 对未知值只是转小写），前端下拉不是可靠的防线。
- `client.js:3267-3268` `touchProblem` 只按 `key` 找题，找不到时默认拼 AtCoder 链接；从组卷器粘贴的 CF/洛谷题号会打开错误站点，也会在 `state.problems` 里同 key 跨平台时选错。
- 【706ae72】`client.js:3376` 说「中文题意已经排进翻译队列，稍后点右上角『刷新』就能看到」——刷新只重拉 `state`，不会触发翻译；真正能补中文的是 `pending` + 模型 `apply_zh`，或点「再试一次自动整理」走 `repair`。这句文案会让主人一直刷新却看不到中文。
- `client.js:2751-2783` 题目详情用裸 `fetch` 手写了一套错误文案，与 `call()` 的错误处理重复；用了 `cancelled` 标志但没有 `AbortController`，请求不会真正取消。保存走的是 `call`（`2807`），这部分是对的。
- `client.js:843` `MathText` 的 `memoComponent` 比较器忽略 `style`，主题/尺寸变化时可能不重渲染。

### P2-11【706ae72】`apply_zh` 假成功：中文太短也出队并计入 applied

```js
// lib/service.js:2669-2674
const zh = String(entry.zh || '').trim()
if (zh.length >= 20) problem.statementZh = zh
if (entry.titleZh) problem.titleZh = String(entry.titleZh).trim()
problem.updatedAt = nowIso()
queue.delete(ref)
applied += 1
```

- 少于 20 字的中文（或空串）不写入，但题目仍被移出队列、`applied` 仍 +1，工具返回「已回填 N 道」。
- `ref` 在库里找不到时只进 `missing`，不从队列删除（`2665-2667`）→ 队列残留，`pending` 永远再返回它。
- **后果**：模型回填一句短中文时，题面仍是英文、队列已清、提示成功，用户刷新看不到中文且无法再用 `pending` 找回（只能 `repair` 全量重翻）。
- **修复**：`zh` 不达标时不删队列、不计入 `applied`，返回 `rejected: [{ ref, reason }]`；`missing` 的 ref 也从队列移除或单独标记。

---

## 四、P3：规范性、死代码与冗余

### 4.1 死代码（可直接删，或补上调用）

| 位置 | 内容 |
| --- | --- |
| `lib/observation.js:817-849` | `OBS_INDEX`、`obsIndex()`、`obsDepth()`、`obsPatternCount()` 全部无调用 |
| `lib/sync.js:121` | `fetchCodeforcesSolved` 无引用（`fetchCodeforcesActivity` 已取代） |
| `lib/service.js:2413` | `localPool` 计算后从未使用，注释却承诺「网络失败兜底」（见 P2-2） |
| `client.js:682` | `richTextNodes` 无调用（只用 `renderRichText`） |
| `lib/service.js:970` | `normalizeInsight` 的 `problemHint` 来自从未传入的 `problem` 参数，永远 `undefined` |
| `index.js:262` | `args.insights && args.insights[0]?.kind`：schema 没有 `insights`，死回退 |
| `lib/service.js:2148` | `node.cfTags`：`tree.js`/`store.js` 支持该字段，但没有任何写入方 |
| `lib/sync.js:12/202/458` | 三份 UA，其中 `202` 与 `458` 逐字相同 |

### 4.2 格式与注释

- `lib/service.js:89`：`function plainMath(text) {  let out = ...` 首行格式坏了。
- `lib/service.js:879-880`、`904-905`：两个方法以 10 空格缩进挂在 class 里，是合并事故痕迹。
- `lib/service.js:2088-2104`：`weakProblem` 前叠了三段 `/** ... */` 旧 JSDoc。
- 【706ae72】`lib/service.js:2703`：`repairQuizStatements` 首行被写成 `async repairQuizStatements() {    const kb = this.kb()`。
- `client.js:3503`：`cards` 数组缩进不齐。
- `index.js` 的工具 description 逐行罗列 action，与 enum、switch 三处重复；`service.uiCall` 的 50 个 `case` 是第四份契约。

### 4.3 重复实现清单（「消除冗长」的主战场）

| 语义 | 出现位置 | 建议 |
| --- | --- | --- |
| 子树/后代展开 | `service.js:547-570`、`684-695`、`1384-1412`；`client.js:1703-1760` | `tree.collectDescendants(kb, id)` 一处 |
| 观察节点计数 | `service.js:574`、`1408-1412`、`1437-1448`、`3239-3263` | `analysis.obsAggregate(kb)` 一处 |
| 分位数 | `analysis.quantile`、`service.js:2115 quantileOf` | 共用 |
| `intervalDays` 映射 | `service.js:2734`、`2780` | 常量 `CARD_INTERVAL_DAYS` |
| 百分比格式 | `formatPct`、`formatPair` 内局部 `pct`、2 处手写 | `fmtPct` 一处 |
| patterns 归一 | `store.js:108-112`、`service.js:332-346` | 导出 `normalizePattern` 复用 |
| 树行构造 | `client.js:1268 FullTreeOverlay`、`1860 TreeTab`、`2178 NodeDetail` | `buildTreeRows(state)` |
| 路径前缀判断 | `service.isAncestorOf`、`client.moveOptions` | 后端返回 `subtreeIds` |
| 观察句式统计 | `service.js:1408-1412`、`1437-1448`、`3239` | `patternStats(patterns)` |
| 维度/分档常量 | `analysis.js:81`、`442-455`、`service.js:1918` | 单一 `LEVELS`/`THRESHOLDS` 模块 |

### 4.4 其他规范问题

- `lib/taxonomy.js` 与 `lib/ideas.js`、`lib/observation.js` 都是纯数据表，占约 2100 行 JS。建议改成 `data/*.json`，`lib/seed.js` 只做加载与校验；这样也方便主人在面板外编辑。
- `lib/ideas.js` 有 4 组别名冲突（斜率优化、归纳构造、DSU on tree、整体二分），`detectNodes` 用 substring 匹配时会同时命中多个节点，自动挂载不确定。要么合并节点，要么给别名加权重/优先级。
- `normalizePlatform`（`service.js:193`）对未知平台返回原文小写；`addProblem` 不走白名单，可以录出 `platform: "foo"` 的题，污染同步桶与客户端徽标。建议统一 `PLATFORMS` 校验。
- `lib/store.js:228` 的 `readBucket` 用普通对象，`handle` 为 `"__proto__"` 时有原型污染风险（本地低危）；`writeCache`（`lib/store.js:420`）的 tmp 名只有 `pid`，并发写同一缓存会撞名。
- `client.js:1427-1461` 每个写操作成功后都 `await reload()` 重新拉整个 `state()`；叠加 `state()` 的 $O(N^2)$ 遍历（P2-7），数据量大时每次点按钮都要等一次全量重建。
- `lib/sync.js:257` `translateToChinese` 把题面静默截到 6000 字；`sampleQuiz` 又只截 2400/2600 字给模型。建议把限制提成常量并在返回值里标记 `truncated`。
- 【706ae72】`lib/service.js:2631-2644`：`pendingTranslations` 摘要里的「队列共 N 道」用的是 `rows.length`（含已有中文的题），与 pending 数不是一回事；客户端「刷新就能看到」也只是重拉 `state`。

---

## 五、结构优化方案

### 5.1 第一步：把「四份 action 契约」收敛成一份注册表

现状：新增一个 action 要同步改工具 description、参数 enum、`index.js` switch、`service.uiCall` switch，以及客户端 `call(...)` 字符串。任何一处漏改都是静默错误。

建议新增 `lib/actions.js`：

```js
export const ACTIONS = {
  oi_problem: {
    timeoutMs: 60000,
    actions: {
      add: {
        summary: '录入题目（含精髓与洞察）',
        schema: { problem: 'string', essence: 'string', insights: 'array' },
        run: (svc, args) => svc.addProblem(args),
      },
      add_insight: {
        summary: '给已有题补一条洞察',
        schema: { problem: 'string', kind: 'string', text: 'string', nodes: 'array' },
        run: (svc, args) => svc.addInsight(args),
      },
    },
  },
  // oi_kb / oi_account / oi_train 同理
}
```

- `index.js` 循环注册：description 由 `summary` 生成，enum 由 `Object.keys(actions)` 生成，`execute` 查表；
- `uiCall(name, input)` 直接 `ACTIONS[group].actions[name].run(this, input)`；
- `service.js` 末尾 120 行 switch、`index.js` 里 4 段巨型 description 一起消失；
- 新增 action 只改一处，客户端可加 `uiCall('actions')` 动态取列表。

预计减少 500～700 行，且消灭「schema 有、switch 没有」这类 bug。

### 5.2 第二步：拆 `service.js`（3542 行 → 8 个 300～500 行模块）

```
lib/service/
  index.js        // OiKbService 门面：构造、kb()/mutate()/analysis()
  accounts.js     // add/list/remove/sync
  problems.js     // add/update/show/list/remove/stuck/classify
  obs.js          // seed/show/tree/patterns/unassigned
  training.js     // sample/repair/cards/attempt/judge/review/grade/sessions/stats
  recommend.js    // weak/similar/novel/recommend/gaps
  state.js        // state/problemDetail/uiCall
  view.js         // formatPct/formatPair/LEVEL_TEXT 等纯格式化
```

`service.js` 只保留薄门面 + 组合。拆分时顺手把 `this.kb()` 的重复调用改成方法内局部变量，把 `O(n)` 查找换成 5.1 的索引上下文。

### 5.3 第三步：统一查询层与统计口径

- `lib/query.js`：`buildContext(kb)` 返回 `{ byId, children, path, obsChain }`，`revision` 作缓存键；`pathOf/ancestorIds/descendantIds` 接受 context。
- `lib/tracked.js`：`isTrackedProblem(p)`（排除 `pool==='quiz'` 与 `sample`），所有统计/关联/推荐走它。
- 观察统计统一由 `analysis.obsStats(kb)` 产出，`service.state`、`showObsNode`、`obsTree`、`obsPatterns` 不再各算一遍。

### 5.4 第四步：拆客户端（3936 行单文件）

```
client/
  index.js      // apply、slots、根组件（~250 行）
  math.js       // MATH_SYMBOLS、mathTokens、autoMathify、renderRichText（~700 行）
  ui.js         // Btn/Field/Select/Card/Bar/Pill（~250 行）
  overlays.js   // WeakPick/FullTree（~350 行）
  tabs/tree.js problems.js training.js weak.js accounts.js
```

单文件带来的问题很具体：`richTextNodes` 死代码没人发现、`MathText` memo 漏依赖、三处树展开各写一遍、inline style 无法复用。拆完后 `CLIENT_BUILD` 从 `package.json` 注入，避免版本号两处维护。

### 5.5 第五步：数据表 JSON 化

`taxonomy.js`（399 行）、`ideas.js`（875 行）、`observation.js`（849 行）合计 2123 行，其中真正的逻辑不到 100 行。改成 `data/taxonomy.json` / `data/ideas.json` / `data/obs.json` 后：

- JS 侧只剩加载、校验（路径唯一、别名不冲突、父节点存在）、seed；
- 主人可以直接在 Obsidian/编辑器里改树；
- 别名冲突可以在加载时直接报错，而不是运行时静默多挂。

---

## 六、测试与工具链（当前完全缺失）

`package.json` 没有 `scripts` 字段，没有 lint、没有测试。这直接导致 P1-1 这种 `no-undef` 级错误进入发布。建议最低成本方案（不引入运行时依赖）：

```jsonc
"scripts": {
  "lint": "eslint .",
  "test": "node --test test/*.test.js"
}
```

`devDependencies` 只加 `eslint`（flat config：`no-undef`、`no-unused-vars`、`eqeqeq`、`no-unreachable`）。测试用 Node 内置 `node:test`，不需要 vitest。

必补的 13 条用例：

1. `seed → state`：`obsNodes[].patterns` 必须是对象，`oi_train card kind=pattern` 返回 >0 张卡（P1-2）。
2. `oi_train card kind=pattern node=...` 不抛错（P1-1）。
3. 损坏 `kb.json` 后启动：`write()` 拒绝覆盖或自动恢复，`status` 报健康状态（P1-3）。
4. 翻译全失败时 `repairQuizStatements` 保留旧 `statementZh`（P1-4）。
5. `trainAttempt` 连交两次：第二次 `round=2`；第三次仍 `round=2`（P2-1）。
6. `removeNode(mode='reparent')`：子节点保留、引用清理只针对被删节点（上轮回归）。
7. `addInsight` 后 `problem.nodes` 含 insight.nodes；`removeInsight` 的预期行为写进测试（当前不回退）。
8. `analysis` 与 `state.overview` 对含 sample/quiz 的数据给出同一组数字（P2-6）。
9. `recommend {limit:-1}` 与 `exclude` 很大时仍返回合法数量（P2-5）。
10. `sampleQuiz` 无宿主 translator 时：返回 `size` 道、英文题面入库、ref 写进 `translateQueue`（P2-2）。
11. 写队列 → 保存 → 重新 `load()`：`pending` 仍能取到同一批 ref（P1-5）。
12. `apply_zh` 收到 `zh: '太短'`：不覆盖题面、不出队、`applied` 不增加（P2-11）。
13. 本地已有译好的 quiz 题、远端题库拉取失败时：按注释承诺回退本地池（P2-2；当前会直接报错）。

---

## 七、上一轮问题复核

| 上轮问题 | 状态 | 证据 |
| --- | --- | --- |
| P0 详情未加载就保存，清空精髓/题面 | ✅ 已修 | `client.js:2794-2812` 仅在 `detail` 存在时按 diff patch |
| P0 `remove` 空 handle 删首账号 | ✅ 已修 | `service.js:1748-1752` 显式报错 |
| P1 seed 覆盖手写别名 | ✅ 基本修复 | 仅在现有为空时写入；但 `seedObservationTree` 的 patterns 转换条件不一致（见 P1-2） |
| P1 reparent 直接挂载被清 | ✅ 已修 | `tree.js:202-230` 只清理 `deleted` |
| P1 `trainCard` 把名字当 id | ❌ 未修且更糟 | 变成 `findObsNode` 裸调用崩溃（P1-1） |
| P1 `addInsight` 不并入 `problem.nodes` | ✅ 已修 | `service.js:1284` 合并 |
| P1 `trainJudge` 历史计数当轮次 | ✅ 已修 | `service.js:2857-2868` 按 pending 计算；但 `trainAttempt` 仍不一致（P2-1） |
| P1 `syncAccount` attempted 不清理 | ⚠️ 部分 | 只重建 `account.platform` 桶（`1857-1859`），镜像平台残留 |
| P1 `gaps` 永远为空 | ✅ 已修 | `buildGaps` 从 `meta.tagMap` 补零 |
| P1 镜像题逐条解析题库缓存 | ⚠️ 部分 | `enrichMirroredProblems` 建了 Map（`880`），`lookupCachedCfProblem` 仍 `Array.find`（`904`） |
| P2 客户端错误语义、$O(n^2)$、三份观察聚合、死代码、无 lint/test | ❌ 仍在 | 本报告 P2-6/P2-7/P3 已逐条列出 |

---

## 八、建议修复顺序

1. **当天可完成**：P1-1（一行）、P1-2（抽 `normalizePattern`）、P1-3（写保护）、P1-4（空值不覆盖）、P1-5（队列进 `normalizeKb`）、P2-1（统一轮次）、P2-4（空 handle 不匹配）。
2. **本周**：P2-2（恢复本地兜底 + 批量写）、P2-5（limit clamp）、P2-3（entity 可能为空）、P2-6（统一 `isTrackedProblem`）、P2-9（实体表）、P2-11（`apply_zh` 真成功才出队）。
3. **结构治理**：action 注册表（收益最大、风险最低）→ service 拆分 → `buildContext` 查询层 → 统计口径统一。
4. **性能与客户端**：`weakProblem` 并行化；client 拆分与数学渲染清理；数据表 JSON 化。
5. **工程保障**：lint + 13 条测试进 CI；之后再谈功能和样式。

---

*本报告只读产出，未修改仓库。行号按开头约定：未标注的基于 `065c47c`，标【706ae72】的基于 `706ae72`。*
