/**
 * Assemble the shipped dictionary files from the translation work products.
 *
 * Inputs (produced by the extraction and translation passes over the built DSH
 * client bundles — see README.md "Regenerating the pack"):
 *   <chunksDir>/chunk-*.json   [{ pkg, ns, en:{key:text}, zh:{key:text} }, ...]
 *   <koDir>/<id>.json          { id, groups:[{ pkg, ns, ko:{key:text} }, ...] }
 *
 * Outputs:
 *   data/en.json   namespace -> { key: English }   (audit baseline)
 *   data/zh.json   namespace -> { key: Chinese }   (audit context)
 *   data/ko.json   namespace -> { key: Korean }    (shipped pack)
 *
 * Usage: node tools/assemble.mjs [chunksDir] [koDir]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const defaultWork = path.resolve(pkgRoot, '..', '_work')

const chunksDir = process.argv[2] ?? path.join(defaultWork, 'chunks')
const koDir = process.argv[3] ?? path.join(defaultWork, 'ko')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

/** @type {Map<string, {en: Record<string,string>, zh: Record<string,string>}>} */
const source = new Map()
for (const name of fs.readdirSync(chunksDir).filter((n) => /^chunk-\d+\.json$/.test(n)).sort()) {
  for (const group of readJson(path.join(chunksDir, name))) {
    const slot = source.get(group.ns) ?? { en: {}, zh: {} }
    Object.assign(slot.en, group.en)
    Object.assign(slot.zh, group.zh)
    source.set(group.ns, slot)
  }
}

const korean = new Map()
for (const name of fs.readdirSync(koDir).filter((n) => /^\d+\.json$/.test(n)).sort()) {
  const chunk = readJson(path.join(koDir, name))
  for (const group of chunk.groups ?? []) {
    const slot = korean.get(group.ns) ?? {}
    Object.assign(slot, group.ko)
    korean.set(group.ns, slot)
  }
}

const en = {}
const zh = {}
const ko = {}
const missing = []
const extra = []
let translated = 0

for (const ns of [...source.keys()].sort()) {
  const { en: enDict, zh: zhDict } = source.get(ns)
  const koDict = korean.get(ns) ?? {}
  en[ns] = {}
  zh[ns] = {}
  ko[ns] = {}
  for (const key of Object.keys(enDict)) {
    en[ns][key] = enDict[key]
    if (key in zhDict) zh[ns][key] = zhDict[key]
    if (typeof koDict[key] === 'string' && koDict[key] !== '') {
      ko[ns][key] = koDict[key]
      translated++
    } else {
      missing.push(`${ns}.${key}`)
    }
  }
  for (const key of Object.keys(koDict)) if (!(key in enDict)) extra.push(`${ns}.${key}`)
}

for (const ns of korean.keys()) {
  if (!source.has(ns)) {
    for (const key of Object.keys(korean.get(ns))) extra.push(`${ns}.${key} (unknown namespace)`)
  }
}

/* Reviewed corrections, applied last so a regeneration cannot lose them. */
const overridesFile = path.join(pkgRoot, 'data', 'overrides.json')
const overrides = fs.existsSync(overridesFile)
  ? JSON.parse(fs.readFileSync(overridesFile, 'utf8'))
  : {}
let applied = 0
for (const [ns, entries] of Object.entries(overrides)) {
  if (ns.startsWith('_')) continue
  for (const [key, value] of Object.entries(entries)) {
    if (!(ns in en) || !(key in en[ns])) {
      console.warn(`override ${ns}.${key} does not exist in the English source; ignored`)
      continue
    }
    ko[ns][key] = value
    applied++
  }
}

const dataDir = path.join(pkgRoot, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const write = (name, value) => fs.writeFileSync(path.join(dataDir, name), `${JSON.stringify(value, null, 1)}\n`, 'utf8')
write('en.json', en)
write('zh.json', zh)
write('ko.json', ko)

const total = translated + missing.length
console.log(`namespaces: ${Object.keys(ko).length}`)
console.log(`keys: ${total} total, ${translated} Korean (${((translated / total) * 100).toFixed(1)}%), ${missing.length} missing`)
console.log(`reviewed overrides applied: ${applied}`)
if (missing.length) {
  console.log(`\nmissing (${missing.length}):`)
  for (const key of missing.slice(0, 30)) console.log(`  ${key}`)
  if (missing.length > 30) console.log(`  … ${missing.length - 30} more`)
}
if (extra.length) {
  console.log(`\nunexpected keys not present in the English source (${extra.length}):`)
  for (const key of extra.slice(0, 20)) console.log(`  ${key}`)
}
console.log(`\nwrote ${path.join(dataDir, 'en.json')}`)
console.log(`wrote ${path.join(dataDir, 'zh.json')}`)
console.log(`wrote ${path.join(dataDir, 'ko.json')}`)
