# Category search (backend) — review 1

Reviewer: Mayank. Scope: uncommitted haper-backend diff on `dev` (2026-10-17). Read-only.
Tests: 11 suites / 211 tests green (both new files + item, item-search-fallback, home, unpriced-item-hidden,
discount-browse-margin, discount-browse-wiring, multi-category-browse-discount, multi-category-items,
category-subcategory-listing-gap), in-memory Mongo.

## Verified clean
- Aisle predicate refactor is identical. Customer branch builds the same object in the same key order
  (`storeId, status, quantity, sellingPrice, $or`); the admin branch is still `{quantity>0, $or}` then `storeId`.
  Both callers checked (user home `getAllItems`, admin items `getAllItems`). No require cycle (item.constant
  and item-visibility.utils have no requires).
- Store isolation: names are cached globally, but every store-dependent step runs live with the store id
  (count aggregate, disabled-row read, id find, doc fetch). The disabled check is per category, which matches
  the schema. A sub chip under a disabled parent is dropped. No cross-store leak found; a test covers it.
- Stripped fields: `getSearchDocsByIds` uses the same `USER_SEARCH_PROJECTION` as `search4User` and re-applies
  the buyable filter. taxonomy is stripped in the controller. A test asserts no taxonomy/costPrice/quantity/status.
- ReDoS: no regex is built from user input. The three regexes are constants, run on input capped at 64 chars
  (query) and 30 chars (word). Probed `""`, lone surrogate, emoji, NULs, combining-mark floods, `ß`, `İ`:
  none throw, and all give `[]` or sane words.
- Response contract: keys are `item, cart, isFallback, categories`. `categories` is always an array.
  `isFallback` keeps today's rule (page 1 and empty). Cart is unchanged.
- Cache: single-flight is correct, a failed reload falls back to the last good copy, and size is bounded
  by the category master.

## HIGH
**H1. A two-typo rule ships against approved decision 3 ("one typo, 5+ letters, no two-typo rule").**
`packages/shared/utils/category-search.utils.js:13` (`TYPO2_MIN_LEN = 8`) and `:83`
(`max = q.raw.length >= 8 ? 2 : 1`). Words of 8+ letters accept two typos. Probed false matches:
`personal` matches "Seasonal" (score 1), and `bscuitts` matches "Biscuits". So a `personal` search would add a
whole Seasonal category's products after the name hits. No test pins the one-typo rule for long words.
Fix: delete `TYPO2_MIN_LEN` and use `const max = 1`. Add unit cases
`scoreOf("personal","Seasonal") === 0` and `scoreOf("bscuitts","Biscuits") === 0`.

## MEDIUM
**M1. Every page of a category-matched query costs about 10x today's name-search read, plus 4 extra queries.
This includes pages 2-40, where the chips are thrown away.**
`packages/user/src/routes/item/controller.js:53-75`. Today one page is one `$search` with limit 10.
Now every page runs:
- the count aggregate. It is unbounded: it scans and unwinds every buyable item in all matched categories,
  with no early `$project` (`category-search.repository.js:104-129`);
- the disabled-row find;
- `search4User(0, 100)`, which returns up to 100 full projected docs, 90+ of them thrown away;
- an id find of up to 300 ids;
- the doc fetch.

Scrolling 5 pages of `biscuit` loads about 500 name docs, where today it loads 50.

Fix (gives the same output): call `search4User(0, Math.min(NAME_HITS_CAP, end), …)`.
- If it returns `end` rows, the page is all name hits: skip `categoryItemIds` and the doc fetch.
- Otherwise you already hold all of A, so dedupe stays correct.

This takes page 1 from 100 docs to 10. Optional: add `{ $project: { taxonomy:1, category:1, subCategory:1 } }`
before `EFFECTIVE_TAXONOMY_STAGE` in the count aggregate.

## LOW
- **L1. Page contents can shift between requests when stock changes; the guide does not say so.** If a page-1
  item goes out of stock before page 2 is fetched, the list moves left by one and one product is never
  shown. A new hit causes a duplicate, which the clients' id-dedupe hides. This is the normal cost of
  offset paging, so it is acceptable. Fix: add one line to `haper-misc/test-category-search.md`
  (Limits, and step 10's ❌ column) so a tester does not report it as a bug.
- **L2. A short mid-list page stops "load more".** `item.repository.js:1149-1158` re-checks buyability and
  drops ids that went stale since `categoryItemIds` ran milliseconds earlier. That page then has fewer than 10
  items, and the clients' `size >= 10` rule stops paging. The window is tiny. Accept it, or top the page up
  from the next ids.
- **L3. Silent fallback.** `category-search.repository.js:58-60` returns the last-good copy with no log when a
  reload fails. `controller.js:85` logs only `error.message`, with no stack. Add a `console.warn` in the
  snapshot catch.
- **L4. Invisible regex source.** `category-search.utils.js:23` contains raw combining characters U+0300–U+036F.
  They are invisible in editors and diffs. Write `/[̀-ͯ]/g`.
- **L5. Plan IDs in code and wrong doc claims.**
  - The test name has a plan ID: `item-search-category.test.js:89` `"B0 repro: …"`. Drop `B0`.
  - `client-followups.md` CH-15 says iOS/web "both already dedupe on append". Web loads page 1 only
    (plan §2), so that claim is wrong for web.
- **L6. Cheap pathological queries.** A query of single letters passes the 3-letter minimum because letters
  are summed across words (`a b c` scores 2 against "Vitamin A B C"). Separately, a crafted 6-word near-miss
  query against 1,500 names costs about 19 ms of CPU per request; with H1 fixed it costs less. Acceptable at
  the real master size. Note it only.

No worklog comments or agent names found in the source. Comment density matches the codebase.

## Verdict
REQUEST CHANGES. H1 contradicts an approved user decision and causes real wrong matches. M1 is a cheap,
output-identical fix to a roughly 10x read cost on every scrolled page.
