#!/usr/bin/env node
// Assembles the offline Firefox PDF viewer under src/renderer/public/pdfjs/:
//   web/            — official viewer shell, COMMITTED from the pdf.js tag
//                     matching pdfjs-dist (see README)
//   build/          — pdf.mjs + worker, copied from pdfjs-dist
//   external/       — bcmaps + standard fonts, copied from pdfjs-dist
//   node_modules/   — fluent esm for the viewer's l10n, copied from npm
// Generated output (everything but web/) is gitignored; run on postinstall.
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const NM = path.join(ROOT, 'node_modules')
const DEST = path.join(ROOT, 'src', 'renderer', 'public', 'pdfjs')

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function copyDir(src, dest, skipNames) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipNames && skipNames.has(entry.name)) continue
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d, undefined)
    else if (entry.isFile() && !entry.name.endsWith('.map') && !entry.name.endsWith('.d.ts')) {
      copyFile(s, d)
    }
  }
}

const pdfjs = path.join(NM, 'pdfjs-dist')
if (!fs.existsSync(pdfjs)) {
  console.warn('sync-pdfjs: pdfjs-dist missing, skipping')
  process.exit(0)
}

// engine + worker
copyFile(path.join(pdfjs, 'build', 'pdf.mjs'), path.join(DEST, 'build', 'pdf.mjs'))
copyFile(path.join(pdfjs, 'build', 'pdf.worker.mjs'), path.join(DEST, 'build', 'pdf.worker.mjs'))
// character maps + standard fonts where the official viewer expects them
copyDir(path.join(pdfjs, 'cmaps'), path.join(DEST, 'external', 'bcmaps'))
copyDir(path.join(pdfjs, 'standard_fonts'), path.join(DEST, 'web', 'standard_fonts'))
// fluent esm for viewer l10n (importmap in web/viewer.html points here).
// NOTE: deliberately NOT under a node_modules/ dir — electron-builder's
// `!node_modules/*` excludes would otherwise strip these from the asar.
for (const pkg of ['bundle', 'dom']) {
  copyDir(path.join(NM, '@fluent', pkg, 'esm'), path.join(DEST, 'vendor', '@fluent', pkg, 'esm'))
}
copyDir(path.join(NM, 'cached-iterable', 'src'), path.join(DEST, 'vendor', 'cached-iterable', 'src'))
console.log('sync-pdfjs: done')
