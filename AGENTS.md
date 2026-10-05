# Working in dsh-ko-locale

Korean language pack for the DeepSeek Harness GUI. [`README.md`](README.md)
explains the pack to people; this file is the map for changing it.

## Where a change goes

| Change | Home |
|---|---|
| Korean wording | `data/ko.json` produces it; `data/overrides.json` corrects it |
| Behaviour | `src/` |

`lib/` is **generated** from both by `node tools/build.mjs`, and committed on
purpose: a `file:` dependency is never run through `prepare`, and DSH's plugin
manager runs pnpm in a scrubbed environment where a failing install script fails
the whole operation. So editing `lib/` by hand loses the change at the next
build — edit `src/` or `data/`, build, and commit `lib/` with it.

`data/overrides.json` exists because the pack is machine-translated first.
`tools/assemble.mjs` applies it after merging the translation chunks, so a
reviewed correction survives the next regeneration instead of being overwritten.

## Branches

**DSH added or reworded English strings** — top up the pack.
[`docs/regenerating.md`](docs/regenerating.md) is the sequence.

**The pack stopped translating anything** — the overlay lost its footing. It
patches `LocaleRuntime.prototype` because `register` rejects a namespace/locale
pair that already exists and offers no replace or merge entry point, so a
language pack cannot take a built-in namespace over through the public API. The
reasoning is at the top of `src/client.js` and in the README's "How it works";
the console prints `dsh-ko-locale: unrecognized locale runtime` when the
runtime's shape has moved.

**A new string is missing its Korean** — add it to `data/overrides.json`, which
needs no chunk file and survives regeneration.

## Running it here

- `npm test` drives the real `LocaleRuntime` out of the installed DSH
  application's `app.asar`, so it needs that app present; `DSH_ASAR` points it
  at a different install.
- The regeneration pipeline writes to a scratch tree beside this repository
  (`../_work`) and never inside it.
- A `file:` install is hard-linked into the profile, so building here replaces
  the installed bundle in place. The running app serves the new artifact after
  its next recomposition, and a restart is the reliable way to force one.
