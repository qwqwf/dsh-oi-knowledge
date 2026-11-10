// 把观察节点与其真题 observation 导出成分批 JSON，供子代理提炼「有证据的句式」。
// 用法：node dev/obs-export.mjs [--chunks 3]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KB = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json');
const OUT_DIR = path.join(process.cwd(), 'dev', 'digest', 'obs');
const args = process.argv.slice(2);
const chunksArg = args.indexOf('--chunks');
const chunks = chunksArg >= 0 ? Math.max(1, Number(args[chunksArg + 1]) || 3) : 3;

const kb = JSON.parse(fs.readFileSync(KB, 'utf8'));
const nodes = kb.obsNodes || [];
const byId = new Map(nodes.map((n) => [n.id, n]));
const pathOf = (node) => {
  const names = [];
  let cur = node;
  let guard = 0;
  while (cur && guard++ < 32) {
    names.unshift(cur.name);
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return names.join('/');
};

const obsByNode = new Map(nodes.map((n) => [n.id, []]));
for (const problem of kb.problems || []) {
  if (problem.sample) continue;
  for (const insight of problem.insights || []) {
    if (insight.kind !== 'observation') continue;
    for (const nodeId of insight.obsNodes || []) {
      const bucket = obsByNode.get(nodeId);
      if (!bucket) continue;
      bucket.push({
        problemId: problem.id,
        key: `${problem.platform}:${problem.key}`,
        title: problem.title || problem.key,
        text: insight.text,
        key: insight.key === true,
      });
    }
  }
}

const groups = nodes
  .filter((n) => n.parent)
  .map((n) => ({
    nodeId: n.id,
    path: pathOf(n),
    name: n.name,
    education: n.summary || '',
    observations: obsByNode.get(n.id),
  }))
  .filter((g) => g.observations.length >= 2);

fs.mkdirSync(OUT_DIR, { recursive: true });
const per = Math.ceil(groups.length / chunks);
let total = 0;
for (let i = 0; i < chunks; i += 1) {
  const slice = groups.slice(i * per, (i + 1) * per);
  const file = path.join(OUT_DIR, `obs-nodes-${i + 1}.json`);
  fs.writeFileSync(file, JSON.stringify(slice, null, 2), 'utf8');
  total += slice.length;
  console.log(`${path.relative(process.cwd(), file)}: ${slice.length} nodes`);
}
console.log(`nodes with >=2 observations: ${groups.length} / ${nodes.length - 1}`);
console.log(`exported: ${total}`);
