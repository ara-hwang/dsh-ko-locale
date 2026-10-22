# dsh-ko-locale

Korean (한국어) language pack for the DeepSeek Harness desktop and web GUI.

Adds `ko` to the locale catalog and serves Korean copy for **every namespace the
shipped client plugins register** — 2,699 strings across 60 namespaces of DeepSeek
Harness 0.2.1-rc.2, i.e. the whole web GUI surface (chat, conversation, trajectory,
workspace, sidebar, settings, plugins and the plugin market, session inspector,
jobs, subagents, deliverables, schedules, voice input, …). The one namespace left
in English is a one-string model badge; [`data/scope.json`](data/scope.json)
records why.

## What you get

- **Korean in Settings → General → Language.** It appears next to English and
  中文, and selecting it persists like any other DSH locale choice.
- **Korean on a Korean machine, automatically.** A fresh profile on a machine
  whose system/browser languages ask for Korean opens in Korean. An explicit
  language choice is always honoured instead.
- **Per-key fallback.** Any string the pack does not carry (for example copy
  added by a DSH update, or a plugin you installed afterwards) falls back to the
  shipped English dictionary rather than showing a raw key name.
- **Formal register throughout.** Every translated sentence uses 합니다체 —
  `…합니다`, `…입니다`, `…하십시오`, `…하시겠습니까?` — so the GUI reads as one voice
  rather than a mix of styles.

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

That blocks a *takeover* — two plugins cannot both own `ko` for one namespace, and
there is no replace or merge entry point. It does not block adding `ko` to a
namespace that already ships `zh` and `en`: on 0.2.1-rc.2 that public path works.
[`docs/mechanism-review.md`](docs/mechanism-review.md) records the measurement and
why this release still keeps the overlay. What the overlay provides today:

- **One owner for every translated namespace** — `lookup` serves the pack's entries
  whether or not the owning package has registered its dictionaries yet.
- **A plugin that localizes into Korean wins** — a namespace some *other* plugin
  registers `ko` for is recorded, and this pack steps aside for it.
- **Immediate language switching** — `publish` invalidates the active-locale memo.

Everything the pack touches is restored by its disposer; disabling the plugin
returns the runtime to its original behaviour (verified in `tools/smoke-test.mjs`).

## Layout

| Path | Role |
|---|---|
| `src/` | The plugin: `client.js` is the browser half, `index.js` the host mount point |
| `data/` | `ko.json` (shipped Korean), `en.json`/`zh.json` (audit baseline), `overrides.json` (reviewed corrections) |
| `data/source.json` | The DSH build the dictionaries were extracted from; written by `npm run pin` |
| `data/glossary.ko.json` | Approved Korean terminology; `tools/check-glossary.mjs` lints the pack against it |
| `data/scope.json` | Entries the pack skips by decision, each with its reason |
| `data/dead-keys.json` | Translations retired when a build dropped their key; reused if the key returns |
| `lib/` | **Generated** by `node tools/build.mjs` — the installed artifact |
| `tools/` | The extraction, translation, build and verification pipeline |
| `cordis.patch.yml` | Bundle layer: the one loader row this package inserts |

Each tool explains itself in its own header comment, and
[`docs/regenerating.md`](docs/regenerating.md) runs them as a sequence.

## Verifying

```
node tools/smoke-test.mjs
```

Reads the **real** `LocaleRuntime` straight out of the installed application's
`app.asar` and asserts 22 behaviours: catalog registration, Korean activation on
a Korean machine through the browser path, explicit selection, per-key English
fallback, and disposal restoring the runtime. `DSH_ASAR` points it at a different
install.

`npm run check` is the portable half — dictionary shape, committed build equality,
coverage against the pinned baseline, and the glossary — and is what CI and
`prepublishOnly` run. `npm run drift` compares the installed build with the shipped
baseline and exits non-zero while the pack is behind; `npm run probe:api`
re-measures the public locale API seam ([docs/mechanism-review.md](docs/mechanism-review.md)).

To confirm the running Host really composed and serves the pack — and that the
page's loader will find it under the id the bundle registers — ask the live web
carrier for the revision-addressed route:

```bash
node tools/probe-bundle-route.mjs        # prints status, bytes and Hangul count
```

A package that is not an enabled loader entry answers `404` for every revision,
so a `200` with a non-trivial Hangul count proves the whole chain: profile
dependency → bundle patch → loader row → boot graph → served bundle.

## Topping up after a DSH upgrade

A DSH upgrade can add or reword English strings. Anything the pack lacks falls
back to English, so the pack never breaks — it just becomes incomplete. The
routine update translates only the delta and keeps every reviewed line:

```bash
npm run pin      # record the installed build in data/source.json
npm run extract  # read the shipped dictionaries out of app.asar
npm run drift    # added / changed / removed; exits non-zero until closed
# translate ../_work/delta/<namespace>.json with data/glossary.ko.json in hand
npm run merge    # splice the delta onto the reviewed dictionary
npm run verify && npm run assemble && npm run build && npm run check && npm test
```

`drift` names the work; `merge` refuses to carry old Korean for a reworded English
string; `data/dead-keys.json` keeps a translation whose key disappeared so a later
build can reuse it. [`docs/regenerating.md`](docs/regenerating.md) documents the
sequence, including the full regeneration used only for the first pack or a
mechanism change.

## Releasing

Pushing a `v*` tag publishes through GitHub Actions with OIDC trusted
publishing, so no npm token is stored anywhere:

```bash
npm version patch --no-git-tag-version   # or edit package.json
git commit -am "Release x.y.z"
git tag -a vx.y.z -m "dsh-ko-locale x.y.z"
git push && git push --tags
```

`.github/workflows/publish.yml` checks that the tag matches `package.json`,
rebuilds the bundle, fails if the committed `lib/` was stale, checks the
dictionaries portably, and publishes. The publish needs a trusted publisher
configured on npmjs.com — see [`AGENTS.md`](AGENTS.md) for the exact values and
the two fields npm does not verify at configuration time.

To publish locally instead, `npm publish` works from an interactive terminal;
it needs 2FA, which means either a one-time password or the browser flow that
appears only when stdin and stdout are both a TTY. From a script or a CI pipe it
fails with `EOTP` before either is offered.

A freshly published version is not what the next install receives: pnpm's
default supply-chain policy holds back releases younger than its minimum release
age, so `dsh plugin add dsh-ko-locale` keeps resolving to the previous version
until the new one has aged. Add `--config.minimumReleaseAge=0` to the command to
install it immediately.

`prepublishOnly` rebuilds `lib/` and runs `npm run check` — the portable
dictionary check, which is the strongest gate available without the DSH
application. `npm test` additionally drives the real `LocaleRuntime`. The
tarball carries only `LICENSE`, `README.md`, `cordis.patch.yml` and the
generated `lib/` files — seven files, ~95 kB packed — because that is everything
a profile needs to resolve and serve the plugin; `src/`, `data/`, `docs/`,
`tools/` and the workflows stay in the repository. Those generated files are
committed rather than built at install time, for the reason
[`AGENTS.md`](AGENTS.md) gives.

## Known limitations

- **The overlay is internal-facing.** It depends on `LocaleRuntime`'s method
  names (`lookup`, `register`, `localeList`, `resolveActive`, `publish`). A DSH
  release that renames them disables the pack with a console error rather than
  corrupting anything — the pack logs
  `dsh-ko-locale: unrecognized locale runtime` and does nothing. `npm run probe:api`
  measures which parts the public API already covers; the next release moves the
  pack onto it ([docs/mechanism-review.md](docs/mechanism-review.md)).
- **One namespace is out of scope by decision.** `deepseek-model-label-1017` holds a
  single model badge in a namespace stamped per model release. It stays English and
  [`data/scope.json`](data/scope.json) records why; a future build ships a
  differently named namespace and `drift` reports it.
- **The plugin market's content is not UI copy.** The Discover page is translated,
  but each listed plugin's title, description and readme come from its own
  manifest/registry, so those stay in whatever language the publisher wrote.
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
that ship inside the DeepSeek Harness desktop application (0.2.1-rc.2 at this
release). Those dictionaries
remain the property of their authors; this repository carries only the derived
Korean translation, the overlay that serves it, and the tooling that regenerates
it.
