/**
 * Merge a delta translation pass into the full dictionary the build consumes.
 *
 * The usual update adds and rewords a few hundred strings; re-translating all of
 * them would churn thousands of reviewed lines for no gain. This tool is the splice:
 * it walks the pinned build's English source, takes the new Korean for keys a
 * translation pass produced (`_work/delta/<namespace>.json`), keeps every other
 * reviewed line byte-for-byte from `data/ko.json`, and refuses to ship a reworded
 * English string that nobody re-read.
 *
 * It then writes the same chunk/translation layout the existing pipeline consumes,
 * so `npm run verify` and `npm run assemble` work unchanged, and it maintains
 * `data/dead-keys.json` so a translation retired by one build is reused if a later
 * build brings its key back.
 *
 * Usage: node tools/merge-delta.mjs [extractedJson] [deltaDir] [chunksDir] [koDir]
 *   defaults: ../_work/extracted.json, ../_work/delta, ../_work/chunks, ../_work/ko
 * @returns exit code 1 when a key has no Korean or a reworded key was not re-reviewed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const defaultWork = path.resolve(pkgRoot, '..', '_work')

const extractedFile = process.argv[2] ?? path.join(defaultWork, 'extracted.json')
const deltaDir = process.argv[3] ?? path.join(defaultWork, 'delta')
const chunksDir = process.argv[4] ?? path.join(defaultWork, 'chunks')
const koDir = process.argv[5] ?? path.join(defaultWork, 'ko')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const extracted = readJson(extractedFile)
const previous = readJson(path.join(pkgRoot, 'data', 'ko.json'))
const previousEnglish = readJson(path.join(pkgRoot, 'data', 'en.json'))
const sourcePin = fs.existsSync(path.join(pkgRoot, 'data', 'source.json'))
  ? readJson(path.join(pkgRoot, 'data', 'source.json'))
  : undefined
const scope = fs.existsSync(path.join(pkgRoot, 'data', 'scope.json'))
  ? readJson(path.join(pkgRoot, 'data', 'scope.json'))
  : { excludedNamespaces: {}, excludedKeys: {} }

const excludedNamespaces = new Set(Object.keys(scope.excludedNamespaces ?? {}))
const excludedKeys = new Set()
for (const [ns, keys] of Object.entries(scope.excludedKeys ?? {})) {
  for (const key of keys) excludedKeys.add(`${ns}.${key}`)
}
const isExcluded = (ns, key) => excludedNamespaces.has(ns) || excludedKeys.has(`${ns}.${key}`)

const delta = new Map()
if (fs.existsSync(deltaDir)) {
  for (const name of fs.readdirSync(deltaDir).filter((entry) => entry.endsWith('.json'))) {
    const ns = name.slice(0, -5)
    delta.set(ns, readJson(path.join(deltaDir, name)))
  }
}

/* Retired translations live in the repository so a returning key can reuse them. */
const deadFile = path.join(pkgRoot, 'data', 'dead-keys.json')
const ledger = fs.existsSync(deadFile) ? readJson(deadFile) : { _comment: [], retired: {} }
ledger.retired ??= {}
const retired = new Map(Object.entries(ledger.retired))

const version = sourcePin?.target?.dshVersion ?? 'unknown'
const groups = []
let carried = 0
let fresh = 0
let revived = 0
const missing = []
const stale = []

for (const ns of Object.keys(extracted).sort()) {
  /* An excluded namespace still enters the English baseline — the build ships it,
   * and data/en.json mirrors the build. Only its Korean is skipped. */
  const english = extracted[ns].en ?? {}
  if (Object.keys(english).length === 0) continue
  const fromDelta = delta.get(ns) ?? {}
  const fromPrevious = previous[ns] ?? {}
  const korean = {}

  for (const [key, value] of Object.entries(english)) {
    if (isExcluded(ns, key)) continue
    if (typeof fromDelta[key] === 'string') {
      korean[key] = fromDelta[key]
      if (key in fromPrevious) carried++
      else fresh++
      continue
    }
    if (typeof fromPrevious[key] === 'string') {
      /* A reworded English string must be re-reviewed; carrying the old Korean
       * would silently pair a new sentence with a translation of the old one. */
      if (previousEnglish[ns]?.[key] !== undefined && previousEnglish[ns][key] !== value) {
        stale.push(`${ns}.${key}`)
      }
      korean[key] = fromPrevious[key]
      carried++
      continue
    }
    const retiredEntry = retired.get(`${ns}.${key}`)
    if (retiredEntry !== undefined) {
      korean[key] = retiredEntry.ko
      revived++
      retired.delete(`${ns}.${key}`)
      continue
    }
    missing.push(`${ns}.${key}`)
  }

  groups.push({ ns, en: english, zh: extracted[ns].zh ?? {}, ko: korean })
}

/* Retire the translations whose keys this build no longer ships. */
for (const ns of Object.keys(previous)) {
  const english = extracted[ns]?.en ?? {}
  for (const [key, korean] of Object.entries(previous[ns])) {
    if (key in english) continue
    const id = `${ns}.${key}`
    if (retired.has(id)) continue
    retired.set(id, {
      en: previousEnglish[ns]?.[key] ?? null,
      ko: korean,
      retiredAt: version,
    })
  }
}

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`, 'utf8')
}

const chunkFile = path.join(chunksDir, 'chunk-00.json')
const koFile = path.join(koDir, '00.json')
writeJson(chunkFile, groups.map((group) => ({ ns: group.ns, en: group.en, zh: group.zh })))
writeJson(path.join(chunksDir, '_manifest.json'), [
  {
    id: '00',
    file: path.basename(chunkFile),
    groups: groups.length,
    keys: groups.reduce((sum, group) => sum + Object.keys(group.en).length, 0),
    namespaces: groups.map((group) => group.ns),
  },
])
writeJson(koFile, { id: '00', groups: groups.map((group) => ({ ns: group.ns, ko: group.ko })) })
writeJson(deadFile, {
  _comment: [
    'Translations retired because a DSH build stopped shipping their key. tools/merge-delta.mjs',
    'maintains this file: a returning key reuses its retired translation instead of starting over,',
    'and the ledger is pruned when that happens. Git history holds the full previous dictionary.',
  ],
  retired: Object.fromEntries([...retired.entries()].sort()),
})

console.log(`namespaces: ${groups.length}`)
console.log(`keys: ${groups.reduce((sum, group) => sum + Object.keys(group.en).length, 0)}`)
console.log(`fresh ${fresh}, carried over ${carried}${revived > 0 ? `, revived ${revived}` : ''}`)
console.log(`retired translations on file: ${retired.size}`)
if (stale.length > 0) {
  console.log(`\nreworded English without a re-reviewed translation (${stale.length}):`)
  for (const key of stale.slice(0, 40)) console.log(`  ${key}`)
}
if (missing.length > 0) {
  console.log(`\nno Korean (${missing.length}):`)
  for (const key of missing.slice(0, 40)) console.log(`  ${key}`)
}
if (missing.length > 0 || stale.length > 0) process.exitCode = 1
