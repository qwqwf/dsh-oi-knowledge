import fs from 'node:fs'
const dir = process.argv[2] || '.'
const version = process.argv[3] || '1.3.37'
const pkgPath = `${dir}/package.json`
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.version = version
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
const clientPath = `${dir}/client.js`
const src = fs.readFileSync(clientPath, 'utf8')
const next = src.replace(/const CLIENT_BUILD = '[^']*'/, `const CLIENT_BUILD = '${version}'`)
if (next === src) {
  console.log('WARN client build not found')
} else {
  fs.writeFileSync(clientPath, next)
}
console.log(`bumped ${dir} -> ${version}`)
