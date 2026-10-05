/**
 * Extract every shipped `zh`/`en` locale dictionary from the DSH client bundles
 * inside the installed application's `app.asar`.
 *
 * The client bundles are generated `window.__ModuleLoader__.load({...})` scripts
 * whose dictionary literals appear as `const zh = {...}` / `const en$1 = {...}`
 * pairs, named by a `$n` suffix that pairs a Chinese literal with its English
 * counterpart. This script locates those literals, reads their namespace from
 * the `ctx.locale.register(<ns>, {...})` call that consumes them, and merges the
 * result across all packages.
 *
 * Usage: node tools/extract-dictionaries.mjs [outJson] [app.asar]
 *   default outJson: ../_work/extracted.json
 *   default app.asar: tools/asar.mjs DEFAULT_ASAR
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ASAR, readAsar, readAsarFile } from './asar.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const outFile = process.argv[2] ?? path.resolve(pkgRoot, '..', '_work', 'extracted.json')
const archive = process.argv[3] ?? DEFAULT_ASAR

const IDENTIFIER = '[A-Za-z_$][\\w$]*'
const BUNDLE = /^dsh\/node_modules\/@deepseek-ai\/[^/]+\/lib\/client\.js$/

/** Return the source of the balanced `{...}` beginning at `start`. */
function balanced(text, start) {
  let depth = 0
  let index = start
  let inString = null
  let inTemplate = false
  let inLineComment = false
  let inBlockComment = false
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (inLineComment) {
      if (char === '\n') inLineComment = false
      index++
      continue
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        index += 2
        continue
      }
      index++
      continue
    }
    if (inString !== null) {
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === inString) inString = null
      index++
      continue
    }
    if (inTemplate) {
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === '`') inTemplate = false
      index++
      continue
    }
    if (char === '/' && next === '/') {
      inLineComment = true
      index += 2
      continue
    }
    if (char === '/' && next === '*') {
      inBlockComment = true
      index += 2
      continue
    }
    if (char === '"' || char === "'") {
      inString = char
      index++
      continue
    }
    if (char === '`') {
      inTemplate = true
      index++
      continue
    }
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, index + 1)
    }
    index++
  }
  return null
}

/** Decode the JavaScript string escapes a generated bundle can contain. */
function unescape(text) {
  return text.replace(
    /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (all, escape) => {
      if (escape[0] === 'u') {
        const hex = escape[1] === '{' ? escape.slice(2, -1) : escape.slice(1)
        return String.fromCodePoint(Number.parseInt(hex, 16))
      }
      if (escape[0] === 'x') return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
      if (escape === 'n') return '\n'
      if (escape === 't') return '\t'
      if (escape === 'r') return '\r'
      return escape
    },
  )
}

/** Parse a flat `{ "key": "value", ... }` literal, preserving key order. */
function parseFlatObject(source) {
  const values = {}
  const order = []
  const pattern = new RegExp(
    `(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)'|(${IDENTIFIER}))\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`,
    'g',
  )
  let match
  while ((match = pattern.exec(source)) !== null) {
    const rawKey = match[1] ?? match[2] ?? match[3]
    const rawValue = match[4] ?? match[5]
    if (rawValue === undefined) continue
    const key = unescape(rawKey)
    if (!(key in values)) order.push(key)
    values[key] = unescape(rawValue)
  }
  return { values, order }
}

/** Resolve the namespace a dictionary identifier is registered under. */
function namespaceFor(text, identifier) {
  const pattern = new RegExp(`\\.register\\(\\s*(${IDENTIFIER}|"[^"]+")\\s*,\\s*\\{`, 'g')
  let match
  let found
  while ((match = pattern.exec(text)) !== null) {
    const literal = balanced(text, match.index + match[0].length - 1)
    if (literal === null) continue
    if (!new RegExp(`[,\\s{]${identifier.replace(/\$/g, '\\$')}\\s*[,}]`).test(literal)) continue
    let namespace = match[1]
    if (namespace.startsWith('"')) {
      namespace = namespace.slice(1, -1)
    } else {
      const declared = new RegExp(
        `(?:const|var|let)\\s+${namespace.replace(/\$/g, '\\$')}\\s*=\\s*"([^"]+)"`,
      ).exec(text)
      namespace = declared === null ? namespace : declared[1]
    }
    found = namespace
  }
  return found
}

const { entries } = readAsar(archive)
const bundles = entries.filter((entry) => BUNDLE.test(entry.path))
if (bundles.length === 0) throw new Error(`no client bundles found in ${archive}`)

/** @type {Map<string, { en: Record<string,string>, zh: Record<string,string>, packages: Set<string> }>} */
const namespaces = new Map()

for (const bundle of bundles) {
  const text = readAsarFile(archive, bundle.path).toString('utf8')
  const packageName = bundle.path.split('/@deepseek-ai/')[1].split('/')[0]

  const dictionaries = new Map()
  const pattern = new RegExp(`(?:const|var|let)\\s+(zh|en)(\\$\\d+)?\\s*=\\s*\\{`, 'g')
  let match
  while ((match = pattern.exec(text)) !== null) {
    const literal = balanced(text, match.index + match[0].length - 1)
    if (literal === null) continue
    const parsed = parseFlatObject(literal)
    if (parsed.order.length === 0) continue
    const suffix = match[2] ?? ''
    const slot = dictionaries.get(suffix) ?? {}
    slot[match[1]] = parsed.values
    dictionaries.set(suffix, slot)
  }

  for (const [suffix, slot] of dictionaries) {
    const namespace =
      namespaceFor(text, `zh${suffix}`) ?? namespaceFor(text, `en${suffix}`) ?? `unknown${suffix}`
    const target = namespaces.get(namespace) ?? { en: {}, zh: {}, packages: new Set() }
    Object.assign(target.en, slot.en ?? {})
    Object.assign(target.zh, slot.zh ?? {})
    target.packages.add(packageName)
    namespaces.set(namespace, target)
  }
}

const output = {}
for (const namespace of [...namespaces.keys()].sort()) {
  const entry = namespaces.get(namespace)
  output[namespace] = { en: entry.en, zh: entry.zh, packages: [...entry.packages].sort() }
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, `${JSON.stringify(output, null, 1)}\n`, 'utf8')

const keys = Object.values(output).reduce((sum, entry) => sum + Object.keys(entry.en).length, 0)
console.log(`bundles scanned: ${bundles.length}`)
console.log(`namespaces: ${Object.keys(output).length}`)
console.log(`English keys: ${keys}`)
console.log(`wrote ${outFile}`)
