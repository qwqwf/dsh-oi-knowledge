/**
 * 一次性回填：给已有的观察洞察补 obsNodes，并算出每题的精髓观察。
 * 跑完需要重载插件，否则插件内存里的旧 kb 会覆盖回去。
 */
import path from 'node:path'
import os from 'node:os'
import { KbStore } from '../lib/store.js'
import { KnowledgeService } from '../lib/service.js'

const dir = process.argv[2] || path.join(os.homedir(), '.dsh', 'oi-knowledge')
const store = new KbStore({ dir })
const service = new KnowledgeService(store)

const seed = service.seed()
console.log(seed.summary.split('\n')[0])

let observations = 0
let assigned = 0
let keyed = 0
let keyedProblems = 0
service.mutate((kb) => {
  for (const problem of kb.problems) {
    for (const insight of problem.insights || []) {
      if (insight.kind !== 'observation') continue
      observations += 1
      if (!(insight.obsNodes || []).length) {
        insight.obsNodes = service.detectObsNodes(insight.text).map((node) => node.id)
      }
      if ((insight.obsNodes || []).length) assigned += 1
    }
    service.computeKeyObservations(problem)
    keyed += (problem.keyObservations || []).length
    if ((problem.keyObservations || []).length) keyedProblems += 1
  }
})
console.log(`观察洞察 ${observations} 条，其中 ${assigned} 条挂上了观察树节点；${keyedProblems} 道题共记 ${keyed} 条精髓观察。`)
