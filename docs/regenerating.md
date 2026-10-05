# Topping up the pack

A DSH upgrade can add or reword English strings. Anything the pack lacks falls
back to English, so the pack never breaks — it just becomes incomplete. This is
the sequence that closes the gap.

Run every command from the repository root. The scratch tree defaults to
`../_work`, beside the repository; every tool also takes explicit arguments.

## 1. Extract the shipped strings

```bash
node tools/extract-dictionaries.mjs        # app.asar -> ../_work/extracted.json
```

Reads every client bundle out of the installed application and reports the
namespace and key counts it found.
**Done when** those counts describe the DSH release you are targeting.

## 2. Chunk them for translation

```bash
node tools/prepare-translation.mjs         # -> ../_work/chunks/chunk-NN.json
```

Chunks are balanced by key count (greedy bin packing into the smallest bin),
because namespace sizes here range from 1 to 367 keys and an unbalanced split
makes one translation pass enormous and the rest trivial.
**Done when** the printed per-chunk key counts are of similar size.

## 3. Translate each chunk

Write `../_work/ko/<chunkId>.json` for every chunk:

```json
{ "id": "00", "groups": [{ "ns": "conversation", "ko": { "cancel": "취소" } }] }
```

One entry per key in the chunk's `en` object, namespaces and keys spelled
exactly as the source has them. Keep `{token}` placeholders verbatim, and keep
product names, protocol names, command names, units and paths in English — the
worth of a Korean pack is that the surrounding sentence reads naturally, not
that every token was converted.
**Done when** every chunk has a file.

## 4. Check before merging

```bash
node tools/verify-translations.mjs         # missing / blank / unexpected keys
```

Translations are merged by namespace rather than matched chunk-for-chunk, so a
later top-up pass may legitimately cover namespaces that sit in several source
chunks. It also lists values still identical to English, which is where a missed
translation hides.
**Done when** it reports `missing=0 blank=0`.

## 5. Merge, then judge what stayed English

```bash
node tools/assemble.mjs                    # -> data/en.json, data/zh.json, data/ko.json
node tools/audit-untranslated.mjs          # each remaining English value + its Chinese
```

`assemble` prints coverage and applies `data/overrides.json` last. `audit` shows
every value still identical to English beside its Chinese counterpart; where the
Chinese dictionary localized a term, this pack localizes it too, and where it
kept the English the pack keeps it as well.
**Done when** coverage reads 100% and you have judged every audit line.

Record each correction in `data/overrides.json`, never by editing
`data/ko.json` — assemble regenerates that file, and the override layer is what
makes this step repeatable.

## 6. Build and prove it

```bash
node tools/build.mjs                       # -> lib/client.js
node tools/smoke-test.mjs                  # 28 checks against the real runtime
node tools/probe-bundle-route.mjs          # only while the app is running
```

**Done when** the smoke test reports `ALL PASS` and, with the app up, the probe
reports `SERVED`.

## 7. Ship

Commit `lib/` along with everything else — it is the installed artifact — then
publish as the README describes. Reinstalling the profile picks the new bundle
up on its next recomposition; a restart is the reliable way.
