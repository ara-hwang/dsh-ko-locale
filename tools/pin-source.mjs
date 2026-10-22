/**
 * Record the DSH build this pack's dictionaries were extracted from.
 *
 * A translation pack is only meaningful against a named build: without this file
 * "coverage" has no denominator, and nobody can tell whether the pack is one
 * nightly behind or six. Everything here is measured from the installed
 * application (and, with `--feed`, from the update feed that application reads),
 * never typed by hand.
 *
 * Usage: node tools/pin-source.mjs [--feed] [app.asar]
 *   default app.asar: tools/asar.mjs DEFAULT_ASAR
 *   --feed: also record the nightly feed's version/sha512/releaseDate (needs network)
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ASAR, readAsar, readAsarFile } from './asar.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

const args = process.argv.slice(2)
const withFeed = args.includes('--feed')
const archive = args.find((argument) => !argument.startsWith('--')) ?? DEFAULT_ASAR

/** The client-bundle paths tools/extract-dictionaries.mjs scans. */
const BUNDLE = /^dsh\/node_modules\/@deepseek-ai\/[^/]+\/lib\/client\.js$/

/** The nightly feed the desktop build reads (see the app's resources/app-update.yml). */
const FEED_URL = 'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml'

/**
 * Hash the archive without loading it into memory.
 * @param file - path to the `.asar`.
 * @returns lowercase hex sha256.
 */
function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

/**
 * Read the one release identity the feed publishes per file.
 * @returns `{ version, sha512, releaseDate }`, or undefined when unreachable.
 */
async function readFeed() {
  try {
    const response = await fetch(FEED_URL)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    const field = (name) => new RegExp(`^\\s*${name}:\\s*'?([^'\\n]+)'?\\s*$`, 'm').exec(text)?.[1] ?? null
    /* electron-updater writes the hash as a `>-` block scalar under `files:`,
     * so read the scalar's body when the inline value is only the marker. */
    const sha512 = /sha512:\s*(?:>-?\s*\n\s*)?([A-Za-z0-9+/=]{40,})/.exec(text)?.[1] ?? null
    const version = field('version')
    if (version === null) throw new Error('no version field')
    return { url: FEED_URL, version, sha512, releaseDate: field('releaseDate') }
  } catch (error) {
    console.warn(`feed unavailable (${error.message}); recording the build without it`)
    return undefined
  }
}

const { entries } = readAsar(archive)
const clientBundles = entries.filter((entry) => BUNDLE.test(entry.path)).length
const manifest = JSON.parse(readAsarFile(archive, 'dsh/package.json').toString('utf8'))
const digest = await sha256(archive)

const extractedFile = path.resolve(pkgRoot, '..', '_work', 'extracted.json')
let counts = null
if (fs.existsSync(extractedFile)) {
  const extracted = JSON.parse(fs.readFileSync(extractedFile, 'utf8'))
  const namespaces = Object.keys(extracted)
  const keys = namespaces.reduce((sum, ns) => sum + Object.keys(extracted[ns].en ?? {}).length, 0)
  counts = { namespaces: namespaces.length, englishKeys: keys }
}

const feed = withFeed ? await readFeed() : undefined
const source = {
  _comment: [
    'The DSH build this pack was extracted from. tools/pin-source.mjs writes it; nothing else should.',
    'tools/drift.mjs measures the next build against data/en.json, and every coverage claim in the',
    'README is a statement about the pair (pack version in package.json, target.dshVersion here).',
  ],
  target: {
    distro: 'desktop',
    dshVersion: manifest.version,
    channel: 'nightly',
    asarSha256: digest,
    clientBundles,
    ...(counts ?? {}),
  },
  ...(feed === undefined ? {} : { feed }),
  extractedAt: new Date().toISOString(),
}

const outFile = path.join(pkgRoot, 'data', 'source.json')
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, `${JSON.stringify(source, null, 1)}\n`, 'utf8')

console.log(`DSH ${manifest.version} — ${clientBundles} client bundles`)
if (counts !== null) console.log(`extracted: ${counts.namespaces} namespaces, ${counts.englishKeys} English keys`)
console.log(`asar sha256: ${digest}`)
if (feed !== undefined) console.log(`feed: ${feed.version} (released ${feed.releaseDate})`)
console.log(`wrote ${outFile}`)
