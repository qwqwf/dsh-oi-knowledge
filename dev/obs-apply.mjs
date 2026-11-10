// 把子代理归纳出的「有证据句式」写回观察节点。
// 用法：node dev/obs-apply.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KB = path.join(os.homedir(), '.dsh', 'oi-knowledge', 'kb.json');
const OUT_DIR = path.join(process.cwd(), 'dev', 'digest', 'out');

const kb = JSON.parse(fs.readFileSync(KB, 'utf8'));
const problems = kb.problems || [];
const byKey = new Map(problems.map((p) => [`${p.platform}:${p.key}`, p]));
const byId = new Map((kb.obsNodes || []).map((n) => [n.id, n]));
const byProblemId = new Map(problems.map((p) => [p.id, p]));
const byPlainKey = new Map();
for (const problem of problems) if (!byPlainKey.has(problem.key)) byPlainKey.set(problem.key, problem);

const resolveProblem = (ref) => {
  const key = String(ref);
  return byKey.get(key) || byProblemId.get(key) || byPlainKey.get(key) || null;
};

const files = fs
  .readdirSync(OUT_DIR)
  .filter((name) => /^obs-patterns-\d+\.json$/.test(name))
  .sort();
if (!files.length) {
  console.error('没有找到 dev/digest/out/obs-patterns-*.json');
  process.exit(1);
}

let nodesTouched = 0;
let patternsWritten = 0;
let skipped = 0;

for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf8'));
  if (!Array.isArray(raw)) continue;
  for (const entry of raw) {
    const node = byId.get(entry.nodeId);
    if (!node) continue;
    const patterns = [];
    for (const pattern of entry.patterns || []) {
      const text = String(pattern.text || '').trim();
      if (!text) continue;
      const examples = [];
      for (const key of pattern.evidence || []) {
        const problem = resolveProblem(key);
        if (!problem) continue;
        if (examples.some((item) => item.id === problem.id)) continue;
        examples.push({ id: problem.id, title: problem.title || problem.key });
      }
      if (examples.length < 2) {
        skipped += 1;
        continue;
      }
      patterns.push({ text, examples, verified: true });
    }
    if (!patterns.length) continue;
    node.patterns = patterns;
    nodesTouched += 1;
    patternsWritten += patterns.length;
  }
}

const tmp = `${KB}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(kb, null, 2), 'utf8');
fs.renameSync(tmp, KB);
console.log(`写入 ${nodesTouched} 个节点 / ${patternsWritten} 条有证据句式；证据不足丢弃 ${skipped} 条。`);
console.log('别忘了重载插件。');
