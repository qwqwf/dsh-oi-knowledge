# dsh-oi-knowledge 代码审查报告（第三轮）

- **审查对象**：`dsh-oi-knowledge`（C:\Users\lenovo\Documents\deepseek-harness\default-workspace\dsh-oi-knowledge）
- **审查基线**：git `63e30dc`（2026-11-11 00:04:51，`fix(i18n): enforce brief Chinese statements and strip machine-translation boilerplate`），工作树 clean，`package.json` 版本 1.3.32
- **审查方式**：只读静态审查；逐文件通读 + 两路交叉复核（service.js、client.js 分别由独立审查者精读，关键结论再由本人回读核对）
- **只读声明**：本次没有修改仓库内任何文件，没有启动插件、没有调用真实账号同步，也没有运行测试（仓库当前没有测试）
- **行号说明**：审查期间仓库从 `eb2707d` 前进到 `63e30dc`（两次 i18n 提交），`service.js` 由 3654 行增至 3713 行。**本文所有行号以 `63e30dc` 为准**；文件长度：`lib/service.js` 3713 行、`client.js` 3953 行、`index.js` 870 行、`lib/store.js` 446 行、`lib/sync.js` 705 行。

---

## 一、结论摘要

| 级别 | 数量 | 内容 |
| --- | --- | --- |
| P0（崩溃 / 数据丢失 / 安全） | **0** | 上轮两个 P0 均已修复；本轮未发现新的 P0 |
| P1（功能性错误，用户可见） | **3** | 训练重提吞轮次、切页签丢训练状态、反套路推荐结论自相矛盾 |
| P2（正确性隐患 / 超时 / 性能） | **16** | 参数契约、无超时链路、翻译队列、同步抓取、O(N²)、KaTeX 恢复等 |
| P3（规范 / 边界 / 冗余） | **约 30** | 格式残留、未用变量、死代码、文档漂移、缓存策略等 |
| 结构性问题 | **7 项** | service.js 单体化、action 契约双份维护、统计口径多套、数学渲染两套实现等 |

**总评**：数据层（`store.js` / `tree.js`）质量较好，上轮 P0/P1 修复到位，防御性处理（损坏库备份、写前快照、失败回滚）是本项目的亮点。当前主要风险集中在三处：

1. `lib/service.js` 已膨胀到 **3713 行、约 100 个方法**，训练、推荐、同步、统计全部挤在一个类里，重复实现和口径分叉开始增多；
2. 训练闭环（attempt → judge → review）的轮次语义还没有真正收敛，网络失败会把用户推到错误的第 2 轮；
3. 客户端数学渲染存在 **KaTeX + mathTokens 两套实现**，并且自动包公式的空白处理与 CSS margin 叠加，公式间距仍不均匀。

---

## 二、上轮问题复核

上轮报告：`dsh-oi-knowledge-code-review-2026-11-10.md`（round1）、`dsh-oi-knowledge-code-review-2026-11-10-round2.md`（round2）。

### 2.1 round1

| 编号 | 问题 | 状态 | 当前证据 |
| --- | --- | --- | --- |
| P0-1 | 详情未加载成功时保存题面会清空精髓/题面/题解 | ✅ 已修 | `client.js:2801-2808`：无 `detail` 时直接拒绝保存，且只 patch 改动字段 |
| P0-2 | `oi_account remove` 可静默删第一个账号并跨平台删同名 solved 桶 | ✅ 已修 | `lib/service.js:1832-1853`：强制 handle；按 handle 清理，且跳过仍有真实账号的平台 |
| P1-1 | `seed` 覆盖手写别名 | ✅ 已修 | `seedObservationTree`：别名取并集，不再整体覆盖 |
| P1-2 | `removeNode(reparent)` 文案与实际不符 | ✅ 已修 | `lib/service.js:865` 起：reparent 时把直接挂载的 problem/insight 节点重映射到父节点 |
| P1-3 | `trainCard` 用节点名匹配后 TypeError | ✅ 已修 | `lib/service.js:2992-2995`：`findObsNode` 结果判空后才取 `.id` |
| P1-4 | `addInsight` 不把洞察节点并入 `problem.nodes` | ✅ 已修 | `lib/service.js:1367-1369`：`entity.nodes` 取并集 |
| P1-5 | 用历史 attempts 总数推断轮次 | ⚠️ 部分修复 | 已改为 `pendingRound`（`lib/service.js:300-308`），但「judge 失败后重提」路径仍错，见本轮 P1-1 |
| P1-6 | 同步 0 条 attempted 不清旧桶 | ✅ 已修 | `lib/service.js:1956-1971`：成功路径重建 attempted 桶；镜像平台占用判断也已加上 |
| P1-7 | 「标签盲区」永远为空 | ✅ 已修 | `lib/analysis.js:533-536`：先按 `tagMap` 补零，再由 solved 覆盖 |
| P1-8 | `enrichMirroredProblems` 每个镜像题全量解析题库缓存 | ✅ 已修 | `lib/service.js:964-972`：一次 `readCache` 建 `Map`；但 `lookupCachedCfProblem` 仍逐条读，见 P3 |

### 2.2 round2

| 编号 | 问题 | 状态 | 当前证据 |
| --- | --- | --- | --- |
| P1-1 | `oi_train card` 带 `node` 必崩 | ✅ 已修 | `lib/service.js:2992-2995` 判空 |
| P1-2 | 新装 seed 的观察句式闪卡恒为 0 | ✅ 已修 | `patternText`（`lib/service.js:291-293`）兼容字符串/对象；seed 合并逻辑已按对象项判断 |
| P1-3 | 损坏 `kb.json` 被静默当空库并覆盖 | ✅ 已修 | `lib/store.js` `load()`：坏文件备份为 `kb.json.broken-<ts>`，置 `loadError`，`write()` 拒绝写坏库 |
| P1-4 | `repairQuizStatements` 翻译失败用空串覆盖中文 | ✅ 已修 | `lib/service.js:2918-2926`：只有非空译文才写入 |
| P1-5 | `translateQueue` 不持久化 | ✅ 已修 | `store.js:78/314` 持久化；`service.js:2717/2832` 读写；重载后 `pending`/`apply_zh` 可用 |
| P2-1 | 训练轮次两套口径 | ⚠️ 部分修复 | judge 用 `pendingRound`（`3127`），但 `trainReview` 仍默认 round=1（`3180`） |
| P2-2 | 实时抽题本地池死代码、逐题写盘、串行翻译 | ⚠️ 部分修复 | localPool 兜底已接回（`2523-2529`）；逐题 `addProblem` 仍每道一次全量写盘 |
| P2-3 | `syncAccount` await 后 entity 可能不存在 | ✅ 已修 | `lib/service.js:1954-1955` 判空后提前返回，不再写 `entity.lastSyncAt` |
| P2-4 | `findAccount` 空 handle 通配可误同步第一个账号 | ❌ 未修 | `lib/service.js:1768-1770` 仍保留 `wanted === ''` 通配（当前外部入口大多已挡空，属潜在隐患） |
| P2-5 | `recommend` limit 无下限且返回数可能更少 | ⚠️ 部分修复 | `2171` 已 clamp(10,30)、`2180` filter+slice；但 `2174` 的 `Math.min(wanted + exclude.size, 30)` 仍可能取不满 |
| P2-6 | 统计口径三套 | ❌ 未修 | `state()`（3354 起）、`report()`（1992 起）、`analysis()` 各自维护统计/子树聚合 |
| P2-7 | 索引每次重建导致 O(N²) | ❌ 未修 | `analysis.js:111` `targetNodes` 每次建索引；`analysis.js:322` 每节点 `kb.nodes.some` |
| P2-8 | `weakProblem` 串行抓最多 10 道题、120s 超时风险 | ❌ 未修 | `lib/service.js:2347-2362` 串行 `fetchAtCoderTaskBundle`；尾部还有无超时翻译（2389） |
| P2-9 | 同步抓取 HTML 实体解码不全 + `$$$` 粗暴替换 | ⚠️ 部分修复 | `lib/sync.js:497` 仍把 `$$$`/`$$` 直接替换成 `$`，破坏 LaTeX |
| P2-10 | 客户端错误语义与链接兜底 | ⚠️ 部分修复 | 保存保护已加；但操作成功仍无条件全量 reload（`client.js:1433-1467`），错误语义仍靠全局 notice |
| P2-11 | `apply_zh` 假成功 | ✅ 已修 | `lib/service.js:2820-2824`：中文 <20 字记 `rejected`、不出队 |

小结：round1 的 2 个 P0、round2 的 3 个 P1 都已落地修复；**残留问题集中在「口径类」而非「崩溃类」**——训练轮次、统计、推荐参数、翻译队列都是同一类毛病：同一个概念在多处各算一遍。

---

## 三、新发现 P1

### P1-1 判定失败后按提示重提，会直接吞掉第 2 轮并公布真值

**位置**：`client.js:3217-3245`（重提逻辑）、`lib/service.js:300-308`（`pendingRound`）、`lib/service.js:3120-3175`（`trainJudge`）

```js
// client.js:3225-3234
const attempt = await call('trainAttempt', { problem: item.key, text, ms }, { silent: true })
if (!attempt) {
  setQuizFeedback({ tone: 'warn', text: '这轮思路没存上（服务端/网络错误），文字还在输入框里，再提交一次。' })
  return
}
const judge = await call('trainJudge', { problem: item.key, text }, { silent: true })
if (!judge) {
  setQuizFeedback({ tone: 'warn', text: '思路已记录，但判定没返回，稍等一下再提交一次。' })
  return
}
```

```js
// lib/service.js:300-308
function pendingRound(kb, problemKey) {
  const attempts = (kb.training && kb.training.attempts) || []
  let start = 0
  attempts.forEach((item, index) => {
    if (item.problemKey === problemKey && item.result) start = index + 1
  })
  const pending = attempts.slice(start).filter((item) => item.problemKey === problemKey).length
  return Math.min(2, pending + 1)
}
```

**触发**：`trainJudge` 超时/5xx/返回空，客户端提示「再提交一次」；用户照做。
**后果**：重提会先再发一次 `trainAttempt`。第一条 attempt 因判定失败 `result` 仍为 `null`，`pendingRound` 数到 1，第二次提交拿到 `round=2`；`trainJudge` 中 `revealed = hit || round >= 2`，于是无论是否命中都直接公布真值，结果记为 `hit2`/`miss`。第一条 attempt 永远停在 `result: null`，不进统计。
**性质**：一次网络抖动就让训练轮次失效，并污染命中率统计。
**修复**：判定失败时只重试 `trainJudge`，不要重发 attempt；或让客户端持有 `attemptId`，`trainJudge` 按 attemptId 判分并用 `round=1` 重试。更彻底的做法是把「轮次」存进 attempt 本身，而不是每次从历史里推断。

### P1-2 切换页签会卸载训练页，草稿、当前题、计时、场次全部丢失

**位置**：`client.js:1523-1532`（Panel 条件渲染）、`client.js:3082-3104`（TrainingTab 局部状态）

```js
// client.js:1523-1532
: app.tab === 'tree'
  ? h(TreeTab)
  : app.tab === 'problems'
    ? h(ProblemsTab)
    : app.tab === 'training'
      ? h(TrainingTab)
      : ...
const body = h(PanelBoundary, { key: app.tab }, content)
```

**触发**：在训练页写到一半，切去知识树/题目页再切回。
**后果**：`Panel` 只挂载当前 tab，`PanelBoundary` 又按 `app.tab` 强制重挂；`TrainingTab` 的 `draft`、`quizKey`、`quizKeys`、`quizStartedAt`、`session` 全是组件内 `useState`，没有 Store/localStorage 兜底。切回后：草稿消失、当前题换成新随机一批、计时归零、场次快照重置。
**修复**：把这几个状态提升到 `Panel`/Store；或五个 tab 全部挂载、用 CSS 隐藏非当前页（成本更低，但要注意各页 effect 的轮询）。

### P1-3 没有「陌生」候选时仍输出「最终推荐」，且分位文案方向相反

**位置**：`lib/service.js:1696-1708`；对照 `lib/service.js:1640-1641`

```js
// lib/service.js:1696-1703
const best = ranked.recommended[0] || ranked.rows[0]
const dist = calibrate(kb)
const lines = [this.formatRanked(kb, ranked)]
...
if (best) {
  const pct = Math.round((dist.values.filter((value) => value <= best.minSimilarity).length / Math.max(1, dist.values.length)) * 100)
  lines.push('', `最终推荐：**${displayTitle(best.problem)}**（${best.problem.key}...）`)
  lines.push(`- 与库内最像的《...》相似度只有 ...，在你已做题里排前 ${pct}% 的陌生度`)
```

而 `formatRanked` 在推荐列表为空时输出：

```js
// lib/service.js:1640-1641
if (!ranked.recommended.length) {
  lines.push('没有候选低于阈值——这批题对你来说都不算陌生。可以把阈值调高，或换更偏门的一批。')
}
```

**触发**：所有候选题的最近邻相似度都 ≥ threshold（默认 0.3，也可由入参调高）。
**后果**：同一段回复先说「都不算陌生」，紧接着又用 `rows[0]` 兜底输出「最终推荐」，结论自相矛盾；`pct` 统计的是「相似度不高于该题的已做题占比」，越大表示越像、越不陌生，却写成「排前 pct% 的陌生度」，方向也反了。此外同一表达式在 1701 和 1708 各算一遍。
**修复**：`recommended` 为空时不要打印「最终推荐」，只保留 `formatRanked` 的结论；分位改成 `100 - pct`（或文案改为「比 pct% 的已做题更像」）；percentile 只算一次并复用。

---

## 四、新发现 P2

### 4.1 推荐与训练

#### P2-1 `weakProblem` 把 `candidates`（候选题目列表）当抽题数量用

**位置**：`lib/service.js:2336`

```js
const want = clampLimit(input.candidates, 6, 10)
```

`index.js:103` 的契约里，`candidates` 是「候选题目列表（id 或题号）」，供 `similar`/`novel` 使用。这里却交给 `clampLimit` 当数字读：传数组经 `Number(...)` 得 `NaN` → 回退 6，真正表示抽题数量的 `input.limit` 被忽略；传 `candidates: "8"` 又会被当成抽 8 道。模型按契约传候选清单时会被静默丢弃。
**修复**：改成 `clampLimit(input.limit, 6, 10)`；若要支持候选清单，按契约解析数组。

#### P2-2 `weakProblem` 的难度窗口对空串/非数字入参失效

**位置**：`lib/service.js:2231-2232`

```js
const ratingMin = input.ratingMin != null ? Number(input.ratingMin) : ...
const ratingMax = input.ratingMax != null ? Number(input.ratingMax) : ...
```

`!= null` 只挡 `null/undefined`：传 `''` 时 `Number('') = 0`，难度下限被悄悄放开到 0；传非数字字符串得到 `NaN`，后续 `rating < ratingMin || rating > ratingMax` 恒为 false，题目池完全不按难度过滤。该 action 同时经 `/api/call` 暴露，这条路径没有 schema 校验。
**修复**：统一用 `input.ratingMin !== '' && Number.isFinite(Number(input.ratingMin))` 判断，两处共用一个小 helper。

#### P2-3 `weakProblem` 尾部标题翻译无超时，叠在串行抓题之后

**位置**：`lib/service.js:2389`；串行抓题在 `2347-2362`

```js
const titleZh = await sync.translateToChinese(best.pick.title)
```

前面已经串行抓 6-10 道 AtCoder 题面，每一步都可能耗时；最后再 `await` 一个没有任何超时的标题翻译。`oi_kb` 的 `timeoutMs = 120000`（`index.js:112`），这一步会把整个 action 拖到超时。
**修复**：用 `translateFast(title, 15000)` 之类带超时的包装，失败回退英文标题。

#### P2-4 `repairQuizStatements` 兜底翻译无超时，且每道题写一次盘

**位置**：`lib/service.js:2912-2927`

```js
if (!rawZh) statementZh = briefZhStatement(await sync.translateToChinese(statement.slice(0, 2400)))
const titleZh = problem.titleZh || (await sync.translateToChinese(problem.title || problem.key))
...
this.mutate((target) => { ... })
fixed += 1
```

主路径 `translateFast` 有 45s 上限（`service.js:43-63`），超时返回空串后才落到这里；这两行裸调 `sync.translateToChinese`，没有上限。`oi_train` 的 `timeoutMs = 180000`（`index.js:435`），repair 遍历所有题面/中文缺失的题，每道最多 2 次无上限外部调用，题多或通道慢时整单超时。
另外 `2918-2926` 在循环内对每道题调用一次 `this.mutate`，即一次深拷贝 + 一次 tmp/rename 全量写盘，N 道题就是 N 次写盘；`fixed += 1` 在 `entity` 缺失时仍执行（并发 remove 时虚报）。
**修复**：兜底也包一层超时；收集完所有修改后一次 `mutate`；回调返回布尔，按实际写入计数。

#### P2-5 `translateByModel` 多段各自概括、失败段静默跳过，最坏 360s

**位置**：`index.js:799-835`

```js
const source = String(text || '').slice(0, 9000)
const chunks = []
for (let index = 0; index < source.length; index += 1500) chunks.push(source.slice(index, index + 1500))
...
const res = await client.chat.completions.create({ ... signal: AbortSignal.timeout(60000) })
done.push(content)
...
return done.join('\n')
```

`mode='statement'` 时 system prompt 要求「概括成 2-5 句、≤220 字」，但每 1500 字独立调用一次，长题面会得到多段各自概括的拼接，随后 `briefZhStatement` 又截到 320 字——成本和语义都浪费。单段失败被静默跳过，`done.join('\n')` 会把缺段的译文当完整译文返回；最坏 6 段 × 60s = 360s，超过 `oi_problem` 60s / `oi_kb` 120s 的工具超时。
**修复**：先把长题面按语义（或只取前 2400 字）压成一次调用；失败段要么重试、要么整体失败并返回明确标记；总预算设为 45-60s，与 `translateFast` 对齐。

#### P2-6 翻译队列口径不一致、只增不减

**位置**：`lib/service.js:2775`（`>= 80` 判已有中文）、`2821`（`< 20` 判失败）、`2918-2926`（repair 回填）、`1286-1288`（update 回填）、`2832`（只有 `applyTranslations` 出队）

- 「已有中文」用 `statementZh.trim().length >= 80`，「中文太短」用 `< 20`，两个阈值不同；
- `repair` 和 `updateProblem` 回填 `statementZh` 时都不出队，只有 `applyTranslations` 会 `queue.delete(ref)`；
- 队列里的 ref 会越积越旧；`pending` 为空但 `rows` 非空时，`2781` 仍宣称「翻译队列是空的」。

**修复**：抽一个 `MIN_ZH_LENGTH` 常量；所有写 `statementZh` 的路径统一走「写入即出队」的 helper；空态文案区分 `rows.length === 0` 与 `pending.length === 0`。

#### P2-7 `addProblem` 把空字符串 rating 存成 0 分

**位置**：`lib/service.js:1136-1146`

```js
let rating = input.rating ?? null
if (rating !== null && !Number.isFinite(Number(rating))) fail('rating 必须是数字（或留空）')
if (rating !== null) rating = Math.round(Number(rating))
...
if (rating == null) rating = cached.rating
```

`??` 只把 `null/undefined` 当空。`rating: ''` 时 `Number('') = 0` 通过 `isFinite`，最终存成 0 分；0 不是 `null`，`1146` 不会再拿 CF 缓存补难度，`analysis` 的 p75/难度窗口也会被 0 污染。`updateProblem`（`1270-1273`）已经是「空串 → null」的正确口径，两处不一致。
**修复**：`addProblem` 复用 `updateProblem` 的口径（空串视为 null）。

#### P2-8 `trainReview` 轮次默认值与 `trainJudge` 不一致

**位置**：`lib/service.js:3177-3181` vs `3125-3127`

`trainJudge` 不传 round 时用 `pendingRound`（按未判分提交数推断）；`trainReview` 不传 round 时默认 1。人工复核一条已经判过两轮的记录，会被当成第一轮重新记录；两个入口对 round 的默认语义应当一致（或都要求显式传）。
**修复**：`trainReview` 也走 `pendingRound`，或在文档/描述里强制要求 round。

### 4.2 同步与抓取

#### P2-9 `translateToChinese` 兜底只翻前 700 字，却把半截译文当整段返回

**位置**：`lib/sync.js:277-303`

```js
let rest = source.slice(0, 6000)
...
return translateWithMyMemory(source)
```

`translateWithMyMemory`（`247-274`）最多 12 段 × 450 字，段间 200ms、失败段跳过；都不成时只翻前 700 字（`295-298`），却作为整段译文返回。上游 `briefZhStatement` 可能据此生成「前 700 字的概括」，用户看到的中文题意与英文题面不是同一范围。
**修复**：兜底时明确返回「部分译文」标记，或只接受 `>=80%` 覆盖率的译文，否则入队等模型翻译。

#### P2-10 洛谷同步：cookie 用 baseCookie 重建、登录判定不可靠、全量分页无上限

**位置**：`lib/sync.js:604`、`620`、`630-651`

```js
if (next) cookie = cookie ? `${baseCookie}; ${next}` : next
```

用 `baseCookie` 重建会把上一页中间拿到的 `C3VK` 丢掉，并可能重复 `baseCookie`；登录检测用 `body.length < 4000` 判断，页面结构一变就误判；分页按总页数全量抓（4 并发、无页数上限），大账号同步会拖很久。
**修复**：cookie 用增量合并（解析成 name→value 再覆盖）；登录检测找明确的登录态标记；分页加上限（如 50 页）并在达到上限时提示分批同步。

#### P2-11 Codeforces 题面把 `$$$` / `$$` 直接替换成 `$`，破坏 LaTeX

**位置**：`lib/sync.js:497`

```js
text = text.replace(/\$\$\$/g, '$').replace(/\$\$/g, '$')
```

CF 题面用 `$$$...$$$` 表示行内公式、`$$...$$` 表示块级；直接替换会把块级公式降级成行内，且连续替换可能把 `$$$$` 变成空。抓下来的题面再经过 `plainMath`/KaTeX 时公式语义已丢失。
**修复**：按 CF 约定先归一成 `$...$` / `$$...$$`（块级保留双美元），不要无条件单美元化。

### 4.3 数据与性能

#### P2-12 `state()` 每次把全部 quiz 题面塞进响应

**位置**：`lib/service.js:3456-3469`

```js
quiz: kb.problems
  .filter((problem) => problem.pool === 'quiz')
  .map((problem) => ({
    id: problem.id,
    ...
```

面板首屏只需要题号/标题/状态，题面只有点开详情才用；这里每次 `/api/state` 都带上全部 quiz 题的 `statement` 原文与 `statementZh`。refill 几次后载荷线性增长，`sendJson` 只在超过 16KB 时才 gzip，省的是字节数，解析成本还在。
**修复**：`state` 只回 `id/key/title/titleZh/rating/verdict`，题面走 `problemDetail` 或单独接口。

#### P2-13 `analysis` 的索引重建导致 O(N²)

**位置**：`lib/analysis.js:111-122`（`targetNodes` 每次调用都 `nodeIndex(kb)`，在 `solved` 循环里被反复调用）、`lib/analysis.js:322`（每节点 `kb.nodes.some`）、`619-627`（`ancestorTags` 每层 `kb.nodes.find`）

题库上千道、节点上百个时，`report`/`weak`/`recommend` 会明显变慢；这也是上轮 P2-7 未清的部分。
**修复**：`analyze()` 内建一次 `nodeIndex`/`childrenMap`，沿调用链传递；`hasChildren` 直接查 `childrenMap`。

#### P2-14 `sessionFinish` 的 AC 回退只用 key 不用 platform，且场次并发会空指针

**位置**：`lib/service.js:3292-3304`、`3311-3313`

```js
for (const platform of Object.keys(kb.solved || {})) {
  for (const handle of Object.keys(kb.solved[platform] || {})) {
    const entry = kb.solved[platform][handle]?.[key]
```

同一个 key 在 CF/AtCoder 都可能存在（如两位数字题号），这里不校验平台，可能匹配到别的平台的 AC 时间；另外 `targetSession` 在 mutate 内没有判空，并发删除场次时会 TypeError。
**修复**：场次 keys 里存 `platform:key`；或回退时限定题目原平台；`targetSession` 判空后再写。

#### P2-15 `sampleQuiz` / `weakProblem` 的候选池构建逐行重复，且抽题逐道写盘

**位置**：`lib/service.js:2283-2320`（weakProblem）、`2531-2566`（sampleQuiz）

两处都在做 `loadAtCoderResources` / `loadCodeforcesProblemset` + rating 过滤 + solved/known/exclude，各约 35 行，只差最终用途。`sampleQuiz` 后续逐题 `addProblem`，每道一次 `mutate`（深拷贝 + 全量写盘），6 道题就是 6 次写盘。
**修复**：抽 `buildCandidatePools(kb, store, options)`；`sampleQuiz` 在一次 `mutate` 内批量插入。

### 4.4 客户端

#### P2-16 KaTeX 静态资源「200 但内容不是 JS」时永久失败，整场会话公式退化

**位置**：`client.js:721-764`

```js
script.onload = () => {
  katexRuntime.status = window.katex && typeof window.katex.renderToString === 'function' ? 'ready' : 'failed'
  notifyKatexListeners()
  resolve(window.katex || null)
}
```

`onerror` 分支会 `promise = null` 并排 20s 重试；`onload` 分支发现没有 `window.katex` 时只置 `failed`，promise 保留为已 resolve 的旧值。此后 `ensureKatex` 直接返回旧 promise，`MathText` 在 failed 时刻意不调 `ensureKatex`，永远等不到重试。只要静态路由把 `katex.min.js` 回退成 HTML（SPA fallback/错误页 200），整场面板公式退化为纯文本，刷新也无用。
**修复**：`onload` 失败也走同一个 `fail()`：`promise = null` + 复用 `retryTimer`。

---

## 五、新发现 P3

### 5.1 代码规范与格式

| 位置 | 问题 | 建议 |
| --- | --- | --- |
| `lib/service.js:156` | `function plainMath(text) {  let out = ...`：双空格 + 首句并到签名行 | 格式化 |
| `lib/service.js:2869` | `async repairQuizStatements() {    const kb = this.kb()`：同类格式残留 | 格式化 |
| `lib/service.js:963-986` | `enrichMirroredProblems` 声明缩进 10 空格、方法体 4 空格；`988-996` 同样 | 对齐缩进，确认 963 前后没有多/漏方法签名 |
| `lib/service.js:818-820`、`840-843` | `const kb = this.kb()` 未使用；`836` 连续调两次 `this.kb()` | 删除未用变量，提取一次复用（ESLint `no-unused-vars`） |
| `index.js:37-40` | `toolError` 的 `KbError` 分支与兜底分支输出格式相同 | 删除冗余 `instanceof` 分支 |
| `lib/service.js:2201-2216` | `weakProblem` 上方连续叠了 3 段 JSDoc，描述三代实现 | 只留最后一段 |
| `lib/service.js:2626-2631` | `const editorialZh = ''` 恒空，`2644` 的 `solution: editorialZh || bundle.editorial` 永远落回英文；注释却写「题面与题解都翻成中文」 | 删除常量并改注释，或真正翻译题解 |
| `lib/service.js:2927` | `fixed += 1` 在 `entity` 缺失时仍执行，repair 汇总虚高 | 回调返回布尔，按实际写入计数 |
| `lib/service.js:3227-3237` | `trainGrade` 先 `mutate` 写盘，再 `fail`（失败路径也留下一次 revision/updatedAt 变化） | 在 mutate 回调里先判空并 `fail` |
| `client.js:4` | 文件头注释「四个 tab」，实际 `TABS` 五个（`1500-1506`） | 改注释，别写死数量 |
| `client.js:3494-3497` | `threshold: Number(novelThreshold) \|\| 0.3` 把合法阈值 0 吞成 0.3 | 先 `Number`，再用 `Number.isFinite` 判空 |

### 5.2 边界与一致性

| 位置 | 问题 | 建议 |
| --- | --- | --- |
| `lib/service.js:2154` | `gap.medianRating ? ...` 把 0 当无值 | 改 `!= null` |
| `lib/service.js:1757` | `removeProblem` 只删题，不清理 `training.sessions[].keys` 的陈旧引用 | 删除时同步清理，或展示时过滤 |
| `lib/service.js:1725` | `listProblems` 的 query 拼进 title/tags/solution/insights 全文 `includes` | 大库时改为分字段加权或限制字段 |
| `lib/service.js:2174` | `recommend` 用 `Math.min(wanted + exclude.size, 30)` 取候选，exclude 多时仍可能取不满 | 按 `wanted + exclude.size` 实际请求，或循环补足 |
| `lib/similarity.js:63` | `Math.max(1, ...(kb.obsNodes \|\| []).map(...))` 大数组有参数上限风险 | 改 `reduce` 求最大值 |
| `lib/analysis.js:546` | `Math.max(...entry.ratings)` 同样有参数上限风险（单个 tag 题多时） | 同上 |
| `lib/store.js:147/166/198` | 兜底 id `i${index+1}` / `p${index+1}` / `a${index+1}` 可能与 `nextId` 生成的 base36 id 撞车；`normalizeKb` 不去重 | 归一化时统一走 `nextId`，或加去重/冲突重命名 |
| `lib/store.js:230-253` | `readBucket` 用 JSON 里的 `platform` 直接 `out[platform] = {}`；`__proto__` 会改原型、桶被静默丢弃 | 用 `Object.create(null)` 或过滤危险键 |
| `lib/store.js:404-416` | `mutate` 每次写盘都 `JSON.parse(JSON.stringify(kb))` 全量深拷贝，写放大 | 改为结构化 patch 或按 revision 增量写 |
| `lib/sync.js:604` | 洛谷 cookie 用 `baseCookie` 重建，丢中间 `C3VK` | 解析成 name→value 增量合并 |
| `lib/sync.js:620` | 登录检测 `body.length < 4000` 不可靠 | 找明确的登录态节点/字段 |
| `lib/sync.js:162/683` | `WEEK` 常量重复定义 | 抽公共常量 |
| `lib/sync.js` UA 常量 | `ATCODER_WEB_UA` 与 `LUOGU_UA` 内容相同 | 抽一个 `BROWSER_UA` |
| `lib/sync.js:22-48` | `getJson` 无重试/退避 | 对 429/5xx 做一次指数退避重试 |

### 5.3 客户端

| 位置 | 问题 | 建议 |
| --- | --- | --- |
| `client.js:636-659` + `122` | 自动包 `$…$` 时 lead/trail 空白留在公式外，`.oi-katex{margin:0 .3em}` 叠加，公式左侧间距大于右侧 | 生成时丢掉 lead/trail，间距统一交给 CSS |
| `client.js:3161-3170` | `Math.random()-0.5` 有偏洗牌；`unseen < 3` 时先清历史，却仍可能抽到刚做过的题 | Fisher–Yates；先放 unseen 再从其余补足 |
| `client.js:3204-3209` | `nextBatch` 的 catch 是死代码（`call` 内部 try/catch 后 return null，从不 reject） | 删 catch，fallback 抽公共函数 |
| `client.js:682-702` | `richTextNodes` 仅测试引用，生产走 `renderRichText`，两套 code/兜底骨架已漂移 | 删除，或让 `renderRichText` 复用 |
| `client.js:1709-1756` | `ObsDetail` 每次渲染用 `while(grew)` 全量扩散子树（最坏 O(N²)），未 memo | `useMemo`，依赖 `[node.id, state.obsNodes, state.problems]` |
| `client.js:1433-1467` | 任何操作成功都 `await reload()` 全量拉 state，`busy` 期间全面板按钮变灰 | 只在需要时 reload，或服务端回传增量 |
| `client.js:120-123` | 内联公式 `max-width:100%; overflow:visible`，超宽公式画出卡片外 | 内联允许横向滚动，或超长降级为块级 |
| `client.js:3101`、`3296-3305`、`3441-3445` | 交卷后 `session.endedAt` 不写回本地，状态行「已结束」不刷新 | 成功后 `setSession({ ...session, endedAt: Date.now() })`，或从 `state.training.sessions` 派生 |
| `client.js:777/805` | `SEGMENT_CACHE`/`KATEX_HTML_CACHE` 满 2000/500 时 `clear()` 全清（非 LRU） | 用 Map 插入序淘汰最旧条目 |
| `client.js:721-764` | `retryTimer` 成功时未清理；失败态未重置 promise（P2-16 的另一面） | 统一 `fail()`/`ready()` 状态机 |
| `client.js:858-864` | `MathText` memo 只比较 text 与 4 个 style 字段，新增样式不会重渲染 | 依赖列全，或 memo 掉 style 对象引用 |

---

## 六、结构性优化建议

### 6.1 拆分 `lib/service.js`（最高优先级）

现状：**3713 行、约 100 个方法**，`KnowledgeService` 一个类承担工具层、面板 API、训练、推荐、同步、统计、格式化。它是本轮绝大多数 P2/P3 的温床（重复实现、口径分叉、行号漂移）。

建议按领域拆成 6-7 个模块，`KnowledgeService` 只保留 façade 和依赖注入：

| 模块 | 主要方法 | 预计行数 |
| --- | --- | --- |
| `lib/service/tree.js` | addNode/updateNode/moveNode/removeNode/searchNodes/showNode | ~700 |
| `lib/service/observation.js` | showObsNode/obsTree/obsPatterns/obsUnassigned/seedObservationTree | ~600 |
| `lib/service/problem.js` | addProblem/updateProblem/showProblem/listProblems/classifyProblem/insights | ~700 |
| `lib/service/training.js` | trainCard/trainAttempt/trainJudge/trainReview/trainGrade/session* | ~650 |
| `lib/service/recommend.js` | recommend/recommendNovel/weakProblem/similar/calibrate | ~600 |
| `lib/service/account.js` | accounts/syncAccount/enrichMirroredProblems | ~450 |
| `lib/service/report.js` | report/gaps/state/problemDetail/uiCall | ~500 |

拆分时顺手抽公共 helper：`nodePathLabel(kb, id)`、`latestAttempt(kb, key)`、`buildCandidatePools()`、`subtreeStats(kb, ids)`、`MIN_ZH_LENGTH`。这一步不改变行为，但能消掉本报告里约一半的重复实现。

### 6.2 action 契约收敛成注册表

现状：`index.js` 有四个 `switch (action)`（`114-167`、`253-321`、`351-368`、`437-478`），`service.js:3592` 的 `uiCall` 还有约 100 行 1:1 switch；每个 action 的名字同时出现在工具 description、JSON schema enum、switch case 三处。已经出现漂移：`oi_train` 的 enum 有 `probe/pending/apply_zh`（`index.js:399`），description（`375-391`）却完全没写。

建议：单一 `ACTIONS` 表，每项 `{ name, description, schema, handler }`，工具注册、`uiCall` 分发、文档生成都从这张表读；新增 action 只改一处。

### 6.3 统一查询层与统计口径

现状：同一个概念至少两套实现：

- **节点路径**：`nodePathLabel` 逻辑 6 份（addProblem、addInsight、showProblem、state、problemDetail ×2）；
- **观察子树聚合**：4 份（showObsNode、obsTree、report、state）；
- **未归类观察统计**：3 份（obsUnassigned、report、state）；
- **最近一次 attempt**：4 份（pendingRound、trainJudge、trainReview、trainGrade）；
- **百分位**：3 份（analysis.js:18、analysis.js:581 附近、service.js:2228）。

建议：在 `lib/query.js` 里提供 `nodePathLabel`、`subtreeStats`、`latestAttempt`、`percentile`，所有调用方只依赖这一层；`state`/`report`/`analysis` 的统计数字必须来自同一次 `analyze(kb)` 结果。

### 6.4 数学渲染统一

现状：服务端 `plainMath`/`PLAIN_MATH`（`lib/service.js:1-156`）与客户端 `mathTokens`/`MATH_SYMBOLS`/`autoMathify`/`splitMathSegments`（`client.js:300-680`）是两套「LaTeX → 纯文本/公式片段」实现；客户端又有 KaTeX 一条链。三套实现需要同步维护，`eb2707d` 的间距修复就同时改了两边。

建议：抽 `lib/math-text.js`（纯函数、无 DOM），服务端与客户端共用「去标记、包 `$…$`、切片段」；渲染仍由 KaTeX 负责，`mathTokens` 只作为 KaTeX 失败时的兜底，并加单测覆盖 `$` 配对、`$$`、`\(...\)`、代码块。

### 6.5 数据表 JSON 化

`lib/ideas.js`（875 行）、`lib/observation.js`（849 行，其中 800+ 行是 `OBS_TAXONOMY` 数据）、`lib/taxonomy.js`（399 行）都是纯数据。继续用 JS 数组的代价是：无法被数据校验工具检查、diff 噪音大、加载时整表进内存。

建议：移到 `data/*.json` + `lib/data-loader.js`，启动时做一次 schema 校验（路径唯一、父路径存在、别名不重复）；JS 侧只保留查询函数。

### 6.6 客户端按 tab 拆分

`client.js` 3953 行、单闭包，`Panel/TreeTab/NodeDetail/ProblemDetail/TrainingTab/WeakTab/AccountsTab` 全在一个文件。建议拆成 `client/` 目录（每个 tab 一个文件 + `shared/` 放 `MathText`、`useApp`、样式），构建仍是单 bundle；这也会自然解决 P1-2 的状态提升问题（Store 上移）。

### 6.7 测试与工具链

仓库没有测试，也没有 lint 脚本。本轮多个 P1/P2 都是「纯函数 + 状态机」问题，完全可以用 `node:test` 覆盖：

- `store.normalizeKb`：损坏库、重复 id、`__proto__` 键、空串 rating；
- `tree.resolveNode/removeNode`：重名、reparent、环；
- `similarity.buildObsIndex/compareFeatures`：IDF 权重、难度差、空观察；
- `service.pendingRound` + `trainJudge`：重提场景（P1-1 的回归测试）；
- `sync` 的 cookie 合并、`$$$` 归一；
- 客户端 `splitMathSegments/wrapMathSpans` 的纯函数测试（可把数学模块抽出来后在 Node 里跑）。

建议 CI 至少跑 `node --test` + `eslint`（`no-unused-vars`、`no-undef`、`eqeqeq`）。

---

## 七、重复实现清单

| # | 重复项 | 位置 | 建议 |
| --- | --- | --- | --- |
| 1 | 节点 id→路径 | addProblem `1228-1231`、addInsight `1372-1375`、showProblem `1432-1436`、state `3397`、problemDetail `3578-3588` | 抽 `nodePathLabel(kb,id)` |
| 2 | 观察子树聚合 | showObsNode `631-719`、obsTree `1468-1514`、report `1992-2145`、state `3471-3550` | 抽 `subtreeStats` |
| 3 | 未归类观察统计 | obsUnassigned `1553-1600`、report、state | 同上 |
| 4 | 候选池构建 | weakProblem `2283-2320`、sampleQuiz `2531-2566` | 抽 `buildCandidatePools` |
| 5 | 翻译调用 | `2620-2625`、`2907` 重复包装；`2389`、`2914`、`2915` 绕过超时 | 统一 `translateFast` |
| 6 | 最近 attempt | pendingRound `256-264`、trainJudge `3157/3161`、trainReview `3196/3200`、trainGrade `3228-3229` | 抽 `latestAttempt` |
| 7 | 间隔表 | `3002`、`3048` | 抽常量 `REVIEW_INTERVALS` |
| 8 | verdict 校验 / tags 归一 | `1256-1258` 与 `1290-1291`；`1139-1141` 与 `1276-1279` | 各抽一个 helper |
| 9 | percentile | `1701`、`1708` | 算一次复用 |
| 10 | 百分位实现 | `analysis.js:18`、`analysis.js:581` 附近、`service.js:2228` | 保留一份 |
| 11 | `WEEK` | `sync.js:162`、`683` | 抽常量 |
| 12 | UA 常量 | `sync.js` `ATCODER_WEB_UA` / `LUOGU_UA` | 抽常量 |
| 13 | 等级文案 | `client.js:29-37` `MASTERY` 与 `86-94` `LEVEL_LABEL` | 由一份派生 |
| 14 | 页签按钮 | `client.js:1307-1326` 与 `2037-2059` | 抽 `TabButton` |
| 15 | 空状态 | `client.js:1048-1054` `Empty` 与 `2506/3606` 行内写法 | 统一组件 |
| 16 | 平台缩写 | `client.js:2482`、`2847` | 抽 `platformShort()` |
| 17 | 标题兜底 | `client.js:1056-1058` `problemTitle()` 与 `2845` 手写 | 复用 |
| 18 | 时间格式化 | `client.js:3839/3881` | 抽 `formatTime` |
| 19 | 滚动高度 | `client.js:165/2016/2547/3311` | 抽 CSS 变量/常量 |
| 20 | 渲染骨架 | `client.js:682-702` `richTextNodes` 与 `810-839` `renderRichText` | 合并 |

---

## 八、死代码与无用导出

| 位置 | 内容 | 结论 |
| --- | --- | --- |
| `lib/observation.js:817-847` | `OBS_INDEX`、`obsIndex()`、`obsDepth()`、`obsPatternCount()` | 全仓库无调用者 |
| `lib/sync.js:121` | `fetchCodeforcesSolved` 兼容 wrapper | 无导入/调用 |
| `client.js:682-702` | `richTextNodes` | 仅 `__test` 引用，生产走 `renderRichText` |
| `lib/service.js:2627` | `const editorialZh = ''` | 恒空死变量 |
| `lib/service.js:3713` | `export { KbError, fail }` | `index.js` 实际从 `store.js` 导入，疑似无用 re-export |
| `lib/tree.js:262` | `export { KbError }` | 未见使用 |
| `lib/similarity.js` 末尾 | `export { OBS_ROOT }` | 未见使用 |
| `client.js:3204-3209` | `nextBatch` 的 `catch` | 不可达分支 |

---

## 九、文档与契约漂移

| 位置 | 文档说法 | 代码实际 |
| --- | --- | --- |
| `README.md:19/45` | 「三个工具」 | 实际四个：`oi_kb` / `oi_problem` / `oi_account` / `oi_train` |
| `README.md:51` | `oi_kb action=tree level=2` | schema 只有 `depth`（`index.js:95`），没有 `level` |
| `README.md:62` | `recommend count=5` | schema 只有 `limit`（`index.js:97`） |
| `README.md:88` | `nodes="贡献拆分"` 字符串 | schema 是数组（`index.js:222-237` 一带） |
| `README.md:5` | 算法树 74、思路树 108 节点 | `TAXONOMY` 条目 74 ✓；`IDEA_TAXONOMY` 条目 105，已漂移 3 个 |
| `index.js:375-391` | `oi_train` 描述未提 `probe`/`pending`/`apply_zh` | enum（`399`）已有这三个 action |
| `locale/zh.json:6-12` | `panel.weakness` 四页签键 | 客户端实际五个 tab（`weak`/`training`），且 UI 文案全硬编码，locale 未接入 |
| `client.js:4` | 「四个 tab」 | `TABS` 五个 |
| `package.json` | 版本 1.3.32 | 与 README/CHANGELOG 的版本叙述需同步（本轮审查期间版本号从 1.3.30 连跳到 1.3.32，提交说明未体现） |

---

## 十、建议修复顺序

1. **立即（P1）**
   - `client.js` 判定失败只重试 judge，不重发 attempt（P1-1）；
   - 把训练页状态提升到 Store/Panel，或五个 tab 常驻挂载（P1-2）；
   - `recommendNovel` 无推荐时不打「最终推荐」，修 percentile 方向（P1-3）。

2. **本版（P2，按用户可感知程度排序）**
   - `weakProblem`：`candidates` 参数、难度窗口、尾部翻译超时（P2-1/2/3）；
   - `repairQuizStatements`：兜底超时 + 单次写盘（P2-4）；
   - 翻译链路：`translateByModel` 单次概括、失败标记、总预算（P2-5）；队列阈值/出队统一（P2-6）；
   - `addProblem` 空串 rating（P2-7）；`trainReview` 轮次默认（P2-8）；
   - 同步：`translateToChinese` 部分译文标记（P2-9）、洛谷 cookie/登录/分页（P2-10）、CF `$$$` 归一（P2-11）；
   - `state` 精简 quiz 题面（P2-12）；`analysis` 索引复用（P2-13）；`sessionFinish` 平台校验（P2-14）；候选池/批量写盘（P2-15）；
   - 客户端 KaTeX 恢复（P2-16）。

3. **下个版本（结构）**
   - 拆 `service.js`（6.1）；
   - action 注册表（6.2）；
   - 统一查询/统计层（6.3）；
   - 数学模块抽离（6.4）；
   - 数据表 JSON 化（6.5）；
   - 客户端拆 tab（6.6）；
   - 补 `node:test` + ESLint（6.7）。

4. **随手清**
   - P3 表格中的格式、未用变量、死代码、文档漂移；建议单独一个 `chore(review3)` 提交，避免和功能修复混在一起。

---

## 十一、审查方法与局限

- **覆盖范围**：`index.js`、`client.js`、`lib/service.js`、`lib/store.js`、`lib/sync.js`、`lib/analysis.js`、`lib/similarity.js`、`lib/tree.js`、`lib/observation.js`、`lib/taxonomy.js`、`lib/ideas.js`、`README.md`、`locale/*`、`package.json`、`cordis.patch.yml`。
- **方法**：逐文件静态阅读；对训练、推荐、同步、翻译四条主链路做调用链追踪；两路独立审查（service/client）后由本人回读关键行号与片段核对；用 `git log`/`git status` 固定基线。
- **局限**：
  - 没有运行插件，没有真实调用 CF/AtCoder/洛谷/翻译通道，因此超时、限流、页面结构变化类问题只能从代码路径推断；
  - 没有测试可跑（仓库无测试），所有结论均为静态审查；
  - 审查期间仓库有并发编辑（`service.js` 3654→3713、版本 1.3.30→1.3.32），本文行号已按 `63e30dc` 重新核对，但若后续再有提交，行号可能再次漂移；
  - 上轮报告中未在本轮复核表列出的低优先级条目，不代表已修复，只表示本轮没有重新取证。

---

*报告完。本次审查全程只读，未修改仓库内任何文件。*
