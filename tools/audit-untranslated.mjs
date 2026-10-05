// List values identical to English, with their Chinese counterpart for context.
// Usage: node tools/audit-untranslated.mjs [dataDir]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.argv[2] ?? path.resolve(here, '..', 'data')

const en = JSON.parse(fs.readFileSync(path.join(dataDir, 'en.json'), 'utf8'))
const zh = JSON.parse(fs.readFileSync(path.join(dataDir, 'zh.json'), 'utf8'))
const ko = JSON.parse(fs.readFileSync(path.join(dataDir, 'ko.json'), 'utf8'))

const rows = []
for (const ns of Object.keys(en)) {
  for (const [key, english] of Object.entries(en[ns])) {
    const korean = ko[ns]?.[key]
    if (korean === undefined || korean !== english) continue
    if (!/[A-Za-z]{3}/.test(english)) continue
    rows.push({ ns, key, english, chinese: zh[ns]?.[key] ?? '' })
  }
}
rows.sort((a, b) => a.ns.localeCompare(b.ns) || a.key.localeCompare(b.key))
for (const row of rows) {
  console.log(`${row.ns}.${row.key}\n    EN=${JSON.stringify(row.english)}  ZH=${JSON.stringify(row.chinese)}`)
}
console.log(`\n${rows.length} values identical to English`)
