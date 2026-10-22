/**
 * Measure what the installed DSH build added, reworded or removed relative to the
 * English baseline this pack ships (data/en.json).
 *
 * This is the update gate: run it after `tools/extract-dictionaries.mjs` and before
 * any translation work. It prints the drift as one row per namespace and exits
 * non-zero while any real drift remains, so a stale pack cannot be reported as
 * complete. Entries listed in data/scope.json are reported and skipped, not hidden.
 *
 * Usage: node tools/drift.mjs [extracted.json] [--asar app.asar] [--quiet]
 *   default extracted.json: ../_work/extracted.json
 *   default app.asar: tools/asar.mjs DEFAULT_ASAR
 *   --asar: also verify data/source.json's asar sha256 matches the inspected build
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ASAR } from './asar.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

const args = process.argv.slice(2)
const quiet = args.includes('--quiet')
const explicitAsar = args.includes('--asar') ? args[args.indexOf('--asar') + 1] : undefined
const extractedFile =
  args.find((argument, index) => !argument.startsWith('--') && args[index - 1] !== '--asar') ??
  path.resolve(pkgRoot, '..', '_work', 'extracted.json')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const extracted = readJson(extractedFile)
const english = readJson(path.join(pkgRoot, 'data', 'en.json'))
const sourceFile = path.join(pkgRoot, 'data', 'source.json')
const scope = fs.existsSync(path.join(pkgRoot, 'data', 'scope.json'))
  ? readJson(path.join(pkgRoot, 'data', 'scope.json'))
  : { excludedNamespaces: {}, excludedKeys: {} }

const excludedNamespace = new Set(Object.keys(scope.excludedNamespaces ?? {}))
const excludedKeys = new Set()
for (const [ns, keys] of Object.entries(scope.excludedKeys ?? {})) {
  for (const key of keys) excludedKeys.add(`${ns}.${key}`)
}
const inScope = (ns, key) => !excludedNamespace.has(ns) && !excludedKeys.has(`${ns}.${key}`)

/* ── the drift itself ───────────────────────────────────────────────────── */
const rows = []
let added = 0
let changed = 0
let removed = 0
let skipped = 0

for (const ns of [...new Set([...Object.keys(extracted), ...Object.keys(english)])].sort()) {
  const current = extracted[ns]?.en ?? {}
  const previous = english[ns] ?? {}
  const addedKeys = []
  const changedKeys = []
  const removedKeys = []
  for (const [key, value] of Object.entries(current)) {
    if (!inScope(ns, key)) {
      skipped++
      continue
    }
    if (!(key in previous)) addedKeys.push(key)
    else if (previous[key] !== value) changedKeys.push(key)
  }
  for (const key of Object.keys(previous)) {
    if (!inScope(ns, key)) {
      skipped++
      continue
    }
    if (!(key in current)) removedKeys.push(key)
  }
  if (addedKeys.length + changedKeys.length + removedKeys.length === 0) continue
  rows.push({ ns, added: addedKeys.length, changed: changedKeys.length, removed: removedKeys.length })
  added += addedKeys.length
  changed += changedKeys.length
  removed += removedKeys.length
}

/* ── the build this extract came from ───────────────────────────────────── */
const pinned = fs.existsSync(sourceFile) ? readJson(sourceFile) : undefined
if (!quiet) {
  if (pinned === undefined) {
    console.log('no data/source.json: the pack is not pinned to any build')
  } else {
    console.log(
      `pinned target: DSH ${pinned.target.dshVersion} (${pinned.target.channel ?? 'nightly'}), ${pinned.target.clientBundles ?? '?'} bundles`,
    )
  }
}

const asar = explicitAsar ?? DEFAULT_ASAR
if (explicitAsar !== undefined && pinned !== undefined) {
  const digest = createHash('sha256').update(fs.readFileSync(asar)).digest('hex')
  if (digest !== pinned.target.asarSha256) {
    console.error(`!! ${asar} is not the pinned build (sha256 differs)`)
    process.exitCode = 1
  }
}

/* ── report ─────────────────────────────────────────────────────────────── */
const width = Math.max(12, ...rows.map((row) => row.ns.length))
if (!quiet) {
  console.log('')
  console.log(`${'namespace'.padEnd(width)}  ${'added'.padStart(5)}  ${'changed'.padStart(7)}  ${'removed'.padStart(7)}`)
  for (const row of rows) {
    console.log(`${row.ns.padEnd(width)}  ${String(row.added).padStart(5)}  ${String(row.changed).padStart(7)}  ${String(row.removed).padStart(7)}`)
  }
  console.log('')
  console.log(`added ${added}, changed ${changed}, removed ${removed}  (excluded by data/scope.json: ${skipped})`)
}

/* ── stale exemptions ───────────────────────────────────────────────────── */
for (const ns of excludedNamespace) {
  if (!(ns in extracted)) {
    console.error(`!! scope.json excludes "${ns}", which the extracted build no longer ships`)
    process.exitCode = 1
  }
}

if (rows.length === 0) {
  if (!quiet) console.log(`\nIN SYNC — the pack matches ${pinned?.target.dshVersion ?? 'the extracted build'}`)
} else {
  if (!quiet) console.log('\nOUT OF SYNC — translate the added/changed keys, retire the removed ones, then rebuild')
  process.exitCode = 1
}

process.exit(process.exitCode ?? 0)
