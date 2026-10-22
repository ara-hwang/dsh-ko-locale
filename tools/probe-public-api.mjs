/**
 * Reproduce the capability probe behind docs/mechanism-review.md.
 *
 * The pack installs its dictionaries by patching `LocaleRuntime.prototype.lookup`,
 * because its own notes said a language pack cannot take a namespace over through
 * the public API. That claim is worth re-measuring on every DSH upgrade: if the
 * public API now covers the job, the patch is 200 lines of private surface the pack
 * does not need — and if it does not, the patch stays justified.
 *
 * This tool asserts the behaviour measured on DSH 0.2.1-rc.2 against the installed
 * runtime. It deliberately lives outside `npm test`: a failure here means the host
 * runtime moved and the review needs re-reading, not that the shipped pack broke.
 *
 * Usage: node tools/probe-public-api.mjs [clientBundle]
 *   default clientBundle: @deepseek-ai/dsh-client-locale/lib/client.js from the app
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ASAR, readAsarFile } from './asar.mjs'
import { evaluateBundle } from './check-data.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const REFERENCE_ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js'

const explicit = process.argv[2]
const source =
  explicit !== undefined
    ? fs.readFileSync(explicit, 'utf8')
    : readAsarFile(DEFAULT_ASAR, REFERENCE_ENTRY).toString('utf8')
const { LocaleRuntime } = evaluateBundle(source, 'dsh-client-locale', () => ({})).exports

/** A cordis-like context with just the surface the runtime touches. */
function createContext() {
  const listeners = new Map()
  return {
    effect(callback) {
      callback()
      return () => {}
    },
    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) fn(payload)
    },
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn])
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

/** The shipped dictionaries a namespace owner registers before any language pack. */
function registerBaseDictionaries(runtime) {
  runtime.register('common', {
    zh: { ok: '确定', cancel: '取消', close: '关闭' },
    en: { ok: 'OK', cancel: 'Cancel', close: 'Close' },
  })
}

let checks = 0
let failures = 0
function check(label, actual, expected) {
  checks++
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

console.log(`probe: ${explicit ?? `${DEFAULT_ASAR}!${REFERENCE_ENTRY}`}\n`)

/* A stored preference flips the active locale; dictionaries then read through lookup. */
setMachineLanguage(['en-US', 'en'])
globalThis.window = {}
{
  const runtime = new LocaleRuntime(createContext(), undefined, undefined)
  registerBaseDictionaries(runtime)
  runtime.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' })
  runtime.register('common', 'ko', { cancel: '취소' })
  runtime.setLocale('ko')
  check('public register() accepts a third locale on a shipped namespace', runtime.bind('common')('cancel'), '취소')
  check('a key the added dictionary lacks falls back to English', runtime.bind('common')('close'), 'Close')
}

/* A Korean machine with no stored preference picks Korean once the language exists. */
setMachineLanguage(['ko-KR', 'ko', 'en-US'])
globalThis.window = {}
{
  const runtime = new LocaleRuntime(createContext(), undefined, undefined)
  registerBaseDictionaries(runtime)
  check('English before the language exists', runtime.getSnapshot().active, 'en')
  runtime.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' })
  check('addLanguage alone selects Korean on a Korean machine', runtime.getSnapshot().active, 'ko')
  runtime.register('common', 'ko', { cancel: '취소' })
  check('Korean copy without any prototype patch', runtime.bind('common')('cancel'), '취소')
}

/* The remaining gap: a second registration for the same pair is rejected. */
{
  const runtime = new LocaleRuntime(createContext(), undefined, undefined)
  registerBaseDictionaries(runtime)
  runtime.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' })
  runtime.register('common', 'ko', { cancel: '취소' })
  let message = null
  try {
    runtime.register('common', 'ko', { close: '닫기' })
  } catch (error) {
    message = String(error?.message ?? error)
  }
  check('a second dictionary for the same pair throws', message !== null, true)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} — ${checks - failures}/${checks} checks`)
console.log('Re-read docs/mechanism-review.md before acting on a failure.')
process.exit(failures === 0 ? 0 : 1)
