# dsh-oi-knowledge 只读代码审查报告

- 审查对象：`C:\Users\lenovo\Documents\deepseek-harness\default-workspace\dsh-oi-knowledge`
- 审查基线：`f1294c0`（审查期间从 `c07eb46` 前进到 `f1294c0`，工作区干净；关键结论已在新 HEAD 上复核）
- 规模：`lib/service.js` 3,303 行、`client.js` 3,886 行、`index.js` 672 行、`lib/*` 其余约 3,400 行；无依赖、无 lint/test 脚本
- 方法：逐文件通读 + `grep`/`read` 行号复核；只读，未修改仓库任何文件
- 结论：上一轮 P0/P1（commit `29121b3`）大部分确已修复；本轮新发现 **2 个 P0、8 个 P1**，以及一批结构/O(n²)/契约不一致问题。P0 都属于「用户正常操作即可造成数据丢失」，建议优先处理。

## 分级口径

| 级别 | 含义 |
| --- | --- |
| P0 | 数据丢失/静默破坏，或正常 UI 路径必现的严重功能错误 |
| P1 | 用户可见的功能错误、统计失真，有规避方式但容易踩 |
| P2 | 契约/边界/性能/可维护性问题，暂不直接损坏数据 |
| P3 | 风格、文案、死代码、潜在风险 |

---

## 一、P0

### P0-1 详情未加载成功时保存题面，会把精髓/题面/题解清空

- 位置：`client.js:2728-2730`、`2748-2752`、`2776-2782`、`2833`；后端 `lib/service.js:1123-1187`
- 证据：
  - 三个编辑框初始值都是空串：
    ```js
    const [essence, setEssence] = React.useState('')
    const [statement, setStatement] = React.useState('')
    const [solution, setSolution] = React.useState('')
    ```
  - 只有 `GET /api/problem` 成功后才回填（`client.js:2748-2752`）；失败时 `setDetail(null)`，编辑框仍是空串。
  - `saveBody` 无条件把三个字段一起提交：
    ```js
    const result = await call('updateProblem', { problem: problem.id, essence, statement, solution })
    ```
  - 「编辑题面/题解」按钮（`client.js:2833`）不看 `detail`/`detailError`，始终可点。
  - 后端 `updateProblem` 对 `patch.essence !== undefined` 直接 `String(patch.essence)`，空串照写。
- 触发：登录态过期、详情接口 401/403/5xx、网络中断，或详情仍在 loading 时点「编辑题面/题解」再点保存。
- 影响：`essence`、`statement`、`solution` 被永久覆盖为空，无撤销、无备份提示；`hasStatement/hasSolution` 随之变 false，训练出题与相似度都受影响。
- 修法：
  1. `if (!detail) { setDetailError('题面还没读出来，请先重试'); return }`；
  2. 只提交相对 `detail` 发生变化的字段，未改字段不出现在 patch 中；
  3. 详情失败时禁用编辑入口，或先回填 `problem` 里已有的 `essence` 并明确标记「题面未加载」。

### P0-2 `oi_account remove` 可静默删除「第一个账号」，并跨平台删同名 solved 桶

- 位置：`index.js:333-344`（schema 只要求 `action`）、`lib/service.js:1620-1622`、`1682-1696`
- 证据：
  - `remove` 的 schema `required: ['action']`，`handle` 不是必填。
  - `findAccount` 在 handle 为空时返回该平台第一个账号：
    ```js
    const wanted = String(handle ?? '').trim().toLowerCase()
    return kb.accounts.find((account) => account.platform === platform && (wanted === '' || account.handle.toLowerCase() === wanted))
    ```
  - `removeAccount` 删除账号后，遍历**所有平台**的 solved 桶删除同名 handle：
    ```js
    for (const bucketPlatform of Object.keys(target.solved)) {
      if (target.solved[bucketPlatform] && target.solved[bucketPlatform][account.handle]) {
        delete target.solved[bucketPlatform][account.handle]
      }
    }
    ```
  - 只清 `solved`，不清 `attempted`；`collectStruggle` 仍会把该账号的旧「提交未过」计入卡点。
- 触发：`oi_account action=remove platform=codeforces`（不带 handle，schema 允许）→ 删掉第一个 CF 账号及其同步缓存；若另一平台有同名真实账号，其 solved 桶也被连带删除。
- 影响：账号配置与同步缓存静默丢失；统计和弱点分析随之变化，且 attempted 残留会持续污染。
- 修法：`remove` 的 schema 改为 `required: ['action','platform','handle']`；服务层再校验 handle 非空；用 `hasRealAccount` 区分镜像归属，只删属于该账号的桶；同步清 `attempted`。

---

## 二、P1

### P1-1 `seed` 覆盖用户手写别名，与「不覆盖手写内容」矛盾

- 位置：`lib/service.js:343-349`；`index.js:57`
- 证据：只要内置 `spec.aliases` 非空就整体替换：
  ```js
  const nextAliases = [...spec.aliases]
  if (JSON.stringify(node.aliases || []) !== JSON.stringify(nextAliases)) {
    node.aliases = nextAliases
  }
  ```
  `index.js:57` 却写「seed — 首次使用或补齐内置两棵树（幂等，不覆盖手写内容）」。
- 触发：用 `updateNode` 给内置节点加别名，再执行 `oi_kb action=seed`。
- 影响：手写别名丢失，`detectNodes`/弱点关键词召回下降；`seed` 是 README 推荐的补树操作，容易反复触发。
- 修法：合并去重 `[...new Set([...(node.aliases||[]), ...spec.aliases])]`，或仅在空时填充。

### P1-2 `removeNode(mode=reparent)` 文案说「题目挂载保留」，实际直接挂载被清掉

- 位置：`lib/service.js:764-774`、`lib/tree.js:202-233`
- 证据：
  - 摘要写「题目挂载保留」；
  - `tree.removeNode` 的 `deleted` 在 reparent 模式下只含被删节点本身，但引用清理仍会删除 `problem.nodes` 中等于该节点 id 的项——**直接挂在该节点上的题目的挂载被清掉**，只有子节点上的挂载保留。
  - `reparented: subtree.size - 1` 统计的是全部后代，不是「直接子节点」。
- 影响：删除父节点后，直接挂载的题目从统计里消失，用户却被告知保留；`reparented` 数字也误导。
- 修法：reparent 时把被删节点的直接挂载迁移到父节点，或明确提示「直接挂载会清除」并返回清理数量；摘要区分「直接子节点 N 个改挂」。

### P1-3 `trainCard` 用节点名匹配 `nodeId`，筛空后 TypeError

- 位置：`lib/service.js:2582-2594`
- 证据：
  ```js
  const scored = cards.filter((card) => !input.node || card.nodeId === input.node)...
  const picked = scored[Math.floor(Math.random() * Math.min(6, scored.length))]
  const trigger = triggerOf(picked.card.pattern.text)
  ```
  `input.node` 来自工具描述「限定某个观察节点」，用户会传路径/名字；`card.nodeId` 是 id。筛空后 `scored.length === 0`，`picked` 为 `undefined`，随后崩溃。
- 触发：`oi_train action=card kind=pattern node=二分`（名字/路径），或指定一个没有句式卡片的节点。
- 修法：先用 `findObsNode/resolveNode` 把引用转成 id；`scored` 为空时明确 `fail` 或回退全部卡片。

### P1-4 `addInsight` 不把洞察节点并入 `problem.nodes`，统计与 `addProblem` 不一致

- 位置：`lib/service.js:1217-1236` vs `1060-1066`；`lib/analysis.js:111-122`
- 证据：`addProblem` 会把每条洞察的 `nodes` 合并进 `nodeIds`；`addInsight` 只 `entity.insights.push(insight)`，不合并。`analysis.targetNodes` 只读 `problem.nodes + tagMap`，不读 `insight.nodes`。
- 影响：工具提示「挂到 X」，但覆盖率/风险/节点题数不增加；`removeInsight` 反向又不会清 `problem.nodes`，留下无引用挂载。
- 修法：`addInsight` 同步合并 `insight.nodes` 到 `entity.nodes`；`removeInsight` 后重算无其他洞察引用的节点。

### P1-5 `trainJudge` 用历史 attempts 总数推断轮次，第二次训练首次提交就可能直接给真值

- 位置：`lib/service.js:2704-2711`、`2728-2741`
- 证据：
  ```js
  const round = Number.isFinite(Number(input.round))
    ? ...
    : (kb.training.attempts || []).filter((item) => item.problemKey === problem.key).length || 1
  ```
  轮次按该题**历史累计** attempts 计算，不区分场次/轮次；`result = hit ? (round >= 2 ? 'hit2' : 'hit1') : ...`，`revealed = hit || round >= 2`。
- 影响：同一道题第二次训练，首次提交若命中，直接按第二轮 `hit2` 并揭示真值；训练闭环的「两轮内命中」统计失真。
- 修法：按当前 session/最近一次 attempt 的轮次计算，或由调用方显式传 `round`。

### P1-6 `syncAccount` 本次 0 条 attempted 时不清理旧桶

- 位置：`lib/service.js:1784-1788`
- 证据：`if (attemptedItems.length) { ... target.attempted[...] = {} ... }`；空结果时直接跳过。
- 触发：上次同步有未过题，本次接口返回空 attempted（已补过/换账号/接口变动）。
- 影响：旧 attempted 永存，`collectStruggle` 继续计入「卡住」，重同步无法修复。
- 修法：同步成功时总是重建该桶（空也写 `{}`），或删除空桶。

### P1-7 「标签盲区」功能永远为空

- 位置：`lib/analysis.js:519-545`、`lib/service.js:1922-1926`
- 证据：`buildGaps` 只遍历 `solved` 建表，`entry.solved` 至少为 1；而 report 过滤 `gap.solved === 0`。
- 影响：README/报告宣称的「标签盲区（从未通过的 tag）」永远不显示；`index.js:59` 的 gaps 描述也与实现不符。
- 修法：从 CF 题库缓存/全部 tagMap 建全量 tag 表，再减去 solved；或删掉该段与描述。

### P1-8 `enrichMirroredProblems` 每个镜像题都全量解析 CF 题库缓存

- 位置：`lib/service.js:851-871`
- 证据：
  ```js
  for (const item of items) {
    if (item.platform !== 'codeforces') continue
    const cached = this.lookupCachedCfProblem(item.key)   // 每次 readCache + JSON.parse 整个 cf-problemset.json
  }
  ```
  `lookupCachedCfProblem` 每次都 `fs.readFileSync + JSON.parse`，没有索引/缓存。洛谷同步若有数百道 CF 镜像题，就是数百次全量解析，`syncAccount` 120s 超时风险高。
- 修法：一次读出题库建 `Map(key → problem)`，循环内查表；或给 `readCache` 加内存缓存（按 mtime）。

---

## 三、P2（按主题分组）

### 3.1 契约/参数边界

| 位置 | 问题 | 修法 |
| --- | --- | --- |
| `index.js:333-344` | `oi_account remove` 的 platform/handle 非必填（P0-2 的根因） | 按 action 分支校验必填字段 |
| `index.js:72-97` vs `service.addNode:718-737` | schema 暴露 `aliases`，`addNode` 不接收，用户无法新建别名 | 透传 aliases 或删 schema 字段 |
| `index.js:269-286` | `update` 不透传 `titleZh/statementZh/pool/sample`；`add` 也不暴露 `titleZh/statementZh` | 补齐 schema 与 service 契约；i18n 字段目前只能靠外部脚本写库 |
| `index.js:260` | `add_insight` 的 kind 回退只读 `args.insights[0].kind`，忽略其 text | 要么支持数组，要么删掉该回退 |
| `index.js:445` | `args.size || 3` 把合法 0 变成 3（虽然后端 clamp 1-6） | `Number.isFinite` 判断 |
| `lib/service.js:1811` | report `limit` 负数：`Math.min(-5,40)` → `slice(0,-5)` 反向截断，标题显示「最该补的 -5 个」 | clamp 1..40 |
| `lib/service.js:1076`、`1142` | rating 用 `Number()` 无 `isFinite`，非法输入会持久化成 null/NaN | 校验后 fail，或规范化为 null |
| `lib/service.js:1004-1005` | 只对 CF 题号大写；AT/LG 手填大小写不同可重复入库 | 按平台归一化 key |
| `lib/service.js:1012` | tags 只 lowercase，不 trim/去重 | `map(trim).filter(Boolean)` + Set |
| `lib/service.js:1184-1186` | 无字段变更也写 `updatedAt`；摘要用 mutation 前的旧标题 | `applied.length` 才更新，摘要用 entity |
| `lib/service.js:1217-1236` | addInsight 不校验题目是否 quiz（P1-4 同源） | quiz 池禁止加洞察，或明确允许 |
| `lib/service.js:1238-1252` | removeInsight 按 `hit.id` 过滤；历史洞察缺 id 时会删掉所有同空 id 条目 | 用对象身份或索引删除 |
| `lib/service.js:1667-1679` | listAccounts 的「已同步 own 题（含 mirrored 镜像）」文案与 own 不含镜像矛盾 | 用 total 或「自有 X + 镜像 Y」 |
| `lib/service.js:3040-3052` | state 的 quiz 投影缺 `url`，`client.js:3333` 的「打开原题」永远不渲染 | 补 url；statementZh 空时回退 statement |

### 3.2 统计口径

| 位置 | 问题 |
| --- | --- |
| `lib/analysis.js:157-158` | insightMap 只跳过 `pool==='quiz'`，不跳 `sample`；sample 题的洞察仍进节点统计 |
| `lib/analysis.js:183-190` | linkedMap 同时包含 quiz/sample，节点详情会显示训练题 |
| `lib/service.js:1922` / `report` 裸题统计 | quiz 池被算进「没精髓」的裸题 |
| `lib/service.js:1329` vs `3040-3044` | obsTree 只统计 `kind==='observation'`，state 统计所有带 obsNodes 的洞察，面板与树数字可能不同 |
| `lib/service.js:1412` | obsUnassigned 遍历全部 problems（含 quiz） |
| `lib/service.js:660` | `cfTagPool` 无缓存时返回空 Map，节点详情显示「题库共 0 道带此标签」，未区分「缓存未拉取」 |
| `lib/service.js:560` | showObsNode 的等级固定 `rows.length ? 'ok' : 'unknown'`，与真实 level 无关 |

### 3.3 客户端

| 位置 | 问题 | 修法 |
| --- | --- | --- |
| `client.js:1137-1247` | 薄弱题浮层两次请求都失败后 `result` 仍是 `{preparing:true}`，永久「正在准备」，无重试；失败还会 `forgetWeakSeen()` | 加 error 态与重试；仅成功但无 item 才清 seen |
| `client.js:3180-3200` | `trainAttempt`/`trainJudge` 失败仍提示「已记录这轮思路」并清空草稿 | 判返回值，失败保留草稿 |
| `client.js:3202-3208` | `trainReveal` 失败仍提示「已公布真值」并置 `revealed` | 判 result 再置态 |
| `client.js:3223-3227` | 「打开」硬编码 `https://atcoder.jp/tasks/${key}`（正确格式是 `/contests/{contest}/tasks/{task}`），且 `await` 后才 `window.open`，弹窗易被拦 | 用题目 `url`；点击栈内先开窗 |
| `client.js:2043`、`2065-2069` | 只有 `!allNodes.length` 才显示「初始化」；已 seed 算法树但 idea/obs 为空时，文案让点「初始化」却找不到按钮 | 按当前 `treeKind` 判断是否显示 seed |
| `client.js:2839` | 删除题目未 `await`，失败无局部反馈 | await + 禁用按钮 |
| `client.js:2952` vs `2960` | 题意用 `RichLines`，题解用 `MathText`，多行/项目符号排版不一致 | 统一 RichLines |
| `client.js:2959` | `first: !entity.statement` 判断源错，应为 `statementZh` | 改字段 |
| `client.js:2756` | 任意一次 tick 刷新失败就 `setDetail(null)`，已加载正文闪没 | 保留旧 detail，仅置 error |
| `client.js:3449`、`3458` | 覆盖率分母 `nodes-1`/`ideaNodes-1` 假设单根，多根时可显示 5/4、>100% | 后端返回 nonRoot 计数 |
| `client.js:2846` | `C.textDim` 不在调色板，颜色继承正文 | 改 `C.muted` |
| `client.js:2098` | 观察搜索用 `assignments`（直接数）却标「观察 N 条」，树/详情用 `count`（子树） | 统一 `count` 或文案写清 |
| `client.js:1688-1698`、`1725`、`1799` | ObsDetail 子树 while 固定点 O(n²)；句式证据 `direct:true` 被标「本节点」；`slice(0,40)` 与头部统计不一致 | Map 一次 DFS；证据单独标记；补「还有 N 条」 |
| `client.js:2209`、`2432-2440` | NodeDetail 空名称保存静默 return；移动没有「移到根」且不 await | disabled + 提示；加根选项；await 反馈 |
| `client.js:3747`、`3786` | 同步失败是 HTTP 200 + result.ok:false，被当成功绿色 notice；force 全局共享；所有账号共用「同步中」 | 识别业务失败；按账号 loading |
| `client.js:597-605` | `isMathToken` 把单个大写字母也自动数学化（只排除小写 a），「方案 A」会变斜体 | 排除句首大写/非变量场景 |

### 3.4 结构/性能/死代码

1. **巨型文件/函数**：`client.js` 3,886 行单 IIFE；`ProblemDetail` 约 315 行、`TrainingTab` 约 379 行、`WeakTab` 约 287 行、`NodeDetail` 约 326 行、`TreeTab` 约 317 行。`lib/service.js` 3,303 行、60+ 方法，建议拆 `tree-service / problem-service / training-service / account-service / report-service`。
2. **两套 action dispatch**：`index.js` 四个工具的 switch 与 `service.uiCall` 的 switch 重复；建议一张 `{op, handler, schema}` 注册表，工具与 Web 共用。
3. **全量 state + 每次写操作 reload**：`service.state` 返回所有题目/洞察（`2966-2995`），quiz 还带完整题面（`3040-3052`）；`client.call` 每次成功都 `await reload()`（`1432`）。题量上来后每次增删改都传一遍全库，建议按 revision 差量或分页。
4. **O(n²) 热区**：
   - `lib/tree.js:236-249` `searchNodes` 对每个节点调 `pathOf`（每次重建 nodeIndex）；
   - `lib/tree.js:202-233`/`service.showNode` 子树固定点、`frontier.includes`；
   - `lib/analysis.js:111-122` `targetNodes` 每题重建 `nodeIndex`；
   - `lib/service.js:3054-3120` obsNodes IIFE 每层 `kb.obsNodes.find`；
   - `lib/service.js:851-871` 镜像题逐条解析题库缓存。
5. **三份观察聚合/分位数实现**：`analysis`、`service.obsTree`、`state` 各一套；建议抽 `obsStats(kb)`。`quantile` 在 analysis 与 similarity 各一份。
6. **死代码/未用导出**：
   - `lib/observation.js:819-849`：`OBS_INDEX` 从未填充，`obsIndex/obsDepth/obsPatternCount` 全无调用；
   - `lib/analysis.js:561` `nodeStatsFor` 无调用；
   - `client.js:682-702` `richTextNodes` 与 `renderRichText` 重复，仅 `__test` 引用；
   - `client.js:26-27` `KIND_LABEL` 未使用；
   - `client.js:3034` TrainingTab 解构的 `busy` 未使用。
7. **无 lint/test 脚本**：`package.json` 无 `scripts.test`/`lint`；3,300 行核心逻辑没有单测。至少给 `buildObsIndex/compareFeatures/buildGaps/normalizeKb/tree.removeNode` 补纯函数测试。
8. **`lib/store.js`**：`normalizeKb` 忽略 `raw.schema`（未来 schema 2 静默按 1 读）；`readBucket` 用普通对象，`__proto__` handle 可污染原型（本地文件低危）；`writeCache` tmp 名只有 pid，多进程会撞；`mutate` 每次全库深拷贝，写放大。

### 3.5 P3 摘要

- `C.textDim` 不在调色板、调色板命名不统一、`plainMath` 的缩进残渣（`lib/service.js:89`）。
- 三份 UA 常量、`formatPct` 未用、`LEVEL_RANK` 仅 weakProblem 用。
- `plainMath` 全局替换未知 LaTeX 命令会吞反斜杠；`wrapInlineMath` 正则会误包英文缩写，建议白名单。
- `fetchCodeforcesActivity` 的 `solvedAt` 是「最近一次 AC」而非首次；`fetchLuoguSolved` 单页失败静默跳过，建议返回 warnings。
- `fetchAtCoderTaskBundle` 的 contest 回退正则 `key.replace(/_[^_]+$/,'')` 对带连字符比赛错误；editorial 候选 <200 字符时不会回退整段。
- `translateToChinese` 只译前 6000 字符（现已加小片段重试，但长题面仍截断）。

---

## 四、上一轮修复核对（commit `29121b3`）

已确认落地：

- `store.mutate` 异常回滚（`lib/store.js:376-388`）；
- `removeNode` reparent 的引用清理只针对真正删除的节点（`lib/tree.js:202-233`）；
- 统计过滤 `sample`/`quiz`（`lib/analysis.js:32-37`、`78-82`）；
- JSON 解析失败返回 400（`index.js` API 路由）；
- 客户端详情竞态 `cancelled`、KaTeX 重试、闪卡 pending、`busy` 部分按钮；
- `syncAccount` 洛谷镜像按原平台分桶（`lib/service.js:1756-1767`）；
- `addProblem` 的 titleZh/statementZh 入库、quiz 清空挂载、`oi_problem update` 的 URL 校验；
- `limit` 多处 clamp、百分比显示、`trainReview` 回写。

仍未修：C-03（全局 `busy` 单布尔，`client.js:1408-1442`）、M-02（`href` 未校验 scheme，`client.js:1206/2804/3636`）、M-03（`Number(...)||0.3` 吞 0，`client.js:3429`）、M-04（quiz 批次只依赖 `quizList.length`，`client.js:3150-3176`）、M-07（刷新按钮文案依赖 `busy`，但 `reload` 不设 busy）。

---

## 五、建议修复顺序

1. **P0-1/P0-2**（数据丢失）→ 加回归测试：详情失败保存、空 handle 删除。
2. **P1-1/P1-2/P1-4**（seed 别名、reparent 文案与挂载、洞察挂载一致性）。
3. **P1-3/P1-5/P1-6**（训练 crash、轮次、attempted 残留）。
4. **P1-7/P1-8**（标签盲区、镜像题缓存）。
5. **P2 客户端错误语义**（WeakTab、submit/reveal、打开链接、quiz url、初始化按钮）——这些是用户最容易碰到的。
6. **结构拆分与 O(n²) 清理**，每步保持行为不变，先补纯函数测试。

## 六、复核说明

- 审查期间仓库从 `c07eb46` 前进到 `f1294c0`（两个 quiz 翻译修复 commit），`client.js` 行号在 TrainingTab 之后整体后移约 16 行；本报告行号以 `f1294c0` 为准，关键结论已重新 grep 复核。
- `client.js` 的 P0-1 在 `c07eb46` 与 `f1294c0` 上均存在（该 diff 未触碰 ProblemDetail）。
- 所有结论均可通过文中行号直接复核；未运行任何会修改数据的命令，未改动仓库文件。

