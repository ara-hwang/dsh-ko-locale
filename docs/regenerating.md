# Topping up the pack

A DSH upgrade adds, rewords or drops English strings. Anything the pack lacks falls
back to English, so it never breaks — it just becomes incomplete. Two sequences
close the gap; pick by what changed.

- **A new DSH build** (the normal case): keep the shipped Korean and translate only
  the delta. This is the sequence below.
- **The initial pack, or a mechanism change**: rebuild the whole dictionary. That is
  the "Full regeneration" section at the end, and it re-translates every string —
  use it only when the delta path does not apply.

Run every command from the repository root. The scratch tree defaults to `../_work`,
beside the repository; every tool also takes explicit arguments.

## 1. Pin the build

```bash
npm run pin                     # -> data/source.json
```

Measures the installed application: DSH version, `app.asar` sha256, client-bundle
count, and — with `--feed` — the nightly feed's version/sha512/releaseDate. Every
coverage claim later is a statement about the pair (pack version, this build).
**Done when** `target.dshVersion` is the build you mean to support.

## 2. Extract and measure the drift

```bash
npm run extract                 # -> ../_work/extracted.json
npm run drift                   # -> added / changed / removed, exits non-zero while a gap remains
```

`drift` compares the extracted source with `data/en.json` and names exactly what a
translation pass has to produce. Entries listed in `data/scope.json` are reported
and skipped, not hidden.
**Done when** you have the list and understand which namespaces own each entry.

## 3. Translate only the delta

Write `../_work/delta/<namespace>.json` — one flat `{ key: korean }` object per
namespace, covering exactly the added and changed keys `drift` named:

```json
{ "refresh": "새로 고침", "retry": "다시 시도" }
```

Use the extracted call site to judge the role (label, button, error, tooltip, aria
label), the Chinese dictionary as a semantic anchor, and
[`data/glossary.ko.json`](../data/glossary.ko.json) for terminology. Keep every
`{token}` verbatim; keep product names, commands, paths, units and acronyms in
English; keep the source's trailing period and surrounding spaces.
**Done when** every added and reworded key has a Korean value.

## 4. Splice, verify, assemble

```bash
npm run merge                   # -> ../_work/chunks, ../_work/ko; updates data/dead-keys.json
npm run verify                  # missing / blank / unexpected keys
npm run assemble                # -> data/en.json, data/zh.json, data/ko.json
npm run audit                   # each value still identical to English + its Chinese
```

`merge` walks the pinned source and keeps every key the delta did not touch
byte-for-byte from `data/ko.json`; it refuses to carry old Korean for an English
string the build reworded. Removed keys are recorded in `data/dead-keys.json`, and
a returning key reuses its retired translation. `assemble` applies
`data/overrides.json` last.
**Done when** `merge` reports no missing and no un-re-reviewed key, `verify` reports
`missing=0 blank=0`, and you have judged every `audit` line.

Record a correction in `data/overrides.json`, never by editing `data/ko.json` —
assemble regenerates that file, and the override layer is what makes the fix
repeatable.

## 5. Build and prove it

```bash
npm run build                   # -> lib/client.js
npm run check                   # portable: data, build equality, coverage, glossary, pin
npm test                        # + the real LocaleRuntime, 22 behaviours
npm run probe:api               # the public-API capability probe (docs/mechanism-review.md)
npm run probe                   # only while the app is running
```

**Done when** `check` prints `ALL PASS`, the smoke test prints `ALL PASS`, the probe
reports `SERVED`, and `npm run drift` prints `IN SYNC` against the pinned build.

## 6. Ship

Commit `lib/` along with everything else — it is the installed artifact — then
publish as the README describes. Reinstalling the profile picks the new bundle up on
its next recomposition; a restart is the reliable way.

## Full regeneration

Only for the first pack or a mechanism change. Every string is translated again, so
it churns thousands of reviewed lines and is never the routine update.

```bash
node tools/extract-dictionaries.mjs        # -> ../_work/extracted.json
node tools/prepare-translation.mjs         # -> ../_work/chunks/chunk-NN.json
# write ../_work/ko/<chunkId>.json, one { id, groups: [{ ns, ko }] } per chunk
node tools/verify-translations.mjs         # missing / blank / unexpected keys
node tools/assemble.mjs                    # -> data/en.json, data/zh.json, data/ko.json
node tools/audit-untranslated.mjs          # each remaining English value + its Chinese
node tools/build.mjs                       # -> lib/client.js
node tools/check-data.mjs                  # portable checks
node tools/smoke-test.mjs                  # 22 checks against the real runtime
```

Chunks are balanced by key count (greedy bin packing into the smallest bin), because
namespace sizes here range from 1 to 367 keys and an unbalanced split makes one
translation pass enormous and the rest trivial. Translations are merged by
namespace rather than chunk-for-chunk, so a later top-up pass may legitimately cover
namespaces that sit in several source chunks.
