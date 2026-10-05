# dsh-ko-locale

Korean (한국어) language pack for the DeepSeek Harness desktop and web GUI.

Adds `ko` to the locale catalog and serves Korean copy for **every namespace the
shipped client plugins register** — 2,412 strings across 56 namespaces, i.e. the
whole web GUI surface (chat, conversation, trajectory, workspace, sidebar,
settings, plugins, jobs, subagents, deliverables, schedules, voice input, …).

## What you get

- **Korean in Settings → General → Language.** It appears next to English and
  中文, and selecting it persists like any other DSH locale choice.
- **Korean on a Korean machine, automatically.** A fresh profile on a machine
  whose system/browser languages ask for Korean opens in Korean. An explicit
  language choice is always honoured instead.
- **Per-key fallback.** Any string the pack does not carry (for example copy
  added by a DSH update, or a plugin you installed afterwards) falls back to the
  shipped English dictionary rather than showing a raw key name.

## Install

The pack is published to npm, so one command installs the dependency *and*
selects the bundle:

```bash
dsh plugin --profile desktop add dsh-ko-locale
```

Use the profile you actually run: `desktop` for the desktop app, `web` for
`dsh web`. Then reload the GUI (Ctrl+R). Later changes to the package need a
full app restart, because the Host keeps the module generation it already
loaded.

Without npm access, the same command takes the repository directly — the built
browser bundle is committed, so there is no build step:

```bash
dsh plugin --profile desktop add github:ara-hwang/dsh-ko-locale
```

`dsh` ships with the desktop application at
`resources/runtime/cli/bin/dsh.cmd`. The Settings → Plugins page performs the
same two steps, which is the friendlier route when that directory is not on
`PATH`. A failed install restores `package.json` and the lockfile by itself.

### Installing by hand

To develop against a checkout instead of a published version, point the profile
manifest at it. Edit `~/.dsh/profiles/<profile>/package.json`:

```json
{
  "dependencies": {
    "dsh-ko-locale": "file:../../path/to/dsh-ko-locale"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-ko-locale"
      ]
    }
  }
}
```

then run `pnpm install` in the profile directory. A `file:` dependency is
hard-linked into the profile, so rebuilding here replaces the installed bundle
in place — the running app then picks the new artifact up on its next
recomposition, or on restart.

### Uninstall

Remove `"dsh-ko-locale"` from `dsh.profile.bundles` and from `dependencies`,
then run `pnpm install` again in the profile directory and restart. The Korean
catalog entry and the overlay are both owned effects of the plugin, so the GUI
returns to English with nothing left behind.

## How it works

Two contributions, both owned effects of one client plugin:

1. **A language definition** — `ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' })`,
   the public entry point documented in `@deepseek-ai/dsh-client-locale`.
2. **A dictionary overlay** installed on `LocaleRuntime.prototype.lookup`.

### Why an overlay instead of plain `ctx.locale.register`

`LocaleRuntime.register` rejects a namespace/locale pair that already exists:

```js
for (const [locale] of pairs) if (locales.has(localeKey(locale)))
  throw new Error(`locale namespace "${ns}" already has locale "${locale}"`)
```

Every namespace this pack translates is *already* registered by its owning
package for `zh` and `en`, and there is no replace or merge entry point. A
language pack therefore cannot take a built-in namespace over through the public
dictionary API. `lookup` is the single seam every translation read funnels
through (`bind` → `translate` → `lookup`), so overriding it reaches all copy —
including slot-rendered text — without modifying any package.

Two consequences are handled explicitly:

- **`register` is wrapped too.** A namespace some *other* plugin localizes into
  Korean is recorded and this pack steps aside for it, so a plugin that ships
  its own `ko` dictionary wins over the overlay.
- **`publish` invalidates a memo** of the active locale, so switching languages
  is picked up immediately.

### Autonomous start-up

`LocaleRuntime` derives the provisional locale in its constructor, before any
language pack can register, and `addLanguage` publishes through
`publishCatalog` → `localeList` → `resolveActive`, which read the *previous*
snapshot. Both are therefore adjusted:

- `localeList` reports the catalog so a language being added is never dropped
  from the list it is being added to.
- `resolveActive` re-decides the provisional locale while nothing is stored, so
  a Korean machine opens in Korean rather than English.

Everything the pack touches is restored by its disposer; disabling the plugin
returns the runtime to its original behaviour (verified in `tools/smoke-test.mjs`).

## Layout

| Path | Role |
|---|---|
| `src/client.js` | Browser half — catalog registration, overlay, start-up rules |
| `src/index.js` | Host half — inert mount point (see the file's comment) |
| `data/ko.json` | Shipped Korean dictionaries, `namespace -> { key: text }` |
| `data/en.json`, `data/zh.json` | Source English/Chinese, kept for auditing |
| `data/overrides.json` | Reviewed corrections applied after the translation merge |
| `lib/client.js` | **Generated** bundle with the dictionaries inlined |
| `lib/index.js` | **Generated** host half |
| `cordis.patch.yml` | Bundle layer: the one loader row this package inserts |
| `tools/asar.mjs` | Tiny ASAR reader (`list` / `extract`) for the installed app |
| `tools/extract-dictionaries.mjs` | Pull every shipped `zh`/`en` dictionary out of `app.asar` |
| `tools/prepare-translation.mjs` | Pack those dictionaries into balanced translation chunks |
| `tools/verify-translations.mjs` | Check translated chunks against their English source |
| `tools/assemble.mjs` | Merge translation chunks into `data/*.json` |
| `tools/audit-untranslated.mjs` | List values that stayed English, with the Chinese for context |
| `tools/build.mjs` | Inline `data/ko.json` into `lib/client.js` |
| `tools/smoke-test.mjs` | Drive the pack against the real `LocaleRuntime` |
| `tools/probe-bundle-route.mjs` | Ask a running app for the served bundle |

`lib/` is generated — edit `src/` and `data/`, then run `node tools/build.mjs`.

## Verifying

```
node tools/smoke-test.mjs [path/to/@deepseek-ai/dsh-client-locale/lib/client.js]
```

The test reads the **real** `LocaleRuntime` straight out of the installed
application's `app.asar` (pass an explicit path only to test against a different
build) and asserts 28 behaviours: catalog registration, Korean activation on a
Korean machine, explicit selection, per-key English fallback, disposal restoring
the runtime, and data integrity (no blank values, no empty namespace, placeholder
tokens identical to the English source).

To confirm the running Host really composed and serves the pack — and that the
page's loader will find it under the id the bundle registers — ask the live web
carrier for the revision-addressed route:

```bash
node tools/probe-bundle-route.mjs        # prints status, bytes and Hangul count
```

A package that is not an enabled loader entry answers `404` for every revision,
so a `200` with a non-trivial Hangul count proves the whole chain: profile
dependency → bundle patch → loader row → boot graph → served bundle.

## Updating after a DSH upgrade

A DSH upgrade can add or reword English strings. Anything new falls back to
English automatically, so the pack never breaks — it just becomes incomplete.
To top it up:

```bash
node tools/extract-dictionaries.mjs            # app.asar -> ../_work/extracted.json
node tools/prepare-translation.mjs             # -> ../_work/chunks/chunk-*.json
#   translate each chunk into ../_work/ko/<chunkId>.json as
#   { "id": "<chunkId>", "groups": [{ "ns", "ko": { key: text } }] }
node tools/verify-translations.mjs             # missing/blank/odd keys
node tools/assemble.mjs                        # -> data/en.json, data/zh.json, data/ko.json
node tools/audit-untranslated.mjs              # review values that stayed English
node tools/build.mjs                           # -> lib/client.js
node tools/smoke-test.mjs                      # behavior against the real runtime
```

Then rerun `pnpm install` in the profile directory and restart the app. The
assemble step prints its coverage, so a partial translation is visible before
anything ships, and any correction you make while reviewing the audit output
belongs in `data/overrides.json` so it survives the next regeneration.

Every path above defaults to a scratch directory beside this repository
(`../_work`), which is not tracked; each tool also takes explicit arguments.
Nothing outside `data/` and the generated `lib/` is ever written inside the
repository.

## Releasing

Bump the version in `package.json`, then publish:

```bash
npm publish            # add --otp=<code> when the account enforces 2FA
```

`prepublishOnly` rebuilds `lib/` and runs the smoke test against the installed
`LocaleRuntime`, so a pack that no longer matches the runtime cannot reach the
registry. The tarball carries only `LICENSE`, `README.md`, `cordis.patch.yml`
and the generated `lib/` files — seven files, ~84 kB packed — because that is
everything a profile needs to resolve and serve the plugin; `src/`, `data/` and
`tools/` stay in the repository.

Committing `lib/` is deliberate. A `file:` dependency is not run through
`prepare`, and DSH's plugin manager runs pnpm in a scrubbed environment where a
failing install script would fail the whole operation, so the built bundle ships
in the repository and in the tarball instead of being produced at install time.

## Known limitations

- **The overlay is internal-facing.** It depends on `LocaleRuntime`'s method
  names (`lookup`, `register`, `localeList`, `resolveActive`, `publish`). A DSH
  release that renames them disables the pack with a console error rather than
  corrupting anything — the pack logs
  `dsh-ko-locale: unrecognized locale runtime` and does nothing.
- **No plural rules.** Like the shipped locales, the pack is a flat dictionary;
  Korean plurals are handled by phrasing, not by the locale registry.
- **Host-side copy is out of scope.** Some strings live in the Node half (tool
  descriptions, CLI output, window chrome). This pack translates the browser
  client, which is what the desktop GUI renders.
- **Package metadata stays English.** The Plugin list renders each installed
  plugin's title and description through `ctx.locale.resolveText`, which reads a
  `LocalizedText` map authored inside that plugin's own manifest. Manifests ship
  only `en`/`zh`, and a client language pack cannot add entries to them, so those
  rows keep their authored language.
- **Text captured at registration time** (for example a command description
  registered once outside the slot render path) keeps the language it was
  registered under until re-registration — a limitation of the locale service
  itself, not of this pack.

## License

MIT — see [LICENSE](LICENSE).

The Korean strings were produced against the English and Chinese dictionaries
that ship inside the DeepSeek Harness desktop application. Those dictionaries
remain the property of their authors; this repository carries only the derived
Korean translation, the overlay that serves it, and the tooling that regenerates
it.
