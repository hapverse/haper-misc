# Review 3 - removal of legacy empty-taxonomy fallback (mayank)

Verdict: APPROVE (0 Critical, 0 High, 1 Medium, 2 Low)

## Verified
1. Constants gone: grep for LEGACY_TAXONOMY / EFFECTIVE_TAXONOMY across packages/ and scripts/ (*.js) = 0 hits. `node --check` OK on taxonomy.utils + category, sub-category, category-search, item repositories. Direct `require("./utils")` failed only on razorpay `key_id` (env, unrelated, pre-existing); no undefined-constant error. item.repository.js has no leftover (only categoryMembershipOr / buyableMembershipFilter callers, lines 624-627).
2. Remaining predicates: diff shows only the $or/legacy branch, the EFFECTIVE_TAXONOMY_STAGE and the now-unused `category/subCategory` projection removed. buyableItemFilter (status ACTIVE, quantity>0, PRICED_FILTER, storeId) untouched. category.repository `tagged` pass still has no quantity filter and getAll's count pipeline is unchanged except the stage removal, so the known out-of-stock category-tile bug is neither fixed nor worsened.
3. Index: idx_items_store_status_taxonomy = {storeId, status, taxonomy.categoryId, taxonomy.subCategoryId, quantity, sellingPrice} (items.schema.js:179). Equality on storeId/status, then `taxonomy.categoryId $in` / `$elemMatch{categoryId,subCategoryId}` / `taxonomy.subCategoryId` follow key order. The elemMatch on the same array keeps compound bounds on both pair fields. Removing the `$or` with a `taxonomy.0 $exists:false` branch actually helps: that branch could not use the index bounds. sub-category-only lookup (`taxonomy.subCategoryId` without category) skips categoryId in the prefix - same as before.
4. Tests: multi-category-items.test.js 18/18 pass (ran that file only). Section C was flipped to assert exclusion (tiles, sub tiles, aisle, raw-doc-without-taxonomy), plus a new unit check that membership filters contain no taxonomy.0/category._id/subCategory._id. Positive coverage of tagged items stays in sections A/B. Honest flip, not weakening. test-category-search.md updated (line 77).

## Item-creation sites checked (invariant: ACTIVE item => non-empty taxonomy)
- item.repository.add (:650) and addOrUpdate (:1167): wrapped in withTaxonomy; admin validator requires categoryId. OK.
- item.repository clone-store insertMany (:1636): withTaxonomy over remapped pairs. OK (pairs with no counterpart category are dropped -> could yield empty, see Low-1).
- product.repository.assignToStores (:144) = the auto-provision path (product create/barcode/assign, "ALL" stores): item takes taxonomy from the MASTER via projectionFieldsFromProduct (withTaxonomy). Product-master create validator makes category/taxonomy OPTIONAL (product/validator.js:44,50; only name+unit required), so a master with no category fans out ACTIVE qty-0 items with empty taxonomy. See Medium-1.
- product.repository.syncToItems (:560-568): master edit $sets taxonomy from the master onto every store item; an uncategorised master overwrites item taxonomy with []. Pre-existing; same effect pre/post this change (category is nulled too, so the legacy fallback never saved these).
- items/controller.js:505 ensure-master (masterFieldsFromItem -> withTaxonomy), cron product-master-reconcile (ProductModel only, no item writes), POS / transfer / replenishment / warehouse / picker controllers (read, quantity only; no item creates), scripts/migrations (quantity/cost/barcode/shelf; migrate-categories-global remaps ids only). No other creator found.

## Findings
MEDIUM-1 packages/admin/src/routes/product/validator.js:44,50 + packages/shared/repositories/product.repository.js:144. An uncategorised product master auto-provisions ACTIVE store items with taxonomy []; once stocked they are invisible in tiles/aisle/search. Important nuance: they were ALSO invisible before this change (the legacy branch keyed on category._id, which is null too), so this change does not regress them; the legacy fallback only rescued "category set but taxonomy empty", which the normaliser (withTaxonomy / taxonomyUpdatePatch) cannot produce. The stated invariant is therefore only true for the item routes, not for master-driven provisioning. Fix (separate ticket, not a blocker): require category/taxonomy on product create when autoProvision is on (or skip assignToStores when the master has empty taxonomy), and add a periodic integrity query `items: {status: ACTIVE, "taxonomy.0": {$exists:false}}` to inventory-integrity-report.js so a regression is noticed.

LOW-1 packages/shared/repositories/item.repository.js:1625-1640 (clone store): if every pair is dropped by the normaliser the copy gets taxonomy [] with ACTIVE status. Same as before the change and rare; mention only.

LOW-2 packages/shared/utils/taxonomy.utils.js (categoryMembershipOr doc comment) says "edits reject an empty taxonomy" - true for items routes, not for product master (see Medium-1). Soften the comment. Also deployment note: dev 0/3,683 and prod dump 0 empty-taxonomy were stated by caller, not re-verified by me (no DB access used).

STATUS: done
OUTPUT: APPROVE - 0 critical, 0 high, 1 medium (uncategorised master provisioning, not a regression), 2 low
NEXT: kiran-git - commit/push per direct-to-dev workflow after user approval (backend + haper-misc test-category-search.md); optionally rahul to ticket Medium-1
