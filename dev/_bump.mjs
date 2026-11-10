import fs from 'node:fs'
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'))
p.version = '1.2.6'
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n', 'utf8')
console.log('version', p.version)
