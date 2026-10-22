# Mechanism review: is the prototype overlay still needed?

`src/client.js` installs its Korean dictionaries by patching
`LocaleRuntime.prototype.lookup` (plus `register`, `localeList`, `resolveActive`
and `publish`). The comment at the top of that file says a language pack has no
other way in: `register` rejects a namespace/locale pair that already exists and
offers no replace or merge entry point.

That is still true for *one* case — a second owner of the same `ko` dictionary —
but it is not true for the job this pack actually does. On DSH 0.2.1-rc.2 the
public API serves a language pack on its own. This note records the measurement,
the decision, and what the next release should do about it.

## How it was measured

`tools/probe-public-api.mjs` drives the real `LocaleRuntime` out of the installed
`app.asar` — the same class the GUI runs, not a stub — and asserts six behaviours:

```bash
npm run probe:api
```

It lives outside `npm test` on purpose. A failure means the *host runtime* moved,
which calls for re-reading this note, not that the shipped pack broke.

## What 0.2.1-rc.2 does

| Question | Result |
|---|---|
| `register('common', 'ko', {...})` on a namespace already registered for `zh`/`en` | accepted; Korean is served |
| A key the added dictionary lacks | falls through the fallback chain to English |
| Korean machine, no stored preference, `addLanguage` called after construction | `snapshot.active` becomes `ko` (the constructor's provisional value is recomputed by `publishCatalog`, which `addLanguage` calls) |
| Korean copy through the public API alone | served, with no prototype patch |
| `localeList` / snapshot after `addLanguage` | already contains `ko`; the `localeList` patch changes nothing |
| Second `register` for the same namespace and locale | throws `locale namespace "…" already has locale "…"` |

The last row is the only remaining gap, and it is not the gap the pack's comment
describes: the pack needs a *takeover* seam (another plugin already shipping `ko`)
only if two language packs name the same language — a policy question, not the
normal update path.

The pack's own smoke test could not see this, because it simulated a machine
language through `navigator` without a browser `window`, and the runtime skips
browser detection when no shell exists. Its "opens in English" assertion therefore
passed for the wrong reason. `tools/smoke-test.mjs` now defines the marker, so the
scenario exercises the path the GUI takes.

## Decision for 0.1.3

Keep the overlay for this release. Adding 300 Korean strings and rewriting the
pack's disposal and precedence semantics in one release would put a mechanism
change behind a content diff, where a regression is hardest to see. The overlay is
verified working against 0.2.1-rc.2 (`npm test` passes on the real runtime), and the
public-API path is now recorded as an executable probe rather than a comment.

## What the next release should do

1. Serve dictionaries through `ctx.locale.register(ns, 'ko', …)` as owned effects,
   and delete the `lookup`, `localeList`, `resolveActive` and `publish` overrides.
2. Keep one explicit rule for a namespace another plugin localizes into Korean —
   whichever ownership policy is chosen, state it where the dictionaries are
   registered instead of inside a patched `lookup`.
3. Rewrite the smoke scenarios to assert through the public API, then delete
   `PATCH_MARK` and the `unrecognized locale runtime` fallback.
4. Re-run this probe first: if the second-registration gap has closed upstream,
   the migration is a deletion, not a design.

The probe is cheap and the answer changes with every DSH upgrade, so run it before
any future mechanism work — and after a large upgrade, before assuming the pack's
comments still describe the runtime.
