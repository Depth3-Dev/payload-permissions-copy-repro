# `getAccessResults` copies the whole permissions tree on every call (Payload 3.93+)

Since v3.93.0, `sanitizePermissions` starts with `const data = deepCopyObject(permissions)`, and
`getAccessResults` hands it a tree it has just built, so every call copies the whole unsanitized
tree before cutting it down to a far smaller result. On the same generated config, `getAccessResults`
for an admin user takes about three times as long on 3.94.1 as on 3.92.1, and the extra time grows
with the config (+1.1 ms, +3.9 ms, +18.4 ms for the three sizes here); taking the whole-tree copy out
of `sanitizePermissions` removes almost exactly the time `deepCopyObject` alone needs, and
`getAccessResults` returns an identical result.

## Run it

Node 22 or later and pnpm (tested with pnpm 11.9):

```sh
git clone https://github.com/Depth3-Dev/payload-permissions-copy-repro && cd payload-permissions-copy-repro
pnpm install
pnpm bench
```

`pnpm bench` takes two to three minutes and prints the table below. `pnpm bench:quick` runs only the
`default` and `default-refs` presets; `pnpm bench --shape 30,12,8,references` runs any size
(collections, blocks, fields per block, `inline` or `references`). No database server, no Next app,
no browser: the config has a SQLite adapter only because Payload needs one, and Payload is started
with `disableDBConnect: true`.

## What is in here

- `variants/3.92.1`, `variants/3.94.1`, `variants/3.94.1-patched`: three small pnpm projects, each
  with its own `payload` and `@payloadcms/db-sqlite` and a lockfile. They are separate projects so
  that the patch applies to one copy of `payload@3.94.1` and not the other. `pnpm install` at the
  root installs all three (`scripts/install-variants.mjs`).
- `patches/payload@3.94.1.patch`: the change, as a pnpm patch of Payload's `dist`
  (see [The proposed change](#the-proposed-change)).
- `src/config.mjs`: a config generated from three numbers: collections, blocks offered in each
  collection's `layout` blocks field, and fields per block. Collection-level access functions for
  every operation, field-level access on some fields, drafts, an auth collection. In `inline` mode
  every collection lists the same block objects; in `references` mode the blocks live once in the
  config's `blocks` and every collection points at them with `blockReferences`. Blocks also repeat
  inside one collection: a second blocks field, `sidebar`, offers the first three blocks again, and
  block-0 has a nested blocks field, `inner`, offering block-1. So every path by which Payload hands
  out one block's permissions more than once runs: across collections, twice at the top level of
  one collection (3.94.1's per-occurrence copy), and inside another block.
- `src/runVariant.mjs`: one measurement in a fresh Node process for one variant. The same code
  runs against each variant's own `payload`.
- `scripts/bench.mjs`: runs every preset on every variant and prints the table.

What each column measures, for an admin user (every access function returns `true` for them):

| column | what |
| --- | --- |
| objects | objects (arrays included) reached in the unsanitized result `getAccessResults` builds; one reached from two places counts twice |
| distinct | how many different objects that is |
| JSON before / after | that result as JSON, and the sanitized result `getAccessResults` returns |
| gAR median / p95 | `await getAccessResults({ req })`, ms, 300 calls after 50 warm-up calls |
| build | building the unsanitized result alone (the body of `getAccessResults` without its last line) |
| deepCopy | `deepCopyObject(unsanitized result)` alone |
| same result | the sanitized result deep-equals 3.94.1's (keys sorted) |

The unsanitized result is rebuilt by `src/runVariant.mjs` from the body of `getAccessResults`,
which is identical in 3.92.1 and 3.94.1, using each version's own `getEntityPermissions` from
`payload/internal`.

## Measured on this machine

`pnpm bench` on 2026-11-24, Apple M3 Pro, macOS (Darwin 24.6.0), Node 22.22.2. The machine was not
idle during the run; the medians of 300 calls are what to compare.

```text
node v22.22.2, Apple M3 Pro, darwin 24.6.0
300 timed calls after 50 warm-up calls, admin user, one process per row

preset        variant         config (C x B x F)      objects  distinct  JSON before     after  gAR median  gAR p95    build  deepCopy  same result
---------------------------------------------------------------------------------------------------------------------------------------------------
small         3.92.1          10 x 5 x 5 inline          4117      4117      93.9 KB   22.5 KB     0.55 ms     1.05     0.32   0.82 ms          yes
small         3.94.1          10 x 5 x 5 inline          4117      4117      93.9 KB   22.5 KB     1.59 ms     1.97     0.51   0.81 ms          yes
small         3.94.1-patched  10 x 5 x 5 inline          4117      4117      93.9 KB   22.5 KB     0.75 ms     0.97     0.53   0.82 ms          yes
default       3.92.1          20 x 10 x 8 inline        14957     14957     341.8 KB   78.2 KB     1.91 ms     2.16     1.18   3.30 ms          yes
default       3.94.1          20 x 10 x 8 inline        14957     14957     341.8 KB   78.2 KB     5.82 ms     6.22     1.79   3.25 ms          yes
default       3.94.1-patched  20 x 10 x 8 inline        14957     14957     341.8 KB   78.2 KB     2.54 ms     2.85     1.75   3.25 ms          yes
default-refs  3.92.1          20 x 10 x 8 refs          14957      1757     341.8 KB    6.8 KB     1.30 ms     1.54     1.12   3.27 ms           NO
default-refs  3.94.1          20 x 10 x 8 refs          14957     14957     341.8 KB   78.2 KB     5.86 ms     6.96     1.78   3.16 ms          yes
default-refs  3.94.1-patched  20 x 10 x 8 refs          14957     14957     341.8 KB   78.2 KB     2.53 ms     2.84     1.78   3.26 ms          yes
large         3.92.1          50 x 20 x 10 inline       69627     69627    1597.5 KB  341.8 KB     9.28 ms    12.10     5.81  15.92 ms          yes
large         3.94.1          50 x 20 x 10 inline       69627     69627    1597.5 KB  341.8 KB    27.64 ms    31.57     7.66  16.43 ms          yes
large         3.94.1-patched  50 x 20 x 10 inline       69627     69627    1597.5 KB  341.8 KB    12.04 ms    16.13     8.41  15.96 ms          yes
large-refs    3.92.1          50 x 20 x 10 refs         69627      3995    1597.5 KB   14.8 KB     5.65 ms     5.99     5.50  16.09 ms           NO
large-refs    3.94.1          50 x 20 x 10 refs         69627     69627    1597.5 KB  341.8 KB    27.39 ms    29.82     7.94  16.28 ms          yes
large-refs    3.94.1-patched  50 x 20 x 10 refs         69627     69627    1597.5 KB  341.8 KB    11.43 ms    13.50     7.78  17.58 ms          yes

objects / distinct: objects reached in getAccessResults' unsanitized result (one reached from two
  places counts twice) and how many different objects that is.
JSON before / after: that result as JSON, and the sanitized result getAccessResults returns.
gAR median / p95: getAccessResults({ req }) in ms.  build: building the unsanitized result alone (median).
deepCopy: deepCopyObject(unsanitized result) alone (median).
same result: the sanitized result deep-equals 3.94.1's.

Checks (medians, ms)
  small
    3.94.1 vs 3.92.1:  +1.05 (2.92x)
    3.94.1 vs patched: +0.84   deepCopyObject of the tree alone: 0.81
    patched vs 3.92.1: +0.21 (1.38x)   of which building the tree: +0.21
    same sanitized result: 3.92.1 yes, 3.94.1 yes, 3.94.1-patched yes
    objects reached twice: 3.92.1 0, 3.94.1 0, 3.94.1-patched 0
  default
    3.94.1 vs 3.92.1:  +3.92 (3.05x)
    3.94.1 vs patched: +3.29   deepCopyObject of the tree alone: 3.25
    patched vs 3.92.1: +0.63 (1.33x)   of which building the tree: +0.57
    same sanitized result: 3.92.1 yes, 3.94.1 yes, 3.94.1-patched yes
    objects reached twice: 3.92.1 0, 3.94.1 0, 3.94.1-patched 0
  default-refs
    3.94.1 vs 3.92.1:  +4.56 (4.50x)
    3.94.1 vs patched: +3.33   deepCopyObject of the tree alone: 3.16
    patched vs 3.92.1: +1.23 (1.94x)   of which building the tree: +0.67
    same sanitized result: 3.92.1 NO, 3.94.1 yes, 3.94.1-patched yes
    objects reached twice: 3.92.1 13200, 3.94.1 0, 3.94.1-patched 0
  large
    3.94.1 vs 3.92.1:  +18.36 (2.98x)
    3.94.1 vs patched: +15.60   deepCopyObject of the tree alone: 16.43
    patched vs 3.92.1: +2.76 (1.30x)   of which building the tree: +2.60
    same sanitized result: 3.92.1 yes, 3.94.1 yes, 3.94.1-patched yes
    objects reached twice: 3.92.1 0, 3.94.1 0, 3.94.1-patched 0
  large-refs
    3.94.1 vs 3.92.1:  +21.74 (4.85x)
    3.94.1 vs patched: +15.96   deepCopyObject of the tree alone: 16.28
    patched vs 3.92.1: +5.78 (2.02x)   of which building the tree: +2.27
    same sanitized result: 3.92.1 NO, 3.94.1 yes, 3.94.1-patched yes
    objects reached twice: 3.92.1 65632, 3.94.1 0, 3.94.1-patched 0
```

Reading it:

1. **3.94.1 is slower than 3.92.1 on the same config, and the gap grows with the config:** 2.9x to
   3.1x with inline blocks, +1.1 ms, +3.9 ms and +18.4 ms from the small to the large preset.
2. **Taking the whole-tree copy out (3.94.1-patched) removes the time of the copy and nothing
   else:** "3.94.1 vs patched" is within about 0.8 ms of "deepCopyObject of the tree alone" in every
   preset. What is left between patched and 3.92.1 with inline blocks (+0.2 to +2.8 ms) is almost all
   in building the tree, not in sanitizing it: 3.94.1's `populateFieldPermissions` is slower than
   3.92.1's when a block repeats in one collection (the `build` column; not looked into further
   here). For the `-refs` presets 3.92.1 is not a fair baseline: it shared one permissions object
   between every occurrence of a referenced block (see the `distinct` column), so it cleaned far
   fewer objects, and its result was wrong (next point). There the comparison is 3.94.1 against
   3.94.1-patched: same tree, same result, the copy removed.
3. **The sanitized result is identical** in 3.94.1 and 3.94.1-patched for every preset, and in
   3.92.1 for the `inline` presets. 3.92.1 differs on the `-refs` presets because of the bug that
   3.93.0 fixed: with one permissions object shared by every occurrence of a referenced block, it
   reports `fields: true` for blocks in which every fourth field (`b*f3`, `b*f7`) denies `update`;
   3.94.1 reports those fields as `{ create: true, read: true }`.
4. **In 3.94.1's unsanitized result no object is reached twice** (`objects` = `distinct`), with
   inline blocks and with `blockReferences` alike, and with a block repeated in one collection and
   nested in another block: `populateFieldPermissions` already gives each occurrence of a block its
   own object (a `deepCopyObject` of the cached one for a repeat at the top level of the same
   collection, a freshly built one otherwise). So the occurrences that the second, whole-tree copy
   in `sanitizePermissions` keeps apart are already apart in the tree `getAccessResults` builds.

## Where the copy came from

- **3.x, commit `21bdbbf3`** ("fix: enforce block child read access in queries", 2026-11-04,
  released in v3.93.0). In `populateFieldPermissions` it replaced the `blockReferencesPermissions`
  cache, which handed the same object to every occurrence of a referenced block, with a cache local
  to one `getEntityPermissions` call whose hits are `deepCopyObject(cached)`. In
  `sanitizePermissions` it added `const data = deepCopyObject(permissions)` with the comment "Each
  occurrence must be sanitized independently, including shared block references." It is still
  there in v3.94.1 and at the head of `3.x`.
- **main, commit `45e833fe`** (same title, same day): the same `populateFieldPermissions` change,
  but `sanitizePermissions` still sanitizes in place, with no copy. Checked at the head of `main`
  and in `payload@4.0.0-canary.20261122`.
- **v3.92.1 and earlier** sanitize in place.

So the per-occurrence copy in `populateFieldPermissions` is what makes each occurrence independent;
the whole-tree copy in `sanitizePermissions` makes the same separation a second time. On a large
production config the unsanitized result for an admin was 22,462 objects.

How often an admin page pays it: in `@payloadcms/next` 3.94.1, `initReq`
(`dist/utilities/initReq.js`) calls `getAccessResults` and is called by the root layout
(`key: 'RootLayout'`), the root view (`key: 'initPage'`, with a new `overrides` object) and the
not-found view (`key: 'RootLayout'`, with a new `overrides` object). Its cache is React's `cache`,
which compares arguments by identity, so the second and third calls do not reuse the first. In a
production app on 3.94.1 we saw three calls per admin page render. This repository does not
measure page renders (that needs a Next app); it measures one call.

## The proposed change

`patches/payload@3.94.1.patch`, a pnpm patch of three files in Payload's `dist` (the same change in
`src` is a few lines):

- `sanitizePermissions` sanitizes in place, as it does on `main` (45e833fe): the whole-tree
  `deepCopyObject` at its start is gone. Payload's own callers, `getAccessResults` and the two
  `docAccess` operations, hand it a tree they have just built.
- Results returned by access functions are stored as copies, so sanitizing in place never edits an
  object the application handed over: `getEntityPermissions` stores `deepCopyObject(accessResult)`
  as an operation's `where` (in both of its branches), and `getAccessResults` stores
  `deepCopyObject(await access.admin(...))` as `canAccessAdmin`.

What this form gives up: on 3.x, 21bdbbf3 also added a spec, "should sanitize shared block nodes
independently without changing the input", which hands `sanitizePermissions` one entity object
shared by two collections and a global. Against the patched package that test fails: 11 of the 12
tests in the package's own `dist/utilities/sanitizePermissions.spec.js` pass (all 12 on unpatched
3.94.1; run with a small stand-in for vitest's `describe`, `it` and `expect`). The shared object is sanitized a second time on its second visit and comes back as
`fields: true` instead of the per-field permissions the spec expects, and the argument is changed.
The trees Payload builds itself share no object (the `distinct` column), which is why
`getAccessResults` returns the same result as on 3.94.1 here (the `same result` column). A caller
that hands `sanitizePermissions` shared objects still needs the copy, so upstream would choose
between keeping a copying `sanitizePermissions` for such callers (with the in-place form used by
Payload's own callers that build the tree) and dropping that contract and its spec, as `main` has
neither.

## What is not claimed

- Not that 3.94.1 returns a wrong result. The results are identical; the claim is about time.
- Not that the in-place form is right for a caller that hands `sanitizePermissions` shared
  objects (see the previous section).
- Not that these absolute times hold elsewhere. They are from one machine, one Node version, a
  synthetic config, and an admin user; the ratios and the growth with size are the point. Users
  whose access functions return query constraints instead of `true` were not measured.
- Not a count of calls per page render (see above).
- Nothing about the slower tree build in 3.94.1 when a block repeats in one collection (point 2):
  it shows in the `build` column, it is not what the patch changes, and it was not looked into.

## License

MIT, see [LICENSE](LICENSE).
