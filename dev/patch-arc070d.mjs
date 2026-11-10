import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const kbPath = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json')
const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'))

const patches = [
  {
    key: 'arc070_d',
    essence:
      '设诚实者 $A$ 人、不亲切者 $B$ 人，仅当 $A>B$ 时有解。沿「$a$ 声称 $b$ 诚实」的 $Y$ 边维护长度 $B+1$ 的链：若链上 $B+1$ 人全不亲切则超过 $B$，矛盾，故最早入链的 $a_0$ 必诚实，且诚实性沿 $Y$ 边向前传递。用阈值 $need=B+1$ 的栈做消去：回答 $Y$ 压栈，回答 $N$ 弹栈并令 $need\\leftarrow need-1$；栈长达到 $need$ 即定位一个诚实者（$\\le N$ 次询问），再用 $N$ 次询问确定全体，总询问次数 $\\le 2N$。',
    i20w: '栈维护：$need=B+1$。每轮查询 $\\operatorname{ask}(i,\\text{栈顶})$：回答 $Y$ 则压栈；回答 $N$ 则弹栈并令 $need\\leftarrow need-1$（两人中至少一人不亲切，删除后 $A>B$ 仍成立）。栈长达到 $need$ 时停止，已用 $\\le N$ 次询问定位一个诚实者。',
  },
]

let changed = 0
for (const problem of kb.problems) {
  const patch = patches.find((p) => p.key === problem.key)
  if (!patch) continue
  if (patch.essence && problem.essence !== patch.essence) {
    problem.essence = patch.essence
    changed += 1
  }
  for (const insight of problem.insights || []) {
    if (patch[insight.id] && insight.text !== patch[insight.id]) {
      insight.text = patch[insight.id]
      changed += 1
    }
  }
}

const tmp = kbPath + '.tmp'
fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8')
fs.renameSync(tmp, kbPath)
console.log(`patched ${changed} fields`)
