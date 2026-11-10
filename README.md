# OI 知识点树 · dsh-oi-knowledge

一个把「做题经验」沉淀成可自检知识树的 DeepSeek Harness 插件。它做三件事：

1. **维护两棵树**：一棵是**算法知识树**（考什么：领域 → 专题 → 概念/技巧，74 个节点），另一棵是**思路树**（怎么想出来的：转化与观察、构造与证明、搜索与枚举、DP 与计数、数据结构与离线、图论建模、交互与随机化、审题与拆解、分治与优化、概率与计数、实验与验证，108 个节点）。两棵树都能自由增删改移。
2. **把题目拆成「精髓」**：录入题面/题解（可只给链接），先写一句 `essence`（这题最关键的那一步），再把「观察、套路、思路、思考方向、坑点」五类洞察挂到具体节点——尤其是思路节点。算法名只是载体，真正可迁移的是这些。
3. **从账号反查弱点**：绑定 Codeforces / AtCoder / 洛谷 账号，同步已通过的题，按知识点统计覆盖与难度，找出**该补、但还没补**的节点；思路树则按「已沉淀多少洞察」单独统计，暴露「刷了很多题但没总结」的方向。

---

## 安装

插件是标准的 Harness bundle。在对话里安装：

```
plugin_manager action=install_bundle target=<本包绝对路径>
```

安装后重启（或重新加载）Web 界面，左侧栏会出现「OI 知识点」图标；也可以直接在对话里让模型调用下面三个工具。

卸载：

```
plugin_manager action=remove_bundle target=dsh-oi-knowledge
```

## 面板

左侧栏点「OI 知识点」打开主面板。标题栏右侧有三个按钮：**🎯 薄弱题**（随机抽一批候选题，挑出命中你最弱知识点的那道，可「换一道」）、**🌳 完整知识树**（浮层里一次看完整棵知识/思路/观察树，含每个节点的掌握度、题数、洞察数）、**刷新**。下面四个标签页：

| 标签 | 作用 |
| --- | --- |
| **知识树** | 左上角可切换「知识 / 思路 / 观察」三棵树。知识树看掌握度、题数、洞察、推荐练习题；思路树看关联题数与洞察数；观察树看每个观察方向挂了多少条精髓观察，节点详情列出对应题目（可点击跳到题目页）与子方向；观察句式按「真题证据」标注：至少 2 道题的 observation 能支撑才标为已验证并附例，其余灰显为未验证。三棵树都能改名/改备注、加子节点、移动、删除。 |
| **题目** | 题目列表与筛选；录入新题目（链接自动补全标题/评分/标签），可以写一句「精髓」；题目详情里按类型管理洞察、改状态、标记「卡在哪一步」、重新分类、编辑精髓/题面/题解。 |
| **弱点** | 概览（覆盖、非常熟练/熟练/还行/不熟练/非常不熟练/空白、思路覆盖率）、知识点风险榜、最该补的思路、反套路推荐、标签覆盖表、未归类的已通过题。 |
| **账号** | 绑定/同步/移除 Codeforces、AtCoder、洛谷 账号，查看数据目录。 |

所有数据本地保存，面板与对话工具读写同一份文件。

面板里的洞察、精髓、题面和题解会自动识别 `$…$` / `$$…$$` / `\(…\)` / `\[…\]`，用随插件分发的 KaTeX 排版（无外部 CDN）；KaTeX 未加载时会退化为内置的轻量渲染，而不是露出源码。

## 对话工具

三个工具都通过 `action` 区分操作，返回一段可读摘要。

### `oi_kb` —— 知识点树

```
oi_kb action=seed                           # 写入内置的两棵树（幂等，已存在则只补缺）
oi_kb action=tree level=2                   # 打印算法知识树（2 层深度）
oi_kb action=tree tree=idea depth=2         # 打印思路树
oi_kb action=show node="动态规划/斜率优化"   # 节点详情（思路节点显示关联题与洞察）
oi_kb action=add parent="图论" name="2-SAT" kind=concept summary="..."
oi_kb action=update node="2-SAT" mastery=weak note="只会模板，不会建图"
oi_kb action=move node="2-SAT" parent="图论/连通性"
oi_kb action=remove node="2-SAT" mode=reparent
oi_kb action=search query="单调"
oi_kb action=map_tag tag="2-sat" node="图论/连通性/2-SAT"
oi_kb action=report                        # 掌握度报告
oi_kb action=gaps                          # 最该补的缺口
oi_kb action=recommend count=5             # 推荐练习题（需要 CF 缓存或已绑定账号）
oi_kb action=weak                          # 面板同款：随机抽候选 → 挑命中你最弱知识点的一道
oi_kb action=obs_tree depth=3              # 观察树：精髓观察的层级结构与计数
oi_kb action=obs_patterns                  # 观察句式库：所有节点上沉淀的「常见观察」
oi_kb action=obs_patterns query="二分"      # 按关键词过滤观察句式
oi_kb action=obs_unassigned limit=20        # 还没挂到观察节点的观察（附候选节点）
oi_kb action=similar a=abc226_h b=abc249_g # 两题相似度（观察/其他洞察/算法点）
oi_kb action=similar a=abc226_h            # 与库内最像的一道比
oi_kb action=similar candidates="abc300_f,agc070_a" threshold=0.3
oi_kb action=novel candidates="..."        # 反套路推荐：最陌生的候选题
oi_kb action=calibrate                     # 用已做题校准阈值
```

### `oi_problem` —— 题目与洞察

```
oi_problem action=add url="https://codeforces.com/problemset/problem/1234/E"
   # 也可以 url="luogu:P1234" / url="atcoder:abc300_f" / 直接给 platform+key

oi_problem action=add url="https://codeforces.com/problemset/problem/1234/E" \
  essence="答案关于操作次数单调，二分判定即可"

oi_problem action=add url="https://atcoder.jp/contests/abc300/tasks/abc300_f" \
  statement="..." solution="..." \
  insights="先观察答案随操作次数的单调性 | 二分答案 + 差分 check | 注意空集情况"

oi_problem action=add_insight problem="CF 1234E" kind=trick text="把交替和改写成前缀和之差" nodes="贡献拆分"

oi_problem action=add url="atcoder:abc999_z" pool=quiz verdict=unsolved \
  # 只进「未通过出题池」：不挂知识树、不计入统计、不进相似度基线，供 P1 方向训练抽题
oi_problem action=update problem="CF 1234E" verdict=attempted
oi_problem action=stuck problem="CF 1234E" stage=observe   # 卡点：observe/derive/implement/debug
oi_problem action=classify problem="CF 1234E"    # 按标签/题面重新挂知识点
oi_problem action=show problem="CF 1234E"
oi_problem action=list verdict=attempted
```

`insights` 用 `|` 分隔多行；每条可以用 `kind: 文本` 指定类别，不指定则按关键词猜测。

### `oi_account` —— 账号与同步

```
oi_account action=add platform=codeforces handle=tourist
oi_account action=add platform=atcoder handle=your_handle
oi_account action=add platform=luogu handle=123456        # 必须是数字 UID
oi_account action=sync platform=codeforces                # 或 handle=...，不填则全部
oi_account action=list
oi_account action=remove platform=luogu handle=123456
```

同步之后，`oi_kb action=report` / `gaps` / `recommend` 会把这些已通过的题算进掌握度。

## 两棵树，各管一件事

- **算法知识树**回答「这题考什么」：节点靠 Codeforces 标签和题目挂载获得证据，算覆盖率、难度分位与风险。它的作用是对照账号记录，找出没碰过的算法方向。
- **思路树**回答「这类题该怎么想」：节点不靠标签，只靠你亲手写下的洞察。比如「贡献拆分」「正难则反」「二分答案转判定」「势能分析与均摊」「补图与反向图」。每道题的 `essence` 和五类洞察会挂到这些节点上，节点按洞察条数定级（≥6 已沉淀成体系、≥3 有苗头、≥1 只有零散记录、0 还没记录）。

现有 11 个分支：转化与观察、构造与证明、搜索与枚举、DP 与计数、数据结构与离线、图论建模、交互与随机化、**审题与拆解**（条件表三列、答案形态先猜、枚举最特殊元素、恰好 k 转至少 k、端点与断点、小 n 手算、数据范围反推复杂度）、**分治与优化**（跨中点分治、大小分类、dp 写成直线、WQS、倍增、重儿子保留、按时间分治）、**概率与计数**（指示变量、二项式反演、多项式卷积、随机权值判等、终态倒推、矩阵加速、双射）、**实验与验证**（暴力对拍、极端数据、打表找递推、反例搜索、打印中间量、checker）。后四个分支是先搭骨架、暂不挂题，节点名都写成「触发条件 → 具体动作」，避免成为空泛的口号。

两棵树的用途不同，所以别把它们混在一起看：算法树覆盖率高不等于会想题，思路树才是训练 OI/ICPC 思路的地方。`oi_kb action=report` 会同时给出两边的空白方向。

第三层结构是**观察树**（`kb.obsNodes`，67 个节点，8 个分支：结构性质、转化与化归、计数与期望、贪心与决策、图与结构、代数与数论、交互与信息、搜索空间）。它比思路树再细一层，专门记「这一步到底看出了什么」——例如「不变量与势能」下面会继续分成守恒量、单调解、奇偶性、势能函数。

每个观察节点上还挂着一组**观察句式**（`node.patterns`，当前 167 条候选、其中 53 条已由真题证据确认，用 `oi_kb action=obs_patterns` 浏览）：从 Codeforces [Good Observations](https://codeforces.com/blog/entry/118706)、[Tricks that I learnt while practicing](https://codeforces.com/blog/entry/84150)、博客园 [OI trick？](https://www.cnblogs.com/thousandsofyears/p/18990424)、[OI Wiki 常见技巧](https://github.com/oi-wiki/oi-wiki/blob/master/docs/contest/common-tricks.md) 以及题解里反复出现的结论中整理出来的「触发条件 + 结论 + 用途」。录题或复习时先扫这些句式，比盲翻题解快。

每道题还有 1–3 条**精髓观察**（`problem.keyObservations`）：分析中最长、最关键的跳跃。`oi_problem action=add` 时洞察若标了 `key: true` 就优先入选，否则按洞察文本长度取前三条。它们不只是一行文字，还会被用来算题目之间的相似度：

```text
sim(a,b) = 0.60·观察节点重叠 + 0.22·其他洞察重叠 + 0.18·算法节点重叠
```

- 观察重叠按树深度加权（`0.5 + 0.5·d/d_max`），再乘**稀有度系数**（IDF）：像「归约到已知模型」「单调性」这种几乎每题都挂的泛节点只算弱证据，具体机制节点才算硬证据；若两题共同观察全是泛节点，观察分再打 0.35–1.0 的折；
- 洞察没写 `obsNodes` 时，会用观察节点的名字/别名在洞察正文里兜底匹配一次，匹配上的权重 ×0.75（自动匹配不如人工挂的可靠）；
- 最后乘**难度差系数**：`1 − 0.4·min(1, |Δrating|/1500)`。3300 的题和 1100 的题骨架再像，也不该算成同一类熟题；
- **不算题面/题解文本相似度**，所以「同一套模板的不同表述」不会被误判成相似；
- 每个候选题都和库内所有已做题算一遍，取最大值 `minSimilarity`；低于阈值（默认 0.3，可用 `calibrate` 按你自己的分布校准）就判定为「没见过这类想法」。

反套路推荐的候选可以手输题号，也可以先随机抽未做过的题（`dev/sample-pick.mjs` 抽题 → `dev/atcoder-digest-fetch.mjs --tasks ...` 抓题面题解 → 消化成 `sample-*.json` → `dev/sample-apply.mjs` 入库）。候选题带 `sample:true`，只参与比较，不计入统计与基线。

录入题目时建议的流程：

1. 先写 `essence`：一句话说清这题最关键的那一步；
2. 再按五类拆洞察，每条尽量短、可迁移，`nodes` 指向思路树节点；
3. 如果需要，把最关键的观察标成 `key: true`，它会成为这道题的精髓观察；
4. 最后用 `oi_problem action=add` 或 `add_insight` 写进库。

## 五个洞察类别

知识点树上真正「可迁移」的部分都记在洞察里，而不是只打标签：

- **观察 `observation`**：题目里先被看出来的性质（单调性、奇偶性、答案与某个量同阶…）。
- **套路 `trick`**：可命名的固定手法（反图、拆贡献、根号分治、势能分析…）。
- **思路 `idea`**：从观察到算法的推导主线。
- **思考方向 `direction`**：下次遇到同类题该往哪想（「先想必要条件」「先枚举小情况找规律」）。
- **坑点 `pitfall`**：写挂过的边界、溢出、复杂度陷阱。

添加洞察时会沿文本自动匹配节点名（两棵树都匹配）；匹配不到就只挂在题目上，此时用 `nodes` 显式指定思路节点，后续也可用 `map_tag` / `classify` 补。

思路节点的分数不看刷题量，只看沉淀：

$$
\text{ideaScore} = 0.7\cdot\frac{\min(\text{insights},8)}{8} + 0.3\cdot\frac{\min(\text{linkedProblems},12)}{12}
$$

所以「做了 20 道 2-SAT 但一条总结都没写」在思路树上仍然是空白——这正是这个插件想暴露的东西。

## 文本规范

面板用 KaTeX 渲染公式，所以录入的每一句话都遵循同一套写法：

- **一句话说清「触发条件 → 动作/结论 → 复杂度」**，不写「这题」「我们」「搞定」这类口语，也不写比喻。
- 公式一律用 `$…$`（块级 `$$…$$`），变量、比较符、求和、箭头都放进公式；中文与公式之间不加空格。
- 数组下标写成下标：`$dp_{i,j}$`、`$a_i$`，不写 `dp[i][j]`。
- 构造出来的序列用反引号包成代码：`` `1,2,1,2,3,4` ``。
- 禁用 Unicode 运算符（`≤`、`×`、`⇒` 等），统一改写成 `\le`、`\times`、`\Rightarrow`。

`dev/kb-lint.mjs` 会用随包分发的 KaTeX 实解析全库文本，检查 `$` 是否成对、花括号是否闭合、控制字符与未转义符号；出问题会直接列出题号与字段。

## 卡点记录

过没过只是结果，**卡在哪一步**才决定下一步练什么。每道题可以标一个卡点阶段：

| stage | 含义 | 对应训练 |
|---|---|---|
| `observe` | 读完了但抓不到关键那一步 | 观察召回、条件表、先写必要条件 |
| `derive` | 有观察，但推不到能写的形式 | 推导链练习、把「缺的那步」写出来 |
| `implement` | 知道怎么做，码不出来或写不完 | 限时实现、写前列步骤与边界 |
| `debug` | 写完了过不了样例 / WA | 对拍、边界清单、小数据自测 |

用法：

- 面板：题目详情里点「卡在哪一步」的四个按钮，再点一次可取消；
- 对话：`oi_problem action=stuck problem="..." stage=observe`，`stage` 留空清除；
- `oi_kb action=report` 会多出「卡点分布」一节，并给出最主要卡点的针对性建议。

分布数据只统计正式题（`sample` 候选题不计入）。

## 掌握度怎么算

每个节点先看**已通过的题**（含账号同步来的），再看**手写掌握度**。

$$
\text{score} = 0.45\cdot \text{coverage} + 0.30\cdot \text{depth} + 0.25\cdot \text{insight}
$$

- $\text{coverage} = 1 - e^{-\text{solved}/2.5}$：做过的题越多越接近 1，避免刷两题就满分；
- $\text{depth}$ 用该节点题目的 $p75$ 分归一：$\mathrm{clamp}\big((p75-1100)/1500,0,1\big)$；
- $\text{insight}$ 由挂在节点上的洞察数量与类别多样性决定；
- 手写 `mastery` 会覆盖自动值（`expert` / `strong` / `ok` / `weak` / `poor` / `unknown`）。

熟练度分五档，由「题量 + 峰值难度」定，而不是由 $\text{score}$ 切（题量上千后 $\text{score}$ 会全部饱和，分不出层次）：

| 标记 | 档位 | 判定 |
| --- | --- | --- |
| ◆ | 非常熟练 | 题目的 75 分位 $\ge 2900$ 且已通过 $\ge 30$ 道 |
| ● | 熟练 | 75 分位 $\ge 2500$ 且已通过 $\ge 15$ 道 |
| ◐ | 还行 | 已通过 $\ge 8$ 道 |
| ▲ | 不熟练 | 已通过 $\ge 2$ 道 |
| ▽ | 非常不熟练 | 只通过 1 道，或只有洞察没有通过记录 |
| ○ | 空白 | 这个节点还没有任何通过记录或洞察 |
| · | 未测 | 账号数据落不到这个节点 |

手写 `mastery` 会直接指定档位（`expert` / `strong` / `ok` / `weak` / `poor` / `unknown`），不再走自动判定。

思路树用另一套：洞察 ≥8 为「已内化」，≥6 为「已沉淀」，≥3 为「有苗头」，≥1 为「只有零散记录」。

风险（该补程度）：

$$
\text{risk} = (1-\text{rated})\cdot(0.3+0.7\cdot \text{rated}_{\text{parent}})\cdot(1+0.8\cdot\text{unsolved}^\*+0.4\cdot\text{attempted}^\*)\cdot 1.15^{\text{leaf}}
$$

其中 $\text{rated}$ 默认用「只看题量与难度」的 $\text{dataScore}=(\text{coverage}+\text{depth})/0.75$（归一化后），只有在手写 `mastery` 时才用含洞察的 $\text{score}$。这样在还没录任何洞察时，风险榜不会被「都缺总结」淹没。

另外两个修正项：

- **难度触顶**：节点题目的最高分低于你整体 75 分位 150 分以上时，风险 ×1.2，并写明「最高只做到 X 分」；
- **试过未过**：账号同步发现的「提交过但从没 AC」的题，按标签计入对应节点并抬高风险（按最多 3 道封顶），`report` 会直接列出这些题；
- **未测节点**：Codeforces 的粗标签（`data structures` / `graphs` / `dp`）无法落到「线段树」「连通性」这类细分节点上。这些节点标为 **未测（·）**，既不进风险榜也不算掌握，避免把「测不到」误报成「空白」。

做完的题按 Codeforces 标签（或题目挂的节点）同时计入该节点和它的所有祖先节点，同一题不重复计数。AtCoder 题目没有标签，只计入已通过总数，不参与知识点统计。

## 账号同步的边界

- **Codeforces**：公开 API，分页拉 `user.status`，取 `OK` 的题；同时把**提交过但从没 AC 的题**记为「试过未过」，计入对应知识点的风险；无需登录。
- **AtCoder**：走 kenkoooo 的公开 API（提交记录 + 题目/难度表），无需登录；题库文件本地缓存 7 天。
- **洛谷**：没有公开 API，可以填**数字 UID、用户名或用户主页链接**（用户名会先查一次 UID）。同步需要登录 Cookie：浏览器登录洛谷后按 F12 → Application → Cookies → `luogu.com.cn`，把 `__client_id` 和 `_uid` 拼成 `__client_id=…; _uid=…` 填进账号的 cookie 字段（面板「账号」里也能贴）。同步时先完成一次 `C3VK` 反爬握手，再逐页读记录页里内嵌的 JSON（每页 20 条、AC 去重），因此耗时随题量增长（两千多条 AC 约 20 秒）。Cookie 只写入本机 `kb.json`，不会回显。失败会如实报错而不是静默返回空。

只有**题目元数据与通过状态**会被保存，不保存代码。网络失败或不稳定时，最近一次成功的结果会保留。

洛谷站内有一批 `CF…` / `AT_…` 镜像题，同步时会按题号归回原平台：既能和 Codeforces / AtCoder 的做题记录去重，Codeforces 镜像题还会从题库缓存里借到标签和难度。纯洛谷题只有难度、没有算法标签，所以主要增加总题量与难度样本，只有带标签的节点才会被重新评估。

## 数据文件

默认 `~/.dsh/oi-knowledge/kb.json`（Windows：`C:\Users\<你>\.dsh\oi-knowledge\kb.json`），同目录下还有题库缓存。可以在插件的 `config.dataDir` 里指定别的位置。写入使用「临时文件 + rename」原子替换，不会写坏。

备份就是复制这个文件；删除即重置。

## 开发与自测

```powershell
$node = "C:\Users\<你>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node dev\smoke.mjs        # 知识树/题目/账号/分析全链路自测，不联网
& $node dev\client-load.mjs  # 客户端模块加载与 slot 注册形状
& $node dev\math-test.mjs    # 轻量 LaTeX 渲染器的 14 项断言
& $node dev\audit.mjs        # 全库体检：缺挂载的观察、孤立节点、坏引用、state 体积
& $node dev\route-check.mjs  # HTTP 路由：鉴权、state、gzip、404/400、POST call
& $node dev\similarity-test.mjs # 相似度模型：同构=1、难度打折、泛节点降权、样本不进基线
```

目录：

```
index.js          Host 入口：3 个工具 + HTTP 路由
client.js         Web 面板（单文件 React，无构建）
lib/store.js      kb.json 读写、原子写、id
lib/tree.js       树操作与节点解析（id / 路径 / 名称）
lib/taxonomy.js   内置算法知识树种子 + Codeforces 标签映射
lib/ideas.js      内置思路树种子（105 个节点，11 个分支）
lib/observation.js 观察树种子（58 个叶子 + 167 条观察句式）
lib/similarity.js 观察/洞察/算法三层相似度与阈值校准
lib/analysis.js   覆盖/掌握度/风险/推荐
lib/sync.js       三个平台的同步
lib/service.js    业务逻辑（工具与面板共用）
```

### 批量补题（质量优先）

要补题（抓题面+题解 → 提炼精髓）时，默认**全文读**：题面 + 题解在 1.3 万字符以内不压缩。

```powershell
& $node dev\atcoder-digest-fetch.mjs --min 2000 --max 2800 --limit 10
```

只有整场 PDF、几十道题的合集这类明显超长的来源才加 `--brief`（题面 3.5k、题解 9k 封顶），截掉与本题无关的正文：

```powershell
& $node dev\atcoder-digest-fetch.mjs --min 2000 --max 2800 --limit 10 --brief
```

- 不加 `--brief` 会保留整篇题解（最长的整场 PDF 有 5 万字符）。
- 截断处会留「…（已截断，原文 N 字）」标记：如果关键推导正好落在截断外，对那一题单独 `--tasks <key> --refetch`（不加 `--brief`）重读全文，不在预算上妥协。
- 洞察每条都要写具体做法/公式/复杂度；推不出就跳过，不编。
- 配套的 agent skill 在插件仓库外：`C:\Users\lenovo\.dsh\skills\oi-digest\SKILL.md`，DSH 会自动把它加进可用技能列表。

## 定期体检

`dev/audit.mjs` 会把当前库的「脏点」列出来，适合在批量录题或联网同步之后跑一次：

- 缺精髓 / 缺洞察的题：说明那几道还没真正消化；
- 观察没挂到观察节点：多是题目特有的推导，粗粒度树接不住，属于正常损耗，可以手动补 `obsNodes`；
- 孤立节点、同级重名、指向不存在节点的 `tagMap`：数据损坏，应该修；
- `state` 体积：面板每次打开都会拉这份数据，脚本会打印各段大小，方便发现意外的膨胀。

## 已知限制

- 洛谷接口不稳定，属于尽力而为；失败会报错。
- 「重新分类」只依据标签和题面文字，不会重新读题解推理。
- 面板的视觉与交互尚未在浏览器里人工验收（当前环境无浏览器自动化），工具与注册逻辑已有自动化自测。
- 题目特有的推导未必能自动挂到观察节点（当前约四成观察只有文字、没有节点归属）。观察树是粗粒度骨架，接不住所有细节；宁可空着，也不硬塞一个泛节点去污染相似度。
