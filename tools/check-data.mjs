/**
 * Portable integrity check for the shipped pack.
 *
 * Everything here runs anywhere Node does: it loads the built browser bundle
 * under the same module-loader harness the app uses, and validates the
 * dictionaries that are actually inlined in it. Nothing touches the installed
 * DSH application, so this is the gate that can run in CI — see
 * `tools/smoke-test.mjs` for the runtime behaviour that only a machine with the
 * app installed can prove.
 *
 * Checks, in order of what they protect:
 *   1. The bundle loads and registers itself under this package's id.
 *   2. The inlined dictionaries equal `data/ko.json` — this repository commits
 *      its build output, so a bundle that lags its data is the failure mode the
 *      suite would otherwise never see.
 *   3. No namespace is empty and no value is blank.
 *   4. Every key in `data/en.json` is present, and every `{token}` placeholder
 *      survives into the Korean text.
 *   5. Every scope exemption in `data/scope.json` still names a shipped entry —
 *      an exemption that outlives its target would hide a future gap.
 *
 * Usage: node tools/check-data.mjs
 * @returns exit code 1 when any check fails.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

/** This package's own name, which its bundle must register itself under. */
const PACKAGE_ID = 'dsh-ko-locale'

/**
 * Read the scope exemptions that let the pack skip an entry by decision.
 * @param root - package root.
 * @returns `{ namespaces, keys, pairs }`: `keys` holds `ns.key`, `pairs` the split form.
 */
function readScope(root) {
  const file = path.join(root, 'data', 'scope.json')
  const namespaces = new Set()
  const keys = new Set()
  const pairs = []
  if (!fs.existsSync(file)) return { namespaces, keys, pairs }
  const scope = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const ns of Object.keys(scope.excludedNamespaces ?? {})) namespaces.add(ns)
  for (const [ns, entries] of Object.entries(scope.excludedKeys ?? {})) {
    for (const key of entries) {
      keys.add(`${ns}.${key}`)
      pairs.push([ns, key])
    }
  }
  return { namespaces, keys, pairs }
}

/**
 * Execute a module-loader bundle as a classic script, exactly like the app's
 * combo loader does, and return the factory's exports.
 * @param source - the bundle's text.
 * @param label - name used in error messages.
 * @param makeRequire - builds the `require` the factory receives.
 * @returns `{ id, exports }`.
 */
export function evaluateBundle(source, label, makeRequire) {
  const previous = globalThis.window
  let captured
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        captured = entry
      },
    },
  }
  try {
    new Function(source)()
  } finally {
    globalThis.window = previous
  }
  if (captured === undefined) throw new Error(`${label} did not register a module`)
  return { id: captured.id, exports: captured.factory(makeRequire) }
}

/**
 * Load this pack's built browser bundle.
 * @param root - package root; defaults to this file's package.
 * @returns `{ id, exports }`.
 */
export function loadPack(root = pkgRoot) {
  const file = path.join(root, 'lib', 'client.js')
  if (!fs.existsSync(file)) throw new Error(`build the pack first: ${file} is missing`)
  return evaluateBundle(fs.readFileSync(file, 'utf8'), file, (id) => {
    throw new Error(`the pack must not import anything, but requested "${id}"`)
  })
}

/** Every `{token}` in a string, sorted, so two texts can be compared. */
function placeholders(text) {
  return (text.match(/\{(\w+)\}/g) ?? []).slice().sort().join(',')
}

/**
 * Collect every way the shipped pack is wrong.
 * @param root - package root to check.
 * @returns `{ failures, summary }`; `failures` is empty when the pack is sound.
 */
export function checkData(root = pkgRoot) {
  const failures = []
  const fail = (message) => failures.push(message)

  const bundle = loadPack(root)
  if (bundle.id !== PACKAGE_ID) fail(`bundle registers id "${bundle.id}", expected "${PACKAGE_ID}"`)
  if (bundle.exports.KOREAN_LOCALE_ID !== 'ko') {
    fail(`KOREAN_LOCALE_ID is ${JSON.stringify(bundle.exports.KOREAN_LOCALE_ID)}, expected "ko"`)
  }

  const dictionaries = bundle.exports.DICTIONARIES
  if (dictionaries === undefined || typeof dictionaries !== 'object') {
    return { failures: [...failures, 'bundle exports no DICTIONARIES'], summary: undefined }
  }
  const namespaces = Object.keys(dictionaries)
  let keys = 0

  /* 2. The committed bundle must carry exactly what the data says. */
  const source = JSON.parse(fs.readFileSync(path.join(root, 'data', 'ko.json'), 'utf8'))
  for (const ns of new Set([...namespaces, ...Object.keys(source)])) {
    const inBundle = dictionaries[ns] ?? {}
    const inData = source[ns] ?? {}
    if (!(ns in dictionaries)) fail(`namespace "${ns}" is in data/ko.json but not in the built bundle`)
    else if (!(ns in source)) fail(`namespace "${ns}" is in the built bundle but not in data/ko.json`)
    else {
      for (const key of new Set([...Object.keys(inBundle), ...Object.keys(inData)])) {
        if (inBundle[key] !== inData[key]) {
          fail(`"${ns}.${key}" differs between the built bundle and data/ko.json`)
        }
      }
    }
  }

  /* 3. Shape. A value's blankness is judged in step 4, where the English source
   * is at hand: a whitespace-only separator is a real string, not a gap. */
  for (const ns of namespaces) {
    const entries = Object.entries(dictionaries[ns])
    keys += entries.length
    if (entries.length === 0) fail(`namespace "${ns}" is empty`)
    for (const [key, value] of entries) {
      if (typeof value !== 'string') fail(`"${ns}.${key}" is not a string`)
    }
  }
  if (namespaces.length === 0) fail('the pack carries no namespaces')

  /* 4. Coverage and placeholder parity against the English source, minus scope. */
  const en = JSON.parse(fs.readFileSync(path.join(root, 'data', 'en.json'), 'utf8'))
  const scope = readScope(root)
  let expected = 0
  let excluded = 0
  for (const [ns, entries] of Object.entries(en)) {
    if (scope.namespaces.has(ns)) {
      excluded += Object.keys(entries).length
      if (ns in dictionaries) {
        fail(`"${ns}" is excluded by data/scope.json but the pack still carries Korean for it`)
      }
      continue
    }
    for (const [key, english] of Object.entries(entries)) {
      if (scope.keys.has(`${ns}.${key}`)) {
        excluded++
        continue
      }
      expected++
      const korean = dictionaries[ns]?.[key]
      if (typeof korean !== 'string') {
        fail(`"${ns}.${key}" has no Korean`)
        continue
      }
      if (korean.trim() === '' && english.trim() !== '') {
        fail(`"${ns}.${key}" is blank`)
        continue
      }
      if (placeholders(english) !== placeholders(korean)) {
        fail(`"${ns}.${key}" lost or gained a placeholder (${placeholders(english)} vs ${placeholders(korean)})`)
      }
    }
  }

  /* 5. An exemption that no longer names a shipped entry would hide a future gap. */
  for (const ns of scope.namespaces) {
    if (!(ns in en)) fail(`data/scope.json excludes "${ns}", which data/en.json no longer ships`)
  }
  for (const [ns, key] of scope.pairs) {
    if (en[ns]?.[key] === undefined) {
      fail(`data/scope.json excludes "${ns}.${key}", which data/en.json no longer ships`)
    }
  }

  /* 6. The committed baseline must be the build data/source.json pins. */
  const sourceFile = path.join(root, 'data', 'source.json')
  if (fs.existsSync(sourceFile)) {
    const pin = JSON.parse(fs.readFileSync(sourceFile, 'utf8')).target ?? {}
    const totalKeys = expected + excluded
    if (pin.englishKeys !== undefined && pin.englishKeys !== totalKeys) {
      fail(`data/en.json carries ${totalKeys} English keys but data/source.json pins ${pin.englishKeys}`)
    }
    if (pin.namespaces !== undefined && pin.namespaces !== Object.keys(en).length) {
      fail(
        `data/en.json carries ${Object.keys(en).length} namespaces but data/source.json pins ${pin.namespaces}`,
      )
    }
  }

  return {
    failures,
    summary: { namespaces: namespaces.length, keys, expected, excluded },
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { failures, summary } = checkData()
  if (summary !== undefined) {
    console.log(
      `pack: ${summary.namespaces} namespaces, ${summary.keys} Korean strings, ${summary.expected} English keys` +
        (summary.excluded > 0 ? `, ${summary.excluded} excluded by data/scope.json` : ''),
    )
  }
  for (const failure of failures.slice(0, 40)) console.log(`FAIL  ${failure}`)
  if (failures.length > 40) console.log(`      … ${failures.length - 40} more`)
  console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILED`}`)
  process.exit(failures.length === 0 ? 0 : 1)
}
