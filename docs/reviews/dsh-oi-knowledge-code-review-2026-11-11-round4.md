# dsh-oi-knowledge 代码审查报告（第四轮）

- 审查时间：2026-11-11 13:33–14:15（GMT+8）
- 仓库：`C:\Users\lenovo\Documents\deepseek-harness\default-workspace\dsh-oi-knowledge`
- 基线：`git HEAD 0bba837`（`feat(review3): three-tree weak analysis, rating windows, and persistence fixes`），工作树 clean
- 版本：1.3.37
- 范围：`index.js`（923 行）、`client.js`（4006 行）、`lib/*.js`（service 4126、sync 758、store 446、analysis 650、similarity 278、tree 238、observation 825、ideas 854、taxonomy 384）、`dev/regression3.mjs`（新增）
- 方式：只读审查；逐段阅读 `63e30dc..HEAD` 的新增/修改代码，并对关键路径做全文件上下文核对；行号均以当前工作树 `read` 工具为准
- 回归：`node dev/regression3.mjs` 全部通过（11 passed, 0 failed）
- 上一轮：`dsh-oi-knowledge-code-review-2026-11-11-round3.md`（590 行，P0 0 / P1 3 / P2 16 / P3 约 30）

## 一、结论

本轮新增代码整体质量好于上一轮：round3 的 3 条 P1 和多数 P2 已修复，`regression3.mjs` 也补上了 5 组离线断言。但有 1 条新的数据丢失路径（P1），以及 9 条 P2，主要集中在「平台分数缓存」「抽题同步做 digest 的延迟/超时」「weakProblem 的三棵树结果一致性」和「action 契约/文档漂移」。

| 等级 | 数量 | 说明 |
| --- | --- | --- |
| P0 | 0 | 无启动崩溃、无静默清库 |
| P1 | 1 | `oi_train digest` 覆盖手工洞察（可复现的数据丢失） |
| P2 | 9 | 缓存被重启剥离、pending 参数错位、ratings 未文档化、digest 同步阻塞/超时、weak 超时与结果不一致、state 载荷、translate 多段概括 |
| P3 | 16 | 计数、死变量、注释/缩进、文档漂移、测试覆盖缺口等 |

## 二、上一轮问题复核

| round3 编号 | 问题 | 状态 | 证据 |
| --- | --- | --- | --- |
| P1-1 | 训练失败后重提吞掉第 2 轮 | **已修** | `client.js:3267-3298` 只在 `pendingJudge` 命中时重发 judge；`regression3` 覆盖 |
| P1-2 | 切 tab 卸载 TrainingTab 丢状态 | **已修** | `usePersisted`（`client.js:1416-1434`），训练状态持久化到 localStorage（3119-3142、3197） |
| P1-3 | recommendNovel 无候选仍硬推、分位方向反 | **已修** | `lib/service.js:1807-1834`；`best` 仅取 `recommended[0]`，无候选返回 null，`percentile = 100 - pct` |
| P2-1 | trainReview 默认轮次与 trainJudge 不一致 | **已修** | `lib/service.js:3589-3591` 改用 `pendingRound`，注释也写明同口径 |
| P2-3 | repairQuizStatements 每题一次写盘、fixed 虚报 | **已修** | 先收集 writes，单次 `mutate`（`lib/service.js:3265-3284`）；`fixed` 只在实体存在时递增（3281） |
| P2-4 | findAccount 空 handle 通配 | **已修** | `allowEmpty` 白名单（`lib/service.js:1897-1898`），`regression3` 覆盖 |
| P2-6 | addProblem 空串 rating 存成 0 | **已修** | `optionalNumber`（`lib/service.js:1250`），`regression3` 覆盖 |
| P2-8 | weakProblem 串行抓题面 + 120s 超时 | **部分修复** | 标题翻译已加 15s 超时（2620），但评分拉取和串行抓题仍在，见 P2-5 |
| P2-11 | CF `$$$` 数学标记被粗暴替换 | **已修** | `lib/sync.js` 已改为 `$$$...$$$` → `$...$`、`$$$$` → `$$` |
| P2-5 | translateByModel 多段各自概括再拼接 | **未修** | `index.js:852-888` 仍是 1500 字/段、每段独立总结、失败段静默丢弃 |
| P3 | state 带全部 quiz 题面 | **未修** | `lib/service.js:3867-3879` |
| P3 | finishSession 不更新 session.endedAt | **未修** | `client.js:3349-3358` 只 `setSessionResult`，`3498` 的「已结束」不会出现 |
| P2-1/P2-2 | ensureKatex onload 失败不可恢复、公式左右间距不均 | **未修** | `client.js:721-764`、`636-659` + CSS `122` 未改动 |

## 三、新发现 P1

### P1-1 `oi_train digest` 会覆盖 quiz 题的手工洞察

`digestQuizProblems` 的筛选条件只看「quiz + 没写精髓 + 题面 ≥80 字」，不看 `insights` 是否已有内容：

```js
// lib/service.js:3305-3312
const todo = (kb.problems || [])
  .filter(
    (problem) =>
      problem.pool === 'quiz' &&
      !String(problem.essence || '').trim() &&
      String(problem.statement || '').trim().length >= 80,
  )
  .slice(0, limit)
```

随后在 mutate 里整体替换洞察：

```js
// lib/service.js:3335
entity.insights = next
```

而 `addProblem` 明确允许 `pool:'quiz'` 的题目带 `insights`（`lib/service.js:1287-1302`），只是不挂算法树。也就是说，下面这条路径会丢数据：

1. `oi_problem action=add platform=codeforces key=1A pool=quiz statement="..." insights=[{kind:"trick", text:"手工写的洞察"}]`
2. `oi_train action=digest`
3. 该题的 `insights` 被 digest 生成的洞察整体替换，原洞察没有备份、没有 merge、没有提示。

**触发条件**：quiz 题有洞察但 essence 为空，且题面 ≥80 字。这正是「先建题、后补精髓」的正常用法。

**修复建议**（任选其一，推荐 1+3）：

1. 筛选条件加 `!(problem.insights || []).length`，只补真正空的题；
2. 或按 `text` 合并去重，保留原洞察的 id、`nodes`、`obsNodes`，只追加 digest 新洞察；
3. 给 `digest` 增加 `overwrite` 参数（默认 false），覆盖前把旧数组写入 `problem.digestBackup`；
4. `regression3.mjs` 增加「quiz 题已有洞察 → digest 不覆盖」用例。

## 四、新发现 P2

### P2-1 平台分数缓存会被重启剥离，且失败不缓存

`normalizeKb` 的 meta 白名单没有 `platformRatings`：

```js
// lib/store.js:256-262
const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
kb.meta = {
  tagMap: ...,
  lastSeedAt: ...,
  lastSyncAt: ...,
  problemset: ...,
}
```

后果：

- `weakProblem`、`sampleQuiz`、`oi_train ratings` 写进 `kb.meta.platformRatings` 的 1 天缓存，进程重启/重新加载后被丢掉；
- 下一次调用重新拉 CF/AtCoder，各 30s 超时，串行最多 60s；
- 失败分支只写内存 `out`，`changed` 只在 live 成功时为 true（`lib/service.js:2795-2800`）；即使另一个平台成功、失败条目被顺带写盘，它也会因 `rating:null` 永远 stale（2759-2764），下次调用照旧重试；两个平台都失败时则完全不落盘。

**修复**：把 `platformRatings` 加入白名单；失败条目落盘为 `{rating:null, reason, fetchedAt, source:'error'}` 并用较短 TTL（如 10 分钟）；CF/AT 用 `Promise.allSettled` 并行拉，最坏从 60s 降到 30s。

### P2-2 `pending` 动作把 `limit` 读成了 `size`

```js
// index.js:461-462
case 'pending':
  return toolOk(service.pendingTranslations({ limit: args.size }))
```

schema 里 `size` 是 sample 的参数（`index.js:421`），`limit` 才是 pending 的参数（`index.js:422`，描述却写成「digest」）。`pendingTranslations` 的默认值是 6（`lib/service.js:3094`），所以 README 的示例恰好能跑；一旦用户传 `limit=10` 就会被忽略。README:129 的 `oi_train action=pending limit=6` 也说明这是对外契约。

**修复**：改成 `args.limit`；schema 的 `limit` 描述补上「pending/digest」；加一条参数映射测试。

### P2-3 `ratings` 以及 `probe/pending/apply_zh` 仍未写进 description

`oi_train` 的 enum 有 19 个 action（`index.js:400`），description（375-391）只写到 digest，缺 `probe`、`pending`、`apply_zh`、`ratings` 四个。其中 `ratings` 只有 `force` 字段的描述（402）间接提到。用户和模型都无从发现这个新功能；README 也完全没有 ratings 的说明。

同一处的 `sample` 描述还停留在旧实现：

```js
// index.js:387
'  sample — 面板用：从本地已译题库抽一批中文新题（不足会提示补货）；',
```

现在 `sampleQuiz` 是从 AtCoder/CF 实时抽题、抓题面、翻译并 digest（`lib/service.js:2808-3086`），「本地已译题库」已经不对。

**修复**：description 改成从单一声明表生成（见结构优化 S5），至少补齐四个 action 并更新 sample 文案。

### P2-4 `sampleQuiz` 同步做 digest，最坏分钟级阻塞

`sampleQuiz` 对每道非 defer 的题在入库前 `await makeQuizDigest`（`lib/service.js:2953` AtCoder、`3003` CF）。`makeQuizDigest` 单次最多两次模型调用（首次 8000 token，遇到 `max-tokens` 再以 16000 重试，`lib/service.js:136-146`），每次 `runModel` 的超时是 90s（`index.js:836`）。

- `size` 上限 6（`lib/service.js:2810` 附近），最坏 6 × 2 × 90s = **1080s**，再加题面抓取和翻译；
- 面板「换一批」直接 `call('sampleQuiz', {size: 3})`（`client.js:3231`），没有前端超时，`quizPreparing` 会一直转；
- digest 失败只进 `pendingDigest` 并提示，不会自动排队（3079），题就永久缺 essence，除非再手动 digest；
- `oi_train` 的 900s 超时（`index.js:438`）能兜住工具调用，但兜不住面板的 `/api/call`。

**修复**：把 digest 改成「入库后异步补」或队列（`pendingDigest` 真正入队，由 digest action 消费）；至少把 `makeQuizDigest` 限制为单次 8000 token、不再 16000 重试；前端加超时/取消，并显示「已入库，精髓后台补」的分段结果。

### P2-5 `weakProblem` 仍可能超过 120s

`oi_kb` 的 timeout 是 120s（`index.js:112`）。`weakProblem`：

1. `await this.platformRatings()`（`lib/service.js:2366`）：CF/AT 串行，各 30s 超时，最坏 60s；即使调用方已经传了手动 `ratingMin/ratingMax`，这里仍然先拉取（2364-2366；sampleQuiz 的 2812-2814 同理）；
2. 对 `picked` 中的每道候选串行 `await sync.fetchAtCoderTaskBundle`（2552-2568），最多 `want` = 6–10 道；
3. 最后再 `translateFast(title, 15000)`（2620）。

60s + 10 次抓取 + 15s 很容易越过 120s，尤其是 AtCoder 网络抖动时。round3 的 P2-8 只是把最后一步的翻译加了超时，主干没有收敛。

**修复**：候选抓取用 `Promise.allSettled` 并发（限 3 并发）；`want` 降到 6 或按剩余预算动态截断；读取分数失败时直接用已做题分位，不阻塞在 60s 上。

### P2-6 weakProblem 的「最该补的方向」与 `facets` 可能不是同一个知识点

```js
// lib/service.js:2582-2593
const composed = facets.map((facet) => { ... })
composed.sort((a, b) => a.min - b.min || a.sum - b.sum)
const weakestFacet = composed[0]
ranked.push({
  ...
  weakest: rows[0].row,        // ← 知识点排序的第一行
  facets: composed,            // ← 三棵树合成排序
  ...
})
```

最后：

```js
// lib/service.js:2621, 2641
const bestFacet = best.facets[0].facet
facets: { knowledge: [bestFacet.knowledge].map(...), ... }
```

`rows[0]` 是按知识点 level/权重排序的第一行；`facets[0]` 是按 `min/sum` 合成排序的第一行，两者可能不同。于是：

- 摘要里的「最该补的方向」用 `best.weakest.path`（2646 起）；
- 面板渲染的 `item.facets.knowledge` 用 `bestFacet`（`client.js:1246-1262`）；
- `item.nodes` 又用 `best.rows`（2638）——第三个来源。

三个字段可能指向三个不同的知识点，用户看到的「弱点」和「对应知识点」对不上。另外 `weight: best.weakest.risk`（2639）字段名叫 weight、内容是 risk，属于命名债。

**修复**：先按 `composed` 排序确定唯一的 weakest（`bestFacet.knowledge`），`rows`/`nodes`/`facets`/`weight` 全部从它派生；`weight` 改名为 `risk` 或直接删掉。

### P2-7 `state()` 仍把全部 quiz 题的完整题面发给面板

```js
// lib/service.js:3867-3879
quiz: kb.problems
  .filter((problem) => problem.pool === 'quiz')
  .map((problem) => ({
    ...
    statement: problem.statement || '',
    statementZh: problem.statementZh || '',
    ...
  })),
```

quiz 池是长期累积的（每次「换一批」入库 3 道），`/api/state` 每次首屏都把全部英文题面和中文题面带上；题面通常几 KB，几百道就是 MB 级。面板列表只需要标题/难度/状态，题面只在详情页用。

**修复**：`state` 里只留 `statementZh` 的前 120 字摘要（或不留），详情页走 `problemDetail`；顺便把 `state` 的 36 字段 `nodes` 与 `slimRow` 合并成一份。

### P2-8 `digest` 的 limit=20 与 900s 超时不匹配

`digestQuizProblems` 允许 `limit` 到 20（`lib/service.js:3303`），每题最多 2×90s，最坏 3600s；`oi_train` 的 timeout 是 900s（`index.js:438`）。超时后工具被杀，前面已写的题保留、后面的没跑，但调用方拿不到 summary，也不知道停在哪。

**修复**：limit 上限降到 8，或按 deadline 预算循环（每轮检查剩余时间）；summary 里报告「已完成/跳过」。

### P2-9 翻译链路仍是「多段各自概括 + 代码再截断」

`translateByModel`（`index.js:852-888`）对 1500 字切段，每段独立要求「概括成 2–5 句」，再 `join('\n')`；随后 `briefZhStatement`（`lib/service.js:66-106`）又截到 320 字。长题面会先被模型分段概括、再被代码截断，既多花 token 又可能丢掉段间关系；截断点还可能落在 `$...$` 中间，破坏公式配对。

**修复**：先整段翻译（或按句切、但只做一次总结），再做一次 brief；brief 的截断要避开 `$`（按 token 扫描，遇到奇数个 `$` 就回退到上一个安全边界）。

## 五、P3 与规范问题

1. **P3-1** `digestQuizProblems` 覆盖 `insights` 后不重算 `keyObservations`（3335 之后没有 `computeKeyObservations`），旧 id 悬空；虽然 `trainCard` 排除 quiz（3358），但 `showProblem`/详情页的「关键观察」会空到下次重载。
2. **P3-2** `digestQuizProblems` 每题一次 `mutate`（3323），`fixed += 1` 在 mutate 外（3338），实体缺失时也计数——与刚修好的 `repairQuizStatements` 模式不一致。
3. **P3-3** `lastDigestError` 是模块级可变（110-112），并发两个 digest 会互相覆盖，summary 可能显示另一个请求的失败原因。
4. **P3-4** `sampleQuiz` 里 `const editorialZh = ''`（2946）仍是死变量，`solution: editorialZh || bundle.editorial || ''` 恒等于后者。
5. **P3-5** `ratings` 输出窗口 `rating+200..rating+400`（`index.js:453`）没有像 `weakProblem` 那样 clamp 到 800–4000（`lib/service.js:2372-2374`）；高分段会显示 4200 这种不存在的窗口。
6. **P3-6** `fetchAtCoderRating` 取最后一条 `NewRating` 时没有检查 `IsRated`/0（`lib/sync.js:145-149`）；理论上只有非 rated 记录、且 `NewRating` 为 0 的用户会拿到 0 分，窗口变成 800–400，需要在真实账号上确认。
7. **P3-7** `weakProblem` 的三棵树合成把缺失维度按 0 分算（2584-2586），没有思路/观察证据的知识点会稳定排到最弱；注释说这是「避免缺失维度被当成强项」，但实际会让「没有证据」等价于「最弱」。
8. **P3-8** `client.finishSession` 不更新 `session.endedAt`（`client.js:3349-3358`），3498 的「已结束」判断永远为假；持久化的 session 也不会被标记结束。
9. **P3-9** `client.nextBatch` 的 `catch`（3244）基本是死代码：`call` 内部已 try/catch 并返回 null，不会 reject（round3 已提，未改）。
10. **P3-10** `usePersisted` 的 key 没有按 kb/数据目录命名空间隔离（1416-1434），切换数据目录后会读到上一个库的 session/draft。
11. **P3-11** `pendingTranslations` 上方还留着 `repairQuizStatements` 的旧 JSDoc（3088-3092），注释与函数错位，属于编辑残留。
12. **P3-12** `digestQuizProblems` 的失败列表只截前 4 个（3342），错误原因只保留最后一条 `lastDigestError`，多题失败时信息不足。
13. **P3-13** `platformRatings.stale` 对同一个 `fetchedAt` 调了两次 `Date.parse`（2763-2764），且 `Date.parse` 失败时靠 `!Number.isFinite` 兜底；可读性差，建议解析一次。
14. **P3-14** `sync.getJson` 仍无重试/退避（round2/3 已提），平台 5xx 或瞬时网络错误会直接让 `platformRatings` 失败并进入重试循环。
15. **P3-15** README 漂移（本轮未修）：line 5 仍写「两棵树」且思路树 108 个节点（实际 105）；line 19/45 仍写「三个工具」（实际四个）；line 51 用 `level=2`（schema 是 `depth`）；line 62 用 `count=5`（schema 是 `limit`）；line 88 的 `nodes="贡献拆分"` 是字符串（schema 是数组）；line 129 的 pending limit；line 139 仍写「1200–2600 分」（现在是按平台分数 +200~+400 动态窗口）。
16. **P3-16** `dev/regression3.mjs` 的覆盖缺口：P1-1 只测「连续两次 trainJudge 不新增 attempt」（40-49），没有覆盖客户端「judge 失败后重新 submitAttempt」的真实路径；没有覆盖 pending 的 limit 映射、platformRatings 的 normalize 保留、sampleQuiz 的超时预算。`package.json` 没有 `scripts.test`，回归脚本只能手动跑。

## 六、结构优化与冗余消除

按收益排序，建议下一轮集中做，避免继续在 4126 行的 service.js 上叠功能。

### S1 拆 service.js（当前 4126 行，83 个方法）

建议按领域拆成四个模块，`KnowledgeService` 只保留 facade 和 `uiCall`：

- `lib/quiz.js`：`sampleQuiz`、`refill`、`repairQuizStatements`、`pendingTranslations`、`applyTranslations`、`probeTranslate`、`digestQuizProblems`、`makeQuizDigest`、`annotateDigestNodes`；
- `lib/training.js`：`trainCard`、`trainMarkCard`、`trainAttempt`、`trainJudge`、`trainReview`、`trainReveal`、`trainGrade`、`trainStats`、`session*`；
- `lib/weak.js`：`weakProblem`、`recommend`、`recommendNovel`、`similar`、`calibrateThreshold`、`platformRatings`、窗口/池构建；
- `lib/report.js`：`report`、`gaps`、`state`、`overview`、`status`。

`service.js` 预计可从 4126 行降到 1200–1500 行；`uiCall` 的 100 行 switch 改成注册表后还能再降。

### S2 消除 windowOf / 池构建的重复

`weakProblem` 的 `windowOf`（2367-2378）与 `sampleQuiz` 的 `windowOf`（2815-2830）是两份实现，fallback 还不一样（前者用已做题分位，后者硬编码 1200–2600）；两边的 AtCoder/CF 池构建也几乎逐行重复。

建议抽 `lib/quiz-window.js`：

```js
export function windowOf(ratings, platform, { min, max, fallbackMin, fallbackMax })
export function buildCandidatePools(kb, windows, { solved, known, exclude })
```

### S3 统一模型调用

`runModel`（`index.js:820-848`）与 `translateByModel`（852-888）各自实现 `llm.stream` 的 chunk 收集、错误标记、超时；`makeQuizDigest` 又单独拼 prompt。建议抽 `lib/model-call.js`：

```js
streamModel({ prompt, system, maxTokens, timeoutMs }) → { text, error, finish }
```

同时把 `tryTranslate` 与两个 `probe`（701-752、839-855）里重复的 provider 解析收敛成一份。

### S4 统一「简要题意」管线

现在是 `translateByModel(mode='statement')` 让模型「2–5 句」→ `briefZhStatement` 再截 320 字，两段都在做「简短化」。建议只保留一段：翻译时直接要求 ≤160 字，代码只做清理不截断；或翻译完整后一次 summary。这样既省 token，也避免截断 `$...$`。

### S5 action 契约用单一声明表生成

`index.js` 里有四处 switch + 一份 enum + 一份 description，已经产生三处漂移（pending 参数、ratings 未写、sample 描述过期）。建议：

```js
const TRAIN_ACTIONS = {
  card: { desc: '...', schema: {...}, run: (service, args) => service.trainCard(args) },
  ...
}
```

tool 的 `enum`、description、execute 分发都从这张表派生；schema 里 `size`/`limit` 的归属也写在同一行。

### S6 state/聚合去重

`state()` 的 36 字段 nodes 与 `slimRow` 重复；obsNodes 子树聚合在 `obsTree`、`report`、`state`、`overview` 里各有一份（四处）。建议抽 `buildObsTree(kb, analysis)` + `slimNode(row)`，`state` 只引用。

### S7 拆 client.js（4006 行）

按 tab 拆 `client/tree.js`、`client/problems.js`、`client/training.js`、`client/weak.js`、`client/accounts.js`，共享 `client/shared.js`（`usePersisted`、`call`、`Empty`、`LevelBadge`、时间格式化）。现有 `Empty` 组件、页签按钮、`platformShort`、`problemTitle` 都有内联副本，可一并收掉。

### S8 store 的 meta 白名单改为显式字段表

`normalizeKb` 的 meta 白名单已经漏掉 `platformRatings`，以后还会漏新字段。建议：

```js
const META_FIELDS = {
  tagMap: (v) => v && typeof v === 'object' ? { ...v } : {},
  platformRatings: (v) => v && typeof v === 'object' ? v : {},
  ...
}
```

每加一个 meta 字段只改一处；`platformRatings` 的失败条目也走同一套归一。

## 七、测试与文档

- `dev/regression3.mjs` 已覆盖 5 组问题（11 条断言），是正确方向；但它是独立脚本，`package.json` 没有 `test` 入口，也没有在 `README` 的开发者流程里写怎么跑。
- 建议补 3 个最小用例：
  1. quiz 题已有 insights + essence 为空 → `digest` 不得覆盖（P1-1）；
  2. `pending` 传 `limit=10` 实际返回 10 条（P2-2）；
  3. `normalizeKb` 保留 `meta.platformRatings`（P2-1）。
- README 的漂移集中在「两棵树/三个工具/level/count/nodes/pending/1200–2600」，建议和 `package.json` 的 `meta` 一起做一次文案校对（P3-15）。

## 八、修复顺序建议

1. **P1-1**：digest 不覆盖手工洞察（小改动，先加回归）。
2. **P2-1 + P2-2 + P2-3**：缓存白名单、pending 参数、description/README —— 都是一行到几行的修复，收益高。
3. **P2-4 + P2-8**：digest 改为后台/队列，limit 与超时对齐；这是本轮最影响体验的一处。
4. **P2-5 + P2-6**：weakProblem 并发抓取与三棵树结果统一。
5. **P2-7 + P2-9**：state 载荷与翻译管线。
6. **P3** 批量清理，最后做 S1–S8 的结构拆分。

## 九、方法与限制

- 审查为只读，没有修改仓库；报告中的行号以当前工作树 `read` 为准（`service.js` 4126 行、`client.js` 4006 行）。
- `dev/regression3.mjs` 用 DSH 自带的 Node 执行：`C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe dev\regression3.mjs`，11/11 通过。
- `analysis.js`、`observation.js`、`ideas.js`、`taxonomy.js` 本轮 diff 未触及，round3 报告的 O(N²)、死代码（`OBS_INDEX`/`obsIndex`/`obsDepth`/`obsPatternCount`）等问题仍然成立，本报告不重复展开。
- 未做运行时 UI 实测（面板交互、KaTeX 渲染），客户端结论来自静态阅读与上一轮子代理报告的交叉核对。
