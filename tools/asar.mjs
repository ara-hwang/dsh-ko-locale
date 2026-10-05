/**
 * Minimal ASAR reader — enough to list entries and extract files out of a
 * packaged Electron application, which is how the DSH client bundles are
 * inspected when regenerating this language pack.
 *
 * The format is: `u32(4) | u32(headerPickleSize) || u32(jsonLen) | json`, then
 * the concatenated file bodies. Only the JSON header is parsed; the per-file
 * `integrity` blocks are ignored because extraction is local and unverified.
 *
 * CLI:
 *   node tools/asar.mjs list    <app.asar> [regex]
 *   node tools/asar.mjs extract <app.asar> <outDir> <regex>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Read an asar archive's file index.
 * @param archive - path to the `.asar` file.
 * @returns `{ entries, baseOffset }`; each entry carries an asar-relative path,
 *   byte size and body offset, and `baseOffset` locates body byte 0 in the file.
 */
export function readAsar(archive) {
  const fd = fs.openSync(archive, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const headerPickleSize = head.readUInt32LE(4)
    const jsonLen = head.readUInt32LE(8)
    const json = Buffer.alloc(jsonLen)
    fs.readSync(fd, json, 0, jsonLen, 16)
    const text = json.toString('utf8')
    // The pickle can carry trailing bytes; the object ends at the last brace.
    const header = JSON.parse(text.slice(0, text.lastIndexOf('}') + 1))

    const entries = []
    const walk = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const entryPath = prefix ? `${prefix}/${name}` : name
        if (entry.files) walk(entry, entryPath)
        else if (entry.unpacked !== true) {
          entries.push({ path: entryPath, size: entry.size, offset: Number(entry.offset) })
        }
      }
    }
    walk(header, '')
    return { entries, baseOffset: 8 + headerPickleSize }
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Read one entry's bytes out of an archive.
 * @param archive - path to the `.asar` file.
 * @param entryPath - asar-relative path, as reported by {@link readAsar}.
 * @returns the entry's body.
 */
export function readAsarFile(archive, entryPath) {
  const { entries, baseOffset } = readAsar(archive)
  const entry = entries.find((candidate) => candidate.path === entryPath)
  if (entry === undefined) throw new Error(`asar entry not found: ${entryPath}`)
  const fd = fs.openSync(archive, 'r')
  try {
    const body = Buffer.alloc(entry.size)
    fs.readSync(fd, body, 0, entry.size, baseOffset + entry.offset)
    return body
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Locate the installed DSH desktop application's `app.asar`.
 *
 * `DSH_ASAR` wins when set, so a non-standard install needs no code change. The
 * Windows location is the one this pack was developed and verified against; the
 * macOS path is Electron's standard bundle layout and is used when the Windows
 * one does not apply. Every caller also accepts an explicit path, so an unknown
 * layout is a configuration problem rather than a dead end.
 * @returns a candidate path, which may not exist.
 */
function defaultAsarPath() {
  const override = process.env.DSH_ASAR
  if (override !== undefined && override !== '') return override
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData !== undefined && localAppData !== '') {
    return path.join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar')
  }
  return path.join(
    os.homedir(),
    'Applications',
    'DeepSeek Harness.app',
    'Contents',
    'Resources',
    'app.asar',
  )
}

/** Default `app.asar` location; override with `DSH_ASAR` or an explicit argument. */
export const DEFAULT_ASAR = defaultAsarPath()

/**
 * Whether this module is the process entry point. `import.meta.main` would say
 * so directly, but it only exists from Node 24, and this tooling supports the
 * Node 20 line that DSH itself accepts.
 */
const isEntryPoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntryPoint) {
  const [, , command, archive, ...rest] = process.argv
  if (archive === undefined) {
    console.error('usage: node tools/asar.mjs list|extract <app.asar> [outDir] [regex]')
    process.exit(2)
  }
  const { entries, baseOffset } = readAsar(archive)

  if (command === 'list') {
    const pattern = rest[0] === undefined ? undefined : new RegExp(rest[0])
    const selected = pattern === undefined ? entries : entries.filter((e) => pattern.test(e.path))
    for (const entry of selected) console.log(`${String(entry.size).padStart(10)}  ${entry.path}`)
    console.log(`\n${selected.length}/${entries.length} entries`)
  } else if (command === 'extract') {
    const [outDir, pattern] = rest
    const selected = entries.filter((e) => new RegExp(pattern).test(e.path))
    const fd = fs.openSync(archive, 'r')
    try {
      for (const entry of selected) {
        const dest = path.join(outDir, entry.path)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        const body = Buffer.alloc(entry.size)
        fs.readSync(fd, body, 0, entry.size, baseOffset + entry.offset)
        fs.writeFileSync(dest, body)
      }
    } finally {
      fs.closeSync(fd)
    }
    console.log(`extracted ${selected.length} entries to ${outDir}`)
  } else {
    console.error(`unknown command: ${command}`)
    process.exit(2)
  }
}
