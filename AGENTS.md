# Working in dsh-ko-locale

Korean language pack for the DeepSeek Harness GUI. [`README.md`](README.md)
explains the pack to people; this file is the map for changing it.

## Where a change goes

| Change | Home |
|---|---|
| Korean wording | `data/ko.json` produces it; `data/overrides.json` corrects it |
| Behaviour | `src/` |
| Approved terminology | `data/glossary.ko.json`; `tools/check-glossary.mjs` lints against it |
| A decision to skip an entry | `data/scope.json`, with the reason, never a silent omission |
| The build the pack targets | `data/source.json`, written by `npm run pin`; never hand-edit |
| A translation whose key disappeared | `data/dead-keys.json`, maintained by `tools/merge-delta.mjs` |

`lib/` is **generated** from both by `node tools/build.mjs`, and committed on
purpose: a `file:` dependency is never run through `prepare`, and DSH's plugin
manager runs pnpm in a scrubbed environment where a failing install script fails
the whole operation. So editing `lib/` by hand loses the change at the next
build — edit `src/` or `data/`, build, and commit `lib/` with it.

`data/overrides.json` exists because the pack is machine-translated first.
`tools/assemble.mjs` applies it after merging the translation chunks, so a
reviewed correction survives the next regeneration instead of being overwritten.

## Branches

**DSH shipped a new build** — top up only the delta; never re-translate the whole
pack. `npm run pin && npm run extract && npm run drift` names the added, reworded
and removed keys. Translate `_work/delta/<namespace>.json` (the added and reworded
entries only, with `data/glossary.ko.json` in hand), then
`npm run merge && npm run verify && npm run assemble`. Everything the delta does
not touch keeps its reviewed Korean byte-for-byte; `drift` exits non-zero until the
gap is closed. [`docs/regenerating.md`](docs/regenerating.md) runs the sequence.

**The pack stopped translating anything** — the overlay lost its footing. It
patches `LocaleRuntime.prototype` because `register` refuses to take over a
namespace/locale pair that another plugin already owns, so a language pack cannot
merge into a built-in namespace through the public API. The reasoning is in
`src/client.js` and in [`docs/mechanism-review.md`](docs/mechanism-review.md); the
console prints `dsh-ko-locale: unrecognized locale runtime` when the runtime's shape
has moved, and `npm run probe:api` reports which public-API capabilities the
installed build has.

**A new string is missing its Korean** — add it to `data/overrides.json`, which
needs no chunk file and survives regeneration.

## Running it here

- `npm test` drives the real `LocaleRuntime` out of the installed DSH
  application's `app.asar`, so it needs that app present; `DSH_ASAR` points it
  at a different install. `npm run check` is the half that needs nothing
  installed, and is what CI and `prepublishOnly` run.
- `npm run pin` records the installed build in `data/source.json`; `npm run drift`
  measures the next build against the shipped baseline and exits non-zero while
  any real gap remains. `npm run probe:api` re-measures the public-API seam against
  the installed runtime (see [`docs/mechanism-review.md`](docs/mechanism-review.md)).
- The regeneration pipeline writes to a scratch tree beside this repository
  (`../_work`) and never inside it.
- A `file:` install is hard-linked into the profile, so building here replaces
  the installed bundle in place. The running app serves the new artifact after
  its next recomposition, and a restart is the reliable way to force one.

## Publishing

Pushing a `v*` tag runs `.github/workflows/publish.yml`, which publishes over
OIDC trusted publishing. The npm side of that trust lives at
npmjs.com → the package → Settings → Trusted publishing, and must read:

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `ara-hwang` |
| Repository | `dsh-ko-locale` |
| Workflow filename | `publish.yml` (the filename only, at `.github/workflows/`) |
| Environment name | leave empty |
| Allowed actions | **Allow npm publish** — without it only `npm stage publish` is granted |

Nothing verifies those values when they are saved; a mismatch surfaces as
`ENEEDAUTH` on the first tag push. The other precondition npm does not check is
`repository.url` in `package.json`, which must match the GitHub repository
exactly. `permissions: id-token: write` in the workflow is what mints the OIDC
token, and setting `NODE_AUTH_TOKEN` would override it with a token instead.

