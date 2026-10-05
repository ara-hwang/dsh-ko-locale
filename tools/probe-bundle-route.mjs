/**
 * Ask a running DSH web carrier for this pack's browser bundle.
 *
 * The bundle route is revision-addressed: the revision is a hash of the
 * artifact's mtime, ctime and size, computed by @deepseek-ai/dsh-client-modules
 * (`artifactRevision`). Reproducing it here proves the running Host really
 * composed this package into the boot graph — a package that is not an enabled
 * loader entry answers 404 no matter what revision is asked for.
 *
 * Usage: node tools/probe-bundle-route.mjs [baseUrl] [profileDir]
 *   defaults: http://127.0.0.1:19387  and  %USERPROFILE%\.dsh\profiles\desktop
 * @returns exit code 1 when the route does not serve this pack.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:19387'
const profileDir =
  process.argv[3] ?? path.join(os.homedir(), '.dsh', 'profiles', 'desktop')

/** Mirrors dsh-client-modules `framedHash`. */
function framedHash(domain, parts) {
  const hash = createHash('sha1').update(domain).update('\0')
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part)
  return hash.digest('hex').slice(0, 12)
}

const bundle = path.join(profileDir, 'node_modules', 'dsh-ko-locale', 'lib', 'client.js')
if (!fs.existsSync(bundle)) {
  console.error(`not installed: ${bundle}`)
  process.exit(2)
}
const stats = fs.statSync(bundle)
const revision = framedHash('plugin-artifact', [
  String(stats.mtimeMs),
  String(stats.ctimeMs),
  String(stats.size),
])

const url = `${baseUrl}/plugins/??dsh-ko-locale/client.js&rev=${revision}`
console.log(`bundle     ${bundle}`)
console.log(`revision   ${revision}`)

let response
try {
  response = await fetch(url)
} catch (error) {
  console.error(`request failed: ${error.message}`)
  console.error('Is the DSH desktop app (or `dsh web`) running?')
  process.exit(1)
}
const body = await response.text()
console.log(`status     ${response.status}`)
console.log(`bytes      ${body.length}`)

if (!response.ok) {
  console.error('\nThe Host did not serve the pack. Check that "dsh-ko-locale" is in')
  console.error(`${path.join(profileDir, 'package.json')} -> dsh.profile.bundles and that the`)
  console.error('profile was reloaded after the change.')
  process.exit(1)
}

const markers = ['__DSH_KO_LOCALE__', 'dsh-ko-locale', 'addLanguage']
for (const marker of markers) console.log(`contains   ${marker}: ${body.includes(marker)}`)
const korean = (body.match(/[가-힣]/g) ?? []).length
console.log(`hangul     ${korean} characters`)

const healthy = markers.every((marker) => body.includes(marker)) && korean > 1000
console.log(`\n${healthy ? 'SERVED' : 'SERVED BUT UNEXPECTED CONTENT'}`)
process.exit(healthy ? 0 : 1)
