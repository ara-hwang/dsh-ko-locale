/**
 * Verify translated chunks against the English source they were made from.
 *
 * Reports, per chunk: missing keys, blank values, keys that do not exist in the
 * source, and "untranslated suspects" — values identical to English that look
 * like prose. Suspects are advisory: product names, key names and format labels
 * are legitimately identical, so they need a human look rather than a failure.
 *
 * Usage: node tools/verify-translations.mjs [chunksDir] [koDir]
 * @returns exit code 1 when any key is missing or blank.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

const chunksDir = process.argv[2] ?? path.resolve(pkgRoot, '..', '_work', 'chunks')
const koDir = process.argv[3] ?? path.resolve(pkgRoot, '..', '_work', 'ko')

const manifest = JSON.parse(fs.readFileSync(path.join(chunksDir, '_manifest.json'), 'utf8'))

/**
 * Merge every translation file by namespace, the same way assemble.mjs does.
 * Matching chunk ids to translation ids would break the moment a translation is
 * produced out of band — a later top-up pass writes its own file covering
 * namespaces that belong to several different source chunks.
 */
const byNamespace = new Map()
for (const name of fs.readdirSync(koDir).filter((n) => /^\d+\.json$/.test(n)).sort()) {
  const file = path.join(koDir, name)
  let translated
  try {
    translated = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`${name}: invalid JSON (${error.message})`)
    process.exitCode = 1
    continue
  }
  for (const group of translated.groups ?? []) {
    const slot = byNamespace.get(group.ns) ?? { keys: {}, sources: [] }
    Object.assign(slot.keys, group.ko ?? {})
    slot.sources.push(name)
    byNamespace.set(group.ns, slot)
  }
}

let missing = 0
let blank = 0
let extra = 0
let ok = 0
let suspects = 0
const problems = []

for (const chunk of manifest) {
  const source = JSON.parse(fs.readFileSync(chunk.file, 'utf8'))

  let chunkMissing = 0
  let chunkSuspects = 0
  for (const group of source) {
    const korean = byNamespace.get(group.ns)?.keys
    if (korean === undefined) {
      problems.push(`chunk ${chunk.id}: namespace "${group.ns}" has no translation anywhere`)
      missing += Object.keys(group.en).length
      continue
    }
    for (const [key, english] of Object.entries(group.en)) {
      const value = korean[key]
      if (!(key in korean)) {
        missing++
        chunkMissing++
        if (problems.length < 40) problems.push(`chunk ${chunk.id} ${group.ns}: missing "${key}"`)
      } else if (typeof value !== 'string' || value.trim() === '') {
        blank++
        problems.push(`chunk ${chunk.id} ${group.ns}: blank "${key}"`)
      } else {
        ok++
        if (value === english && /[A-Za-z]{3}/.test(english) && !/[{}\\/]/.test(english)) {
          suspects++
          chunkSuspects++
        }
      }
    }
  }
  console.log(
    `chunk ${chunk.id}: ${source.length} namespaces, missing=${chunkMissing}, untranslated-suspects=${chunkSuspects}`,
  )
}

/* Keys that no source chunk asks for: a typo or a stale translation. */
const wanted = new Set()
for (const chunk of manifest) {
  for (const group of JSON.parse(fs.readFileSync(chunk.file, 'utf8'))) {
    for (const key of Object.keys(group.en)) wanted.add(`${group.ns}\u0000${key}`)
  }
}
for (const [ns, slot] of byNamespace) {
  for (const key of Object.keys(slot.keys)) {
    if (!wanted.has(`${ns}\u0000${key}`)) {
      extra++
      if (problems.length < 40) problems.push(`${ns}.${key}: translated but absent from the source`)
    }
  }
}

console.log(`\nkeys ok=${ok} missing=${missing} blank=${blank} unexpected=${extra}`)
console.log(`untranslated suspects=${suspects} (advisory: product names and format labels stay English)`)
if (problems.length > 0) {
  console.log('\nproblems:')
  for (const problem of problems.slice(0, 40)) console.log(`  ${problem}`)
}
process.exit(missing === 0 && blank === 0 ? 0 : 1)
