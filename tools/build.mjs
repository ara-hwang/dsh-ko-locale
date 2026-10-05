/**
 * Build the shipped artifacts from the authored sources.
 *
 *   src/index.js    -> lib/index.js      (host half, copied verbatim)
 *   src/client.js   -> lib/client.js     (browser half, dictionary literal inlined)
 *   data/ko.json    -> inlined into lib/client.js as the DICTIONARIES literal
 *
 * The browser bundle is generated rather than hand-maintained so the ~2k Korean
 * strings cannot drift from data/ko.json, and no bundler or network access is
 * needed: the client half has no imports, so the only work is inlining data.
 *
 * Usage: node tools/build.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

/** Marker the client template carries where the dictionary literal belongs. */
const PLACEHOLDER = '/*__KO_DICTIONARIES__*/ {}'

const ko = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'data', 'ko.json'), 'utf8'))
const template = fs.readFileSync(path.join(pkgRoot, 'src', 'client.js'), 'utf8')

if (!template.includes(PLACEHOLDER)) {
  throw new Error(`src/client.js no longer contains the dictionary placeholder ${PLACEHOLDER}`)
}

// Drop any namespace that ended up empty so the shipped literal stays honest.
const dictionaries = {}
for (const ns of Object.keys(ko).sort()) {
  if (Object.keys(ko[ns]).length > 0) dictionaries[ns] = ko[ns]
}

const bundles = Object.keys(dictionaries).length
const keys = Object.keys(dictionaries).reduce((sum, ns) => sum + Object.keys(dictionaries[ns]).length, 0)

const libDir = path.join(pkgRoot, 'lib')
fs.mkdirSync(libDir, { recursive: true })

const client = template.replace(PLACEHOLDER, JSON.stringify(dictionaries))
fs.writeFileSync(path.join(libDir, 'client.js'), client, 'utf8')
fs.copyFileSync(path.join(pkgRoot, 'src', 'index.js'), path.join(libDir, 'index.js'))
fs.writeFileSync(
  path.join(libDir, 'dictionaries.json'),
  `${JSON.stringify(dictionaries, null, 1)}\n`,
  'utf8',
)

const kb = (file) => (fs.statSync(file).size / 1024).toFixed(1)
console.log(`inlined ${keys} Korean strings across ${bundles} namespaces`)
console.log(`wrote lib/client.js       ${kb(path.join(libDir, 'client.js'))} KiB`)
console.log(`wrote lib/index.js        ${kb(path.join(libDir, 'index.js'))} KiB`)
console.log(`wrote lib/dictionaries.json ${kb(path.join(libDir, 'dictionaries.json'))} KiB`)
