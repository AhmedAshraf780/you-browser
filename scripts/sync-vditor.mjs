// Copy Vditor's runtime assets into the renderer's public dir.
//
// Vditor loads its markdown engine (Lute), syntax highlighter, math and
// diagram renderers from `<cdn>/dist/...` at runtime. The Blinko app serves
// its own copy of that tree; we do the same so the editor works offline and
// no request ever leaves the machine. `cdn` is set to './vditor' in the
// editor, so the files must live at <public>/vditor/dist/**.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'vditor', 'dist')
const dest = join(root, 'src', 'renderer', 'public', 'vditor', 'dist')
const stamp = join(root, 'src', 'renderer', 'public', 'vditor', '.version')

async function pkgVersion(pkgDir) {
  try {
    return JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf-8')).version
  } catch {
    return ''
  }
}

async function main() {
  if (!existsSync(src)) {
    console.error('[sync-vditor] node_modules/vditor is missing — run `npm install` first.')
    process.exit(1)
  }
  const version = await pkgVersion(join(root, 'node_modules', 'vditor'))
  const current = existsSync(stamp) ? (await readFile(stamp, 'utf-8')).trim() : ''
  if (current === version && existsSync(join(dest, 'index.js'))) return

  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  await cp(src, dest, { recursive: true })
  await writeFile(stamp, version)
  console.log(`[sync-vditor] copied vditor@${version} → src/renderer/public/vditor/dist`)
}

await main()
