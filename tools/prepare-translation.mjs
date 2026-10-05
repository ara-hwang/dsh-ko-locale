/**
 * Turn extracted dictionaries into balanced translation chunks.
 *
 * Each chunk is a `[{ ns, en, zh }]` array sized to a target key count so every
 * translation agent produces a similar amount of output. Groups are packed
 * biggest-first into the currently smallest chunk (greedy bin packing) rather
 * than sliced in order, because namespace sizes here range from 1 to 367 keys.
 *
 * Usage: node tools/prepare-translation.mjs [extractedJson] [outDir] [keysPerChunk]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

const extractedFile = process.argv[2] ?? path.resolve(pkgRoot, '..', '_work', 'extracted.json')
const outDir = process.argv[3] ?? path.resolve(pkgRoot, '..', '_work', 'chunks')
const targetKeys = Number(process.argv[4] ?? 220)

const extracted = JSON.parse(fs.readFileSync(extractedFile, 'utf8'))

const groups = []
for (const [ns, entry] of Object.entries(extracted)) {
  const en = {}
  for (const [key, value] of Object.entries(entry.en ?? {})) {
    if (typeof value === 'string' && value.trim() !== '') en[key] = value
  }
  const keys = Object.keys(en).length
  if (keys === 0) continue
  groups.push({ ns, en, zh: entry.zh ?? {}, keys, packages: entry.packages ?? [] })
}

groups.sort((a, b) => b.keys - a.keys)

const bins = []
for (const group of groups) {
  let bin = bins.find((candidate) => candidate.keys + group.keys <= targetKeys)
  if (bin === undefined) {
    bin = { keys: 0, groups: [] }
    bins.push(bin)
  }
  bin.groups.push(group)
  bin.keys += group.keys
}

fs.mkdirSync(outDir, { recursive: true })
const manifest = []
bins.forEach((bin, index) => {
  const id = String(index).padStart(2, '0')
  const file = path.join(outDir, `chunk-${id}.json`)
  const payload = bin.groups.map((group) => ({ ns: group.ns, en: group.en, zh: group.zh }))
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 1)}\n`, 'utf8')
  manifest.push({
    id,
    file,
    groups: bin.groups.length,
    keys: bin.keys,
    namespaces: bin.groups.map((group) => group.ns),
  })
})
fs.writeFileSync(path.join(outDir, '_manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`, 'utf8')

console.log(`namespaces: ${groups.length}, keys: ${groups.reduce((sum, g) => sum + g.keys, 0)}`)
console.log(`chunks: ${bins.length} (target ${targetKeys} keys each)`)
console.log(manifest.map((entry) => `${entry.id}: ${entry.groups}g/${entry.keys}k`).join('  '))
console.log(`wrote ${outDir}`)
