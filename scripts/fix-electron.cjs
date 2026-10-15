#!/usr/bin/env node
// Workaround: extract-zip@2 (used by electron@30 install.js) silently fails
// on newer host Node (e.g. Node 26) — only resources.pak gets extracted,
// no path.txt, so electron-vite dies with "Error: Electron uninstall".
// This falls back to the system `unzip` binary using the already-cached zip.
const { execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const electronDir = path.join(root, 'node_modules', 'electron')
const distDir = path.join(electronDir, 'dist')
const pathTxt = path.join(electronDir, 'path.txt')

function installed() {
  try {
    const { version } = require(path.join(electronDir, 'package.json'))
    const v = fs.readFileSync(path.join(distDir, 'version'), 'utf-8').replace(/^v/, '').trim()
    const p = fs.readFileSync(pathTxt, 'utf-8').trim()
    return v === version && p === 'electron' && fs.existsSync(path.join(distDir, 'electron'))
  } catch {
    return false
  }
}

if (installed()) {
  console.log('electron binary OK')
  process.exit(0)
}

console.log('electron binary missing/broken — attempting manual extract from cache…')
const cacheRoot = process.env.electron_config_cache || path.join(os.homedir(), '.cache', 'electron')
let zip = null
try {
  for (const h of fs.readdirSync(cacheRoot)) {
    const cand = path.join(cacheRoot, h, `electron-v30.5.1-linux-x64.zip`)
    if (fs.existsSync(cand)) {
      zip = cand
      break
    }
  }
} catch (e) {
  console.error('cache scan failed:', e.message)
}
if (!zip) {
  console.error(`no cached electron zip in ${cacheRoot}; run: node node_modules/electron/install.js (needs network)`)
  process.exit(1)
}
execSync(`rm -rf ${distDir} && mkdir -p ${distDir} && unzip -q -o ${zip} -d ${distDir}`, { stdio: 'inherit' })
fs.writeFileSync(pathTxt, 'electron')
try {
  execSync(`chmod +x ${path.join(distDir, 'electron')}`)
} catch {}
console.log(installed() ? 'electron binary fixed' : 'still broken')
process.exit(installed() ? 0 : 1)
