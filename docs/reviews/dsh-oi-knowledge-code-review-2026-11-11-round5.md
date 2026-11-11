# dsh-oi-knowledge 代码审查报告（第五轮）

- **审查对象**：`C:\Users\lenovo\Documents\deepseek-harness\default-workspace\dsh-oi-knowledge`
- **基线**：git `8453181`（工作树 clean），package.json `1.3.43`
- **范围**：`0bba837..8453181` 的全部改动（9 文件，+943/−113），加上新功能涉及的现行代码路径
- **方式**：只读审查，未修改仓库；行号均按 read 工具在本基线上的计数
- **回归**：`node dev/regression4.mjs` 通过（19 项，ALL PASS）

## 一、结论

| 级别 | 数量 | 说明 |
| --- | --- | --- |
| P0 | 0 | 无崩溃、无直接数据丢失 |
| P1 | 0 | 无阻断性功能错误 |
| P2 | 9 | 新功能的正确性/契约/超时问题，以及两处上轮未修项 |
| P3 | 18 | 边界、统计口径、健壮性、文档与格式 |
| 结构 | 7 项 | service/client 继续膨胀，模型调用与窗口逻辑重复 |

本轮新增的三级提示（hint）和自动精髓（digest）整体设计是自洽的，`regression4` 覆盖了逐级解锁、跳级、兜底、落盘等主路径，19 项全部通过。主要风险不在主流程，而在**模型输出级别的容错**、**客户端与服务端超时预算不一致**、**高分段评分窗口倒挂**，以及**文档承诺与 schema 可达性不一致**。

## 二、本轮变更与验证

### 2.1 提交

- `326030f feat(training): three-level hint ladder with unlock tracking and zero-hint pass rate`
- `d08b683 perf(hint): generate one level per request, show progress and allow cancel`
- `a13160a fix(hint): longer client patience, larger L3 budget, local fallback when model fails`
- `ef8022d fix(hint): keep partial level caches, cache fetched statement, surface server errors in panel`
- `93372a4 fix(review4): keep manual insights in digest, harden ratings cache, trim state, README sync`
- `bb7ff58 fix(review4): neutral rank for trees without evidence, add npm test script`
- `b69dec9 fix(quiz): keep sampling inside per-platform rating windows (local fallback included)`
- `8453181 chore: move synced service/store/regression files into lib and dev`

### 2.2 规模变化

`lib/service.js` 4475 行、`client.js` 4209 行、`index.js` 954 行、`lib/store.js` 517 行、`lib/sync.js` 760 行；新增 `dev/regression4.mjs` 125 行。

### 2.3 已确认修复（相对第四轮）

- digest 默认跳过已有洞察的题，`overwrite=true` 才覆盖，并先写 `digestBackup`（`lib/service.js:3597-3605`、`3637-3657`）。
- 平台分数缓存进入 `normalizeKb` 白名单，失败条目 10 分钟负缓存、两平台并行拉取（`lib/service.js:3017-3078`）。
- weakProblem 的三棵树合成只计有证据维度，`weakest` 与 `facets` 现在同源（`lib/service.js:2703`、`2731`）。
- sampleQuiz 本地兜底按窗口过滤（`lib/service.js:3117-3123`）。
- state 的 quiz 列表不再下发英文 statement（`lib/service.js:4221`）。
- `pending` 改用 `args.limit`（`index.js:474-475`）。
- 训练重提只重试 judge、切 tab 不再丢状态、场次结算后本地 `endedAt` 立即显示（`client.js:3548-3559`）。
- README 的三棵树/四个工具/105 个思路节点等主要漂移已修。

## 三、上轮问题复核

| 上轮问题 | 状态 | 说明 |
| --- | --- | --- |
| P1 digest 覆盖手工洞察 | 已修 | 过滤条件已改为「无洞察或显式 overwrite」；覆盖前写 `digestBackup` |
| P2 ratings 缓存重启丢失 | 已修 | `meta.platformRatings` 进入归一化白名单，失败 10 分钟 TTL |
| P2 pending 参数用错 | 已修 | 已改为 `args.limit` |
| P2 sampleQuiz 同步 digest 过慢 | 部分修复 | 单题 40s、整次 60s 截止，超时进 `pendingDigest`；仍逐题同步、且 `Promise.race` 不取消底层模型调用 |
| P2 digest 失败只提示不排队 | 未修 | 仍只有 `pendingDigest` 摘要，没有持久化队列 |
| P2 weakProblem 120s 超时风险 | 部分修复 | 手动窗口已跳过 ratings；题面预取与标题翻译仍串行 |
| P2 weak 三处来源不一致 | 已修 | `weakest` 与 `bestFacet` 同源 |
| P2 state quiz 载荷 | 已修 | 已去掉英文 statement，只下发中文简版 |
| P2 翻译管线多段概括/静默丢段 | 未修 | `translateByModel` 仍按 1500 字逐段概括后拼接 |
| P2 KaTeX 加载失败不可恢复 | 未修 | onload 失败后 promise 仍保持已 resolve，重试只在 onerror 注册 |
| P3 finishSession 不更新 endedAt | 已修 | 客户端本地更新 |
| P3 digestBackup 持久化 | 新问题 | 备份字段不在 `normalizeProblem` 白名单，重启即丢 |

## 四、新发现 P2

### P2-1 三级提示可能把“错误级别”的模型输出当成当前级别

- **位置**：`lib/service.js:287-293`
- **代码**：

  ```js
  if (Number(match[1]) === n) { picked = ...; break }
  if (!picked) picked = match[2] ...
  ```

- **问题**：请求 L1 时，如果模型只输出 `L2：...`，循环会在第二行把 L2 文案赋给 `picked`，随后作为 L1 返回。反过来请求 L2 时也可能拿到 L1/L3。提示阶梯的“不许提前泄露”约束因此被破坏，且现有回归没有覆盖这种输出。
- **影响**：L1 可能直接说出只有 L3 才该说的关键观察；用户以为模型遵守了分级，实际级别错位。
- **建议**：只接受 `Number(match[1]) === n` 的行；找不到就把 `lastHintError` 设为“模型返回了 Lx 而不是 Ln”，返回 `null`（再由 `hintFallback` 或报错处理）。补一条“模型只输出 L2、请求 L1”的回归。

### P2-2 客户端 120s 超时短于服务端最坏生成时间

- **位置**：`client.js:1187`（120s 的 `Promise.race`）；`lib/service.js:271-274`（budget 4000/6000，撞 max-tokens 再 12000 重试）；`index.js:867`（每次模型调用 90s）
- **问题**：L1 最坏 2 次模型调用 = 180s；若题面不在库中，还要先 `fetchStatementForHint`（`lib/service.js:2777-2795`，AtCoder 会先加载题库资源），总耗时可能超过 120s。客户端此时显示“没生成出来”，服务端仍在跑并最终把提示写进 KB。
- **影响**：用户看到失败，重试一次又触发一遍生成（多花一次模型预算）；两次请求的 cache 快照还可能互相覆盖。
- **建议**：客户端超时提到 240s，或服务端去掉 12000 的重试（单次 90s 上限）；最好把“超时/取消”做成可中止请求，而不是只在前端停止等待。

### P2-3 高分段评分窗口倒挂

- **位置**：`lib/service.js:2464-2465`（weak）、`3101-3102`（sample）、`4203-4204`（state）、`index.js:466`（ratings 展示）
- **代码**：

  ```js
  const min = Math.max(800, Math.round(rating) + 200)
  const max = Math.min(4000, Math.round(rating) + 400)
  ```

- **问题**：`rating = 3900` 时得到 `min = 4100`、`max = 4000`，`min > max`，所有候选都被过滤掉；`rating = 3800` 时窗口退化成单点 4000。CF/AT 顶尖分段可以达到这个区间。
- **影响**：高分用户抽题/弱点推荐直接空池，报错文案却是“题库里抽不出没做过的新题”。
- **建议**：先算 `max`，再令 `min = Math.min(max, Math.max(800, rating + 200))`；或把 rating 上限夹到 3600 再算窗口。窗口公式收敛到一个函数，四处共用。

### P2-4 sampleQuiz 的“手动窗口”文档写了、schema 却传不进来

- **位置**：`lib/service.js:3088-3090`（先 `await platformRatings()`，再读 `input.min/input.max`）；`index.js:433`（oi_train schema 只有 size/limit）；`README.md:139`（写的是 `ratingMin/ratingMax`）
- **问题**：
  1. 服务读的是 `input.min` / `input.max`，README 和用户习惯用的是 `ratingMin` / `ratingMax`（weakProblem 确实用后者，`lib/service.js:2454`）。
  2. oi_train 的 schema 没有 `min`/`max`/`ratingMin`/`ratingMax` 字段，工具与面板都无法传入手动窗口。
  3. 即使传了，`sampleQuiz` 仍在判断手动窗口之前先拉平台分数，手动窗口并没有省掉网络等待（weak 已在 `2457` 修掉这一点）。
- **影响**：README 承诺的“手动 ratingMin/ratingMax 可覆盖”实际不可达；用户手动指定窗口时仍会卡在 30s 的分数拉取上。
- **建议**：schema 增加 `min/max`（或统一改名 `ratingMin/ratingMax`），sampleQuiz 按 weak 的写法先判手动再决定是否拉分数，README 与 schema 用同一套参数名。

### P2-5 `npm test` 没有包含 regression4

- **位置**：`package.json:25`
- **问题**：`test` 脚本串了 smoke/regression/regression2/regression3/client-load/math-test，唯独没有新增的 `dev/regression4.mjs`。本轮 hint 的 19 项回归因此不会在 `npm test` 中执行。
- **影响**：后续改动很容易在无人察觉的情况下破坏逐级解锁、跳级限制、兜底和落盘。
- **建议**：把 `node dev/regression4.mjs` 加进 `test`；若有 CI，确认 CI 调的是 `npm test` 而不是手写脚本列表。

### P2-6 weakProblem 的 120s 预算仍然偏紧

- **位置**：`index.js:112`（oi_kb `timeoutMs: 120000`）；`lib/service.js:2457`（ratings，最坏 30s）、`2524`/`2538`（AtCoder/CF 题库串行加载）、`2730`（标题翻译 15s）
- **问题**：手动窗口已跳过 ratings，但默认路径仍要先并行拉两个平台分数（30s 上限），再串行加载两个题库，再预取 AtCoder 题面，最后翻译标题。任一项慢一点就会逼近 120s；第四轮的 P2-8 只是“改善”，没有消除。
- **影响**：`oi_kb action=weak` 在冷缓存/网络慢时超时，面板“换一道”失败。
- **建议**：把题库加载做成并行（`Promise.all`），预取数量按剩余时间动态裁剪；或把 oi_kb 的 timeout 提到 180s（与 oi_problem 一致），别让业务层自己猜预算。

### P2-7 KaTeX onload 失败后整场会话不再重试

- **位置**：`client.js:737-741`（onload 设置 `status='failed'`，但 `katexRuntime.promise` 仍是已 resolve 的旧 promise）；`742-759`（重试定时器只在 onerror 分支创建）
- **问题**：静态资源返回 200 但内容不是可执行的 KaTeX（网关错误页、被缓存的空文件）时，走 onload 分支，状态变 failed、promise 不置空、也不安排重试。之后 `ensureKatex()` 会一直返回那个 resolve 过的 promise，面板永久退化到 `mathTokens` 纯文本。
- **影响**：第四轮 P2-1 未修；用户只能刷新整页。
- **建议**：onload 校验失败也把 `promise = null` 并复用 onerror 的重试逻辑；或 `ensureKatex` 在 `status === 'failed'` 且无进行中请求时重新创建。

### P2-8 翻译管线仍是“逐段概括后拼接”，且失败段静默丢弃

- **位置**：`index.js:883-920`（`translateByModel`：1500 字一段，每段独立要求 2–5 句，最后 `join`；单段 60s，失败段跳过不报）
- **问题**：长题面会被切成多段，每段各自“概括成 2–5 句”，拼起来后再被 `briefZhStatement` 截到 320 字。结果是多段语义重复、成本翻倍；中间某段失败时，剩余段仍拼成“完整译文”，调用方无法知道缺了一段。
- **影响**：第四轮 P2-5 未修；长题面的中文题意可能前后不衔接，甚至缺半段。
- **建议**：先分段抽取事实，再让模型做一次总括（而不是每段各自总结）；失败段要在结果里标记（如 `[missing]`）或整体失败重试，不能静默拼半截。

### P2-9 提示结果可重复记录，污染零提示通过率

- **位置**：`client.js:1222-1231`（`recorded` 只是组件 state）；`lib/service.js:2874-2886`（`recordHintOutcome` 直接 `push`，不去重）
- **问题**：页面刷新/切题再回来，`recorded` 重置；用户可以对同一道题反复记录 solo/hinted/failed。服务端也不校验 `id` 是否已记录。`zeroHintRate` 的分母是全部记录（`lib/service.js:2902-2922`），重复记录会直接改变统计。
- **影响**：零提示通过率、解锁分布不可信；同一道题刷几次就能把比率拉向任意方向。
- **建议**：服务端按 `id` 去重（保留最近一次或首次），或按 `id + 场次` 限定；客户端把 `recorded` 用 `usePersisted` 持久化，并在请求进行中禁用按钮。

## 五、新发现 P3

1. **digestBackup 不持久化**：`lib/store.js:158-191` 的 `normalizeProblem` 白名单不含 `digestBackup`；覆盖后重启，备份消失。`index.js:435` 与 README 的“覆盖前备份”只在当前进程有效。建议把该字段加入白名单（并限制长度）。
2. **hintFallback 的 L1 可能直接泄露关键观察**：`lib/service.js:225-235` 的 L1 取 `observation`（≤120 字），而 observation 往往就是“最难想到的那一步”；这与 L1 规则“不能点算法名、不能给转化目标”冲突。建议 L1 只从 `direction`/`trigger` 或题面结构生成，没有材料时宁可报错。
3. **hintProblem 对库内题优先用中文简版题面**：`lib/service.js:2817` 用 `problem.statementZh || problem.statement`；`statementZh` 是 2–5 句简版，可能丢掉约束/输入输出，导致提示偏离原题。建议优先 `statement`，只有它为空时才退回 `statementZh`。
4. **visible 可能出现 `undefined` 文本**：`lib/service.js:2862-2868` 只在 `cache.l1` 存在时赋值 `visible.l1`，但 summary 在 `unlocked >= 1` 时无条件模板插值。若数据里只有 l2/l3、没有 l1（手工改库或旧数据），会输出“undefined”。建议 `${visible.l1 || '（缺失）'}`。
5. **两个模块级错误变量存在并发竞争**：`lastHintError`（`lib/service.js:237`、`245`、`296`）与 `lastDigestError`（`120`、`122`、`192`）是进程级可变状态；两个请求交错时，A 的失败原因可能被 B 覆盖，summary 会报错因。建议由函数返回 `{ value, error }`，不要用全局变量传错。
6. **hintOutcomes 的 400 条上限是滚动窗口**：`lib/service.js:2886` 超限直接 `slice(-400)`，旧记录静默消失；`hintStats` 却把它当累计值展示。建议在文档里写明“最近 400 条”，或改成按题目聚合。
7. **digestQuizProblems 逐题写盘**：`lib/service.js:3637` 每道题一次 `this.mutate`，每次都是全量深拷贝 + pretty JSON 落盘；8 道题就是 8 次全库写。建议在循环外收集变更后一次 `mutate`（`repairQuizStatements` 已经这么做了，可复用写法）。
8. **digest 的“3–5 条洞察”与实现不一致**：`index.js:390` 写 3–5 条；`makeQuizDigest` 要求 ≥2 条、最多 6 条（`lib/service.js:183-191`）。建议统一为“2–6 条”，或把下限提到 3。
9. **`call` 的 throwOnError 分支是重复代码**：`client.js:1671-1672` 两个 `throw failure` 完全相同。删掉 `if` 即可，行为不变。
10. **记录结果失败时没有反馈**：`client.js:1224-1229` 用 `{ silent: true }` 调 `recordHintOutcome`，失败返回 `null` 后直接 `return`；用户看到按钮没反应，也不知道统计没记上。建议加 `throwOnError` 或设置 `hintError`。
11. **pickBatch 仍是有偏 shuffle**：`client.js:3399` 用 `sort(() => Math.random() - 0.5)`，分布不均；且 `unseen.length < 3` 时会 `clearQuizRecent()`，把“最近做过”的记录整体清空，而不是只补足数量。建议用 Fisher–Yates。
12. **无评分缓存时客户端不遵守服务端回退窗口**：`client.js:3300` 在 `ratingWindows` 缺该平台时直接 `return true`；服务端无分数时回退 1200–2600（`lib/service.js:3105`）。冷启动时本地兜底会混进窗口外的旧题。建议 state 始终下发回退窗口，或客户端按同一规则计算。
13. **gaps 仍把 0 当“无值”**：`lib/service.js:2375` 用 `gap.medianRating ?` 判断，中位分为 0 时不显示；第三轮已记过同类问题，未修。
14. **plainMath 的格式残留**：`lib/service.js:349` 仍是 `function plainMath(text) {  let out = ...`（双空格 + 首句并到签名行）。属于编辑器/自动格式化残留，建议跑一次格式化。
15. **store 的原型污染面未收**：`lib/store.js` 的 `readBucket` 仍以 JSON 里的 platform/handle 作为对象键直接赋值（`out[platform] = {}`），手工构造的 `__proto__` 可以改原型；`normalizeKb` 的 `seq` 仍接受小数。建议用 `Object.create(null)` 或 `Map`，并对 `seq` 取整。
16. **toolError 与四个 dispatch 的重复**：`index.js:37-40` 的 KbError 分支和兜底分支输出相同；四个工具的 `switch` 各自重复 `default: 未知 action`。建议收敛成一个 action 注册表（描述、schema、handler 同源），同时消除 enum 与 description 漂移。
17. **platformRatings 的 invalidate 冗余**：`lib/service.js:3073-3074` 在 `mutate` 之后又显式 `invalidate`，而 `mutate` 的 `finally` 已经失效缓存；不影响正确性，但容易让人误以为缓存需要手动清。
18. **digestFor 的超时没有取消底层调用**：`lib/service.js:3212-3217` 的 `Promise.race` 到 40s 就返回 `null`，但 `makeQuizDigest` 仍在跑（90s 模型超时），并继续消耗 token；随后下一道题又会把 `lastDigestError` 覆盖。建议用可中止的模型调用，或明确接受“后台跑完丢弃”。

## 六、结构优化建议

### S1 拆分 `lib/service.js`（4475 行、一个类约 100 个方法）

新增的 hint/digest/ratings 各自 100–300 行，仍在同一个类里。建议按职责拆成 `lib/hint.js`、`lib/digest.js`、`lib/ratings.js`、`lib/weak.js`，`KnowledgeService` 只保留工具入口和组合。这样也便于给 hint 的解析/超时写单元测试。

### S2 拆分 `client.js`（4209 行、单文件单闭包）

`WeakPickOverlay` 已经因为 hint 涨到约 350 行；`TrainingTab`、`ProblemDetail`、`NodeDetail` 仍是巨型组件。建议按 tab 拆文件（`tabs/training.js` 等），把 `usePersisted`、`call`、`MathText` 抽成共享 hook/组件。当前所有 tab 共享一个闭包，改动一处很难判断影响面。

### S3 统一模型调用脚手架

`makeQuizDigest`（`lib/service.js:146-156`）、`makeHintLevel`（`272-275`）、`runModel`（`index.js:852-882`）、`translateByModel`（`883-920`）各自实现“预算、撞 max-tokens 重试、错误标记、超时”。建议抽一个 `generate({ prompt, maxTokens, retryTokens, timeoutMs })`，返回 `{ text, error }`，顺带解决 P3-5 的全局错误变量问题。

### S4 评分窗口只留一处实现

同一公式出现在 weak（`2464`）、sample（`3101`）、state（`4203`）、index 展示（`466`）。建议 `ratingWindow(rating, { floor = 800, cap = 4000, delta = [200, 400] })` 单一实现，并在 `min > max` 时修正（P2-3）。sample 与 weak 的手动窗口读取也应统一成同一字段名（P2-4）。

### S5 收敛重复的统计/聚合

`state()` 的全字段 nodes、`slimRow`、`report` 的观察聚合、`obsTree` 的子树聚合仍是多套实现；`hintStats`、`trainStats`、`report` 也各自 filter 同一批记录。建议先抽“行投影”和“子树聚合”两个纯函数，再让各入口复用。

### S6 批量写盘

`sampleQuiz` 逐题 `addProblem`（`lib/service.js:3247` 起）、`digestQuizProblems` 逐题 `mutate`（`3637`）都会放大全量 JSON 写。`repairQuizStatements` 已改成“收集 writes → 一次 mutate”（`3506` 起），可把同一模式抽成 `mutateMany` 或让 `addProblem` 支持传入 draft。

### S7 action 契约与文档单一来源

`oi_train` 的 enum（`index.js:406`）与 description（`390-396`）已经出现过两次漂移（ratings、pending 参数）。建议用一张 `ACTIONS = { sample: { schema, describe, handler } }` 表生成 schema 和描述；README 的示例参数也从同一张表生成或至少加一致性测试。

## 七、测试与文档

### 7.1 回归

- `dev/regression4.mjs` 19 项全部通过：逐级解锁、一次只生成一级、部分缓存重载、`hintSources` 落盘、L1 不泄露 L2/L3、`level=0` 只读、`hintUnlocks` 落盘、记录统计、跳级只解 L1、模型空输出兜底、非法 outcome。
- 缺口：未覆盖 P2-1（模型输出错误级别）、P2-2（客户端 120s 与服务端 180s）、P2-3（高分窗口倒挂）、P2-9（重复记录）、P2-7（KaTeX onload 失败）。`npm test` 未包含 regression4（P2-5）。

### 7.2 文档

主要漂移已修：三棵树、四个工具、105 个思路节点、`depth`/`limit`、`nodes` 数组。仍存在的两处：

- `README.md:139` 仍写 sample 支持手动 `ratingMin/ratingMax`，实现读的是 `min/max` 且 schema 未暴露（P2-4）。
- `index.js:390` 写 digest 生成“3–5 条洞察”，实现是 2–6 条（P3-8）。

另外 README 对 `digestBackup` 的“备份”没有说明只在当前进程有效（P3-1）。

## 八、修复顺序建议

1. **P2-1**（提示级别解析）：一处小改 + 一条回归，先堵住“L1 泄露 L3”的语义错误。
2. **P2-3 + P2-4**（窗口倒挂、手动窗口不可达）：公式和 schema 各改一处，用户可感知。
3. **P2-2 + P2-9**（超时预算、重复记录）：服务端/客户端契约一起改，避免统计继续被污染。
4. **P2-7 + P2-8**（KaTeX、翻译管线）：都是第四轮遗留，改动局部但影响体验。
5. **P2-5**（把 regression4 接进 `npm test`）并补上述缺口的回归。
6. **P3 与 S1–S7**：按“先修正确性、再拆结构”的顺序做；S1/S3 可以顺手解决 P3-5、P3-7。

## 九、方法与限制

- 通读了 `0bba837..8453181` 的完整 diff，并对 hint/digest/ratings/state/client 的关键路径做了现行代码复读；上轮未改动的 analysis/similarity/tree 等文件沿用前几轮结论。
- 实际运行了 `dev/regression4.mjs`（使用 DSH 自带 Node），19 项通过；没有启动插件做浏览器端到端操作，客户端相关结论来自代码路径分析。
- 审查期间仓库保持 clean，未做任何修改；报告中的行号以 `8453181` 为准，若后续提交移动代码，请以函数名/锚点重新定位。
