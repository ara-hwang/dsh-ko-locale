/**
 * Lint the shipped dictionary against the approved Korean glossary.
 *
 * The pack spans ~60 namespaces written in several passes; without a check the
 * same concept drifts into several words ("세션" here, "대화" there) and the GUI
 * reads like two products bolted together. `data/glossary.ko.json` is the single
 * approved rendering per term; this tool reports every shipped value whose English
 * matches a term but whose Korean does not use that rendering.
 *
 * Two things are deliberately not violations: a placeholder (`{message}`) is not
 * prose, and a term embedded in an identifier or path (`pnpm-workspace.yaml`) is
 * not the concept. Contextual rewording that a term genuinely cannot hold goes in
 * the glossary's `exceptions`, with its reason written next to it.
 *
 * Usage: node tools/check-glossary.mjs [--warn] [--ns <namespace>]
 *   --warn: report and exit 0 (for a first look at a new term)
 *   --ns:   limit the lint to one namespace
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

const args = process.argv.slice(2)
const warnOnly = args.includes('--warn')
const onlyNamespace = args.includes('--ns') ? args[args.indexOf('--ns') + 1] : undefined

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const glossary = readJson(path.join(pkgRoot, 'data', 'glossary.ko.json'))
const english = readJson(path.join(pkgRoot, 'data', 'en.json'))
const korean = readJson(path.join(pkgRoot, 'data', 'ko.json'))

const exceptions = new Map(Object.entries(glossary.exceptions ?? {}))

/** Whether `namespace.key` is excused from the glossary, and why. */
function exceptionFor(ns, key) {
  return exceptions.get(`${ns}.${key}`) ?? exceptions.get(`${ns}.*`)
}

const terms = (glossary.terms ?? []).map((term) => ({
  ...term,
  pattern: new RegExp(term.match, 'g'),
  acceptable: [term.ko, ...(term.accept ?? [])],
}))

/** A term embedded in `-`, `_`, `.`, `/` is part of a name, not the concept. */
function insideIdentifier(text, index, length) {
  const before = text[index - 1]
  const after = text[index + length]
  return /[-\w./]/.test(before ?? '') || /[-\w./]/.test(after ?? '')
}

/** Whether the Korean value fails this term for at least one real occurrence. */
function violates(source, target, term) {
  const prose = source.replace(/\{\w+\}/g, ' ')
  term.pattern.lastIndex = 0
  let match
  while ((match = term.pattern.exec(prose)) !== null) {
    if (insideIdentifier(prose, match.index, prose.length === 0 ? 0 : match[0].length)) continue
    return !term.acceptable.some((rendering) => target.includes(rendering))
  }
  return false
}

const failures = []
let examined = 0

for (const ns of Object.keys(english)) {
  if (onlyNamespace !== undefined && ns !== onlyNamespace) continue
  for (const [key, source] of Object.entries(english[ns])) {
    const target = korean[ns]?.[key]
    if (typeof target !== 'string' || target === '') continue
    examined++
    if (exceptionFor(ns, key) !== undefined) continue
    for (const term of terms) {
      if (!violates(source, target, term)) continue
      failures.push({ ns, key, source, target, term: term.en, expected: term.ko, note: term.note })
      break
    }
  }
}

for (const failure of failures) {
  console.log(`FAIL  ${failure.ns}.${failure.key}`)
  console.log(`      en: ${failure.source}`)
  console.log(`      ko: ${failure.target}`)
  console.log(`      term "${failure.term}" must read "${failure.expected}"${failure.note === undefined ? '' : ` — ${failure.note}`}`)
}
console.log(
  `\nglossary: ${terms.length} terms, ${examined} strings examined, ${failures.length} violation(s)` +
    (exceptions.size > 0 ? `, ${exceptions.size} explicit exception(s)` : ''),
)
process.exit(failures.length === 0 || warnOnly ? 0 : 1)
