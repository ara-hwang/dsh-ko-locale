/**
 * High-fidelity smoke test for the browser half.
 *
 * Loads the *real* `LocaleRuntime` shipped by @deepseek-ai/dsh-client-locale out
 * of the installed DSH application (that bundle is a
 * `window.__ModuleLoader__.load({...})` script, so it is executed here under a
 * tiny loader harness rather than imported), installs this pack against it, and
 * asserts the observable translation behavior.
 *
 * This exercises the actual runtime the desktop app uses — the prototype walk,
 * the addLanguage/publishCatalog interaction, fallback to English, and disposal
 * — instead of a hand-written stand-in.
 *
 * It needs the DSH application installed, so it cannot run in CI. The shipped
 * dictionaries and the bundle they are inlined into are checked portably by
 * `tools/check-data.mjs`, which `npm test` runs first.
 *
 * Usage: node tools/smoke-test.mjs [path/to/dsh-client-locale/lib/client.js]
 *   Without a path, the bundle is read straight out of the installed
 *   application's app.asar (see tools/asar.mjs for the install location).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ASAR, readAsarFile } from './asar.mjs'
import { evaluateBundle, loadPack } from './check-data.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

/** Asar-relative path of the reference locale bundle inside the DSH app. */
const REFERENCE_ENTRY =
  'dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js'

/**
 * Materialize the reference bundle: an explicit path wins, otherwise read it
 * from the installed application and cache it next to this package's build.
 * @returns the bundle's source text.
 */
function loadReferenceSource() {
  const explicit = process.argv[2]
  if (explicit !== undefined) {
    if (!fs.existsSync(explicit)) {
      console.error(`reference locale bundle not found: ${explicit}`)
      process.exit(2)
    }
    return fs.readFileSync(explicit, 'utf8')
  }
  if (!fs.existsSync(DEFAULT_ASAR)) {
    console.error(`DSH application not found at ${DEFAULT_ASAR}`)
    console.error('Pass the path to @deepseek-ai/dsh-client-locale/lib/client.js explicitly.')
    process.exit(2)
  }
  return readAsarFile(DEFAULT_ASAR, REFERENCE_ENTRY).toString('utf8')
}

const referenceSource = loadReferenceSource()

let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks++
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

/** Load this pack's built browser bundle. */
function loadKoreanPack() {
  return loadPack(pkgRoot)
}

/** Load the real locale bundle; its React imports are never rendered here. */
function loadLocaleBundle() {
  return evaluateBundle(referenceSource, 'dsh-client-locale', () => ({}))
}

/** A cordis-like context with just the surface the runtime touches. */
function createContext() {
  const listeners = new Map()
  return {
    effects: [],
    effect(callback, label) {
      const disposer = callback()
      this.effects.push({ label, disposer })
      return () => {}
    },
    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) fn(payload)
    },
    on(event, fn) {
      const list = listeners.get(event) ?? []
      list.push(fn)
      listeners.set(event, list)
    },
  }
}

/** Simulate the host machine's requested languages. */
function setMachineLanguage(tags) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { languages: tags, language: tags[0] },
    configurable: true,
    writable: true,
  })
}

function installPack(localeRuntime) {
  const bundle = loadKoreanPack()
  const ctx = createContext()
  ctx.locale = localeRuntime
  bundle.exports.apply(ctx)
  return bundle
}

/** Register the same base dictionaries the shipped locale plugin registers. */
function registerBaseDictionaries(runtime) {
  runtime.register('common', {
    zh: { ok: '确定', cancel: '取消', close: '关闭', copy: '复制', 'codeBlock.title': '代码块' },
    en: { ok: 'OK', cancel: 'Cancel', close: 'Close', copy: 'Copy', 'codeBlock.title': 'Code block' },
  })
  runtime.register('chat', {
    zh: { 'message.copy': '复制消息' },
    en: { 'message.copy': 'Copy message' },
  })
}

console.log(`reference runtime: ${process.argv[2] ?? `${DEFAULT_ASAR}!${REFERENCE_ENTRY}`}\n`)

const { LocaleRuntime } = loadLocaleBundle().exports
check('reference bundle exports LocaleRuntime', typeof LocaleRuntime, 'function')

/* ── Scenario A: a machine that asks for Korean, no stored preference ─────── */
console.log('\nScenario A — Korean machine, no stored preference')
setMachineLanguage(['ko-KR', 'ko', 'en-US'])
{
  const runtime = new LocaleRuntime(createContext(), undefined, undefined)
  registerBaseDictionaries(runtime)
  check('opens in English before the pack mounts', runtime.getSnapshot().active, 'en')
  check('English copy before the pack mounts', runtime.bind('common')('cancel'), 'Cancel')

  const bundle = installPack(runtime)
  const pack = bundle.exports
  runtime.register('probe', 'en', { hello: 'Hello' })
  check('bundle registers itself under the package id', bundle.id, 'dsh-ko-locale')
  check('Korean is registered in the catalog', runtime.getSnapshot().locales.some((l) => l.id === 'ko'), true)
  check('Korean becomes the active locale', runtime.getSnapshot().active, 'ko')
  check('Korean copy for a pack key', runtime.bind('common')('cancel'), '취소')
  check('Korean copy for a second namespace', runtime.bind('chat')('message.copy').length > 0, true)
  check(
    'a namespace the pack does not carry falls through to English',
    runtime.bind('probe')('hello'),
    'Hello',
  )
  check(
    'a key the pack does carry is served in Korean, not English',
    pack.DICTIONARIES.common['codeBlock.title'] !== undefined && runtime.bind('common')('codeBlock.title') !== 'Code block',
    true,
  )
  check('English is still selectable', runtime.getSnapshot().locales.map((l) => l.id).sort().join(','), 'en,ko,zh')
  runtime.setLocale('en')
  check('switching back to English restores English copy', runtime.bind('common')('cancel'), 'Cancel')
  runtime.setLocale('ko')
  check('switching to Korean again restores Korean copy', runtime.bind('common')('cancel'), '취소')
}

/* ── Scenario B: a machine that does not ask for Korean ─────────────────── */
console.log('\nScenario B — non-Korean machine, explicit selection')
setMachineLanguage(['en-US', 'en'])
{
  const runtime = new LocaleRuntime(createContext(), undefined, undefined)
  registerBaseDictionaries(runtime)
  installPack(runtime)
  check('stays in English by default', runtime.getSnapshot().active, 'en')
  check('English copy while English is active', runtime.bind('common')('cancel'), 'Cancel')
  runtime.setLocale('ko')
  check('Korean copy after an explicit choice', runtime.bind('common')('cancel'), '취소')
  check('document language id is the external tag', runtime.getSnapshot().active, 'ko')
}

/* ── Scenario C: disposal restores the runtime ──────────────────────────── */
console.log('\nScenario C — disposal')
setMachineLanguage(['en-US', 'en'])
{
  const ctx = createContext()
  const runtime = new LocaleRuntime(ctx, undefined, undefined)
  registerBaseDictionaries(runtime)
  const bundle = loadKoreanPack()
  ctx.locale = runtime
  bundle.exports.apply(ctx)
  runtime.setLocale('ko')
  check('Korean active before disposal', runtime.bind('common')('cancel'), '취소')

  const effect = ctx.effects.find((e) => e.label === 'dsh-ko-locale: Korean language pack')
  check('pack registered one owned effect', effect !== undefined, true)
  effect.disposer()

  check('catalog no longer offers Korean', runtime.getSnapshot().locales.some((l) => l.id === 'ko'), false)
  runtime.setLocale('en')
  check('English copy after disposal', runtime.bind('common')('cancel'), 'Cancel')
  check('plain English registration still works after disposal', (() => {
    runtime.register('probe', 'en', { hello: 'Hello' })
    return runtime.bind('probe')('hello')
  })(), 'Hello')
}

/* ── Data integrity is owned by tools/check-data.mjs ────────────────────── */
console.log('\nShipped pack data: checked by tools/check-data.mjs (portable, runs in CI)')

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} — ${checks - failures}/${checks} checks`)
process.exit(failures === 0 ? 0 : 1)
