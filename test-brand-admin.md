# Brands admin page (Shop by Brand, Phase 2) - test guide (backend + admin web)

Scope: dev only. Super admin page Catalog -> Brands, plus how its changes show in the Haper Business app. No app release: the Android contract is unchanged. Specs: `plan-brand-admin.md` (Owner decisions), `design-brand-admin.md`. Phase 1 guide: `test-brand-shop-business.md`.

Plain example: a super admin opens "Cadbury", merges the typo "Cadbbury" into it, saves. Test Kirana opens Haper Business and sees ONE "Cadbury" tile with the combined item count. Nothing on any product was edited.

Steps marked **[APP]** need the Android build with Shop by Brand and `BRAND_SHOP_ENABLED=true` on dev. The app keeps the brand list for 5 minutes: pull-to-refresh or reopen the app to see a change at once; otherwise wait up to 5 minutes.

## Setup (dev only)
- Owner deploys the backend to dev FIRST, then the admin web. The backend builds the `brands` collection and its two indexes at admin boot. Empty collection = exactly Phase 1.
- Owner sets `BRAND_SHOP_ENABLED=true` on dev (agents do not touch env/AWS). Flag off: the admin page still works and shows "Shop by brand is off in the app right now...".
- Logins: a SUPER ADMIN, and a STORE ADMIN (store owner).
- Store with wholesale ON, APPROVED retailer "Test Kirana" on the Android build.
- Test data (Product Master + wholesale items in stock at that store). Use dev-only throwaway names if the real ones are not present:
  - "Cadbury" (several products) and the typo "Cadbbury" (1-3 products, with wholesale items).
  - "pg" (lowercase, 1-2 products) and, if present, "P&G".
  - A look-alike pair, e.g. "Haldiram" / "Haldiram's", and a catch-all "Generic".
  - A brand with a name containing `&` or `'` (e.g. "P&G", "Ching's Secret").
  - One extra brand (e.g. "Coco Cola") you can hide, and one you can give a logo.
- Test images: a transparent PNG logo (wider than 200 px, a wordmark with transparent background), a small PNG under 200 px, a non-image file renamed `.png`, a file over 5 MB.
- Take note of each brand's product count and app tile count before starting.

## A. Access (super admin only)
- [ ] Super admin: sidebar Catalog shows **Brands** right after Product Master. Top-bar search "brand", "logo" or "merge" lands on Brands first.
- [ ] Store admin: NO Brands menu item, and top-bar search for "brand" does not offer it.
- [ ] Store admin types `/brands` in the address bar: redirected away (same as `/products`), page never renders.
- [ ] Manager / support roles (if available): same as store admin.
- [ ] **[API]** Store admin JWT on `GET /admin/brand` and `PUT /admin/brand/<key>`: HTTP 403. No brand data returned.
- [ ] Logged out: `/brands` goes to login.

## B. List page
- [ ] Page loads: skeleton rows first, then the table. Footer reads "N brands - M with a logo" and the pager works (50 per page).
- [ ] Each row: tile (letter badge like the app, e.g. "Cadbury" -> "Ca"), name, key in mono text under it, spellings, Products, Wholesale at the chosen store, Visibility, Last edited.
- [ ] Search "cadb" finds Cadbury; search by key, by a raw spelling and by a merged spelling also finds it (case-insensitive). No match shows `No brands match "xyz"` with Clear filters.
- [ ] Filters work and combine: Visibility (All / In the app at this store / Not in the app / Hidden by admin / Catch-all names), Logo (Has / No logo), Spellings (Has merged spellings / Possible duplicates). Any filter change returns to page 1. **Clear filters** appears only when something differs from the default.
- [ ] Sort: Most products, Most wholesale at this store, Name A-Z, Recently edited. Ties are A-Z.
- [ ] Store picker: changing the store changes only the Wholesale column (and "In the app at this store"). Row shows "Updating..." while refetching.
- [ ] System-hidden rows (Generic, Genric, NA, Local, ...) are listed with a **Catch-all** pill. Opening one: drawer is read-only with the banner "Catch-all names like Generic are always hidden from Shop by brand...", name/logo/picker/switch disabled, footer has only **Close**.
- [ ] A merged-away spelling (e.g. "Cadbbury" after step D) is read-only "Merged into Cadbury" and is not its own editable row.
- [ ] Row opens with click and with Enter/Space. URL becomes `/brands?brand=<key>`; refresh reopens the same drawer; an unknown key shows "That brand no longer exists." and no drawer.
- [ ] Keys with `&` or `'` ("p&g", "ching's secret") open and save correctly (key is URL-encoded).
- [ ] Narrow window (< 900 px): Spellings and Last edited columns hide; sub-line under the key shows the info instead.
- [ ] Network off, reload: "Couldn't load brands" with working **Retry**.

## C. Edit display name ("pg" -> "P&G")
- [ ] Open "pg". Display name field is blank with placeholder = automatic name; helper says it uses the most common spelling. App preview tile in the drawer shows the current name.
- [ ] Type "P&G". Preview updates live (badge colour may change, expected). **Save changes** was disabled and now enables.
- [ ] Save: toast "P&G saved. Buyers see it within 5 minutes.", drawer closes, row shows "P&G" with an "auto: pg" hint, Last edited shows today.
- [ ] **[APP]** Within 5 minutes (or after pull-to-refresh): Business strip / All brands / search chip show "P&G"; the brand page title is "P&G" and still lists the right items.
- [ ] Clear the field and save: back to the automatic name; app returns to the automatic name.
- [ ] Name with no letter or digit ("---"): inline "Use at least one letter or number." and nothing saved.
- [ ] Name equal to another visible brand's name: amber warning with **Find it**; it does NOT block Save.
- [ ] Unicode name ("Haldirām", Hindi name) and a name at the max length saves and shows; over the limit is stopped by the field.

## D. Merge "Cadbbury" into "Cadbury" (look-alike path)
- [ ] Filter Spellings = Possible duplicates: Cadbury shows "N look-alikes".
- [ ] Open Cadbury. "Possible duplicates" lists Cadbbury with product count, reason chip ("1 letter different") and up to 3 sample product names (the alphabetically first ones; the same 3 show again after you save the row).
- [ ] Click **Merge in**: Cadbbury moves under "Merged into this brand" with a **New** pill (still a draft; app unchanged).
- [ ] **Save changes**: preview dialog "Merge 1 spelling into Cadbury?" with a table: Cadbury (stays) + Cadbbury = combined Products and Wholesale counts, plus bullets ("Products are not edited", "You can unmerge any time").
- [ ] **Cancel** in the dialog: back to the drawer, draft intact, nothing saved.
- [ ] Save again, **Merge and save**: toast "Cadbury saved. Buyers see it within 5 minutes.", the Cadbbury row disappears from the list, Cadbury's products count is the sum and a "+1 merged" pill shows.
- [ ] Product Master: the "Cadbbury" products still say "Cadbbury" (merge never renames products).
- [ ] **[APP]** Strip / All brands show ONE Cadbury tile; its item count is the combined count (a size group split across both spellings counts once). No Cadbbury tile.
- [ ] **[APP]** Business search "cadbbury" (3+ chars): chip "Cadbury" appears; tap opens the Cadbury page showing items of BOTH spellings. Search "cadb": Cadbury chip too.
- [ ] **[APP]** An old link or cached tile for key `cadbbury` (e.g. a brand page opened before the merge, or `GET /user/brand/items?key=cadbbury`) opens Cadbury, with `brand.key` = `cadbury`.
- [ ] Product search and category listings are unchanged (Cadbbury items still found by their own names).

## E. Merge picked by hand, and the bigger-brand switch
- [ ] In Cadbury's drawer, use "Merge another brand": type a name, pick one. Options that cannot be merged are greyed with a reason: catch-all ("Catch-all name - can't be merged"), "Merged into X - unmerge it there first", "Has its own merged spellings - unmerge those first". This brand itself is not listed.
- [ ] A hand-picked merge is marked "Picked by hand". On Save the preview dialog is a warning and **Merge and save** stays disabled until the checkbox "I checked these are the same brand, not two different brands." is ticked.
- [ ] Same checkbox is required for a look-alike with 10+ products (a small look-alike with under 10 products needs no checkbox).
- [ ] Bigger-brand switch: open the typo "Cadbbury" (before merging). The suggestion "Cadbury" says "Bigger than this brand" and the button reads **Merge into Cadbury**. Click: drawer switches to Cadbury with Cadbbury staged as New (if the draft was dirty it first asks "Discard changes?"). Save and confirm as in D.
- [ ] Picker with 20 merged spellings: input disabled with "A brand can have up to 20 merged spellings." (only if easy to set up; otherwise API-test).
- [ ] Merging a catch-all by API (`aliases:["generic"]`) -> 400 (reason `ALIAS_HIDDEN`); the UI never offers it.
- [ ] Merging a brand with its own logo/name/hidden flag: the dialog adds "Cadbbury's own logo and name are not used while it is merged." (and "...is hidden now. Its items will show under Cadbury." if hidden).

## F. Unmerge
- [ ] Open Cadbury, "Merged into this brand", click **Unmerge** on cadbbury: row gets "Will unmerge", the name is struck through, action becomes **Undo**. Undo restores it; Unmerge again.
- [ ] Save (no preview dialog for unmerge): toast, "Cadbbury" is a normal row again in the list.
- [ ] **[APP]** After refresh: Cadbbury is back as its own tile; Cadbury count drops back. Chip search "cadbbury" now opens the Cadbbury tile, not Cadbury.

## G. Hide a brand
- [ ] Open "Coco Cola", flip **Hide from Shop by brand**, Save. Row shows a **Hidden** pill; filter Visibility = Hidden by admin lists it.
- [ ] **[APP]** Gone from the strip, All brands and brand search chips. A brand page already open shows "Coco Cola isn't available here" on its next load.
- [ ] **[APP]** Its items are still in categories and in normal item search (hiding never removes items).
- [ ] Hidden at every store (global), not only the picked store.
- [ ] Switch off and save: brand returns in the app within 5 minutes.
- [ ] A hidden brand used as an alias: dialog notes it is hidden and its items show under the target.

## H. Logo upload and removal
- [ ] Open a brand, **Upload logo**, pick the transparent PNG: preview tile shows the logo on a WHITE square, fitted with padding, not cropped. Button now reads **Replace logo**; **Remove logo** appears.
- [ ] Wrong file type ("Use a PNG or JPG file."), over 5 MB ("This file is x MB. Use one under 5 MB."), and the renamed non-image file are rejected with no change. A small image (< 200 px) shows an amber "may look blurry" warning but can still be saved.
- [ ] Save: toast. Reopen the row: the logo persists (tile in list shows it).
- [ ] **[APP]** Tile shows the logo on a WHITE background (never black) on the strip, All brands, brand page header and search chip. If it ever shows black, STOP and report: the white-flatten step failed.
- [ ] Replace with another logo: the app shows the new one after refresh (new URL per upload, no stale image).
- [ ] **Remove logo**: preview goes back to the letter badge; Save. **[APP]** letter badge is back. Row `No logo` filter lists it again.
- [ ] Remove logo then Cancel/close discards the staged removal (draft only).
- [ ] Failed save (go offline, Save): strip "Couldn't save. Your changes are still here." and **Retry save** works when back online. No half-saved state.

## I. Reset to automatic
- [ ] On an edited brand (name, logo, merged spelling), use the reset action (reset to automatic).
- [ ] The row returns to the automatic name, letter badge, merged spellings freed (they are their own rows again), Last edited shows "-".
- [ ] **[APP]** App is back to the Phase 1 look for that brand.
- [ ] Reset on a brand with no overlay: nothing to reset / no error crash.

## J. Concurrency and conflicts
- [ ] **Two tabs, same brand.** Tab 1 and Tab 2 both open Cadbury. Tab 1 changes the name and saves. Tab 2 changes something else and saves: banner "Someone else changed Cadbury while you were editing. Reload to see their changes. Your edits here will be lost.", Save is disabled until **Reload**. Reload shows Tab 1's changes.
- [ ] Two admins create the first overlay for the same brand at the same moment: one wins, the other gets the same stale message (never two rows).
- [ ] **Alias already taken.** Admin A merges "Cadbbury" into Cadbury. Admin B (opened before) tries to merge the same Cadbbury into "Cadbury Dairy Milk": error names the owner ("Cadbbury was just merged into Cadbury"); the staged row is marked with the error and its action becomes **Remove**. Save re-enables after removing it.
- [ ] Alias that has its own overlay row (e.g. "Coco Cola" renamed/logo'd): error asks to reset it first, then merge.
- [ ] Opening a key that is already an alias via API: 409 (`KEY_IS_ALIAS`) naming the target brand.
- [ ] Brand gone: if the last products of a brand are renamed in Product Master while the drawer is open, save shows "This brand no longer has any products..." with **Close**.
- [ ] Store admin session expired / role changed while the drawer is open: save shows "Only a super admin can change brands. Your changes were not saved."
- [ ] Drawer: Esc, X or click outside with edits asks "Discard changes to X?" (**Discard** / **Keep editing**). Clean close needs no prompt. While saving, Esc/X/Cancel are disabled.

## K. Audit log
- [ ] Audit Log page: each save adds ONE row "Brand updated" (name, merge, logo, hide); filter "Brand updated" works. Unmerge/logo-remove/reset also appear (labels may read as "Brand updated" or their own label).
- [ ] Row shows the brand key as target, the admin who did it, and before/after (display name, aliases, logo URL, hidden).
- [ ] A rejected save (409/400) writes NO audit row.

## L. Edge cases
- [ ] Brand with `&`, `'` ("P&G", "Ching's Secret"): edit, merge into and logo upload all work; keys with `/` do not exist.
- [ ] Merged brand whose store has only the alias spelling: tile shows the display name (a display name is required once any spelling is merged; Save without it shows an error).
- [ ] 21st merged spelling: rejected (limit 20).
- [ ] Merge a spelling with 0 products / dead alias: allowed; shows "0 products" and does nothing harm.
- [ ] Brand with items in size groups and singles: combined count = groups + singles, split groups counted once.
- [ ] Merge chain attempt (merge A into B, then B into C): blocked (an alias cannot have its own merges).
- [ ] Rename a merged brand's products in Product Master later: the overlay row still applies; if the key no longer exists it lists under the "Not in catalogue" state and can be reset.
- [ ] Very long display name, emoji name, leading/trailing spaces (trimmed), double spaces (collapsed).
- [ ] Phase 1 behaviours unchanged for untouched brands: auto-merge of case/space ("Amul", "AMUL "), Generic hidden, letter badges, search chips.

## M. Server / leak checks (curl on dev, use your own JWTs, never paste tokens in notes)
- [ ] **[API]** `GET /admin/brand` as super admin returns rows with `rev` (0 when no overlay), `aliasOf`, `systemHidden`, `samples`, `lookAlikes` (max 5, no catch-alls), per-store `business` counts.
- [ ] **[API]** `PUT /admin/brand/<key>` without `rev` -> 400; with a wrong `rev` -> 409 `STALE`; `logoUrl` sent as text -> rejected (logos only come from the upload); unknown field -> rejected.
- [ ] **[API]** `GET /user/brand` as a retailer: still `{key,name,itemCount,logoUrl}` only (no `spellings`, `aliasKeys`, `matchKeys`). Normal customers and Haper mode still get empty brands.
- [ ] Old app builds (no brand code) still work as before.

## N. Category icons (transparent PNG) - short section
Full steps are in `test-category-icon-transparency.md`; do these on the same deploy.
- [ ] Admin -> Categories: re-upload a category icon as a TRANSPARENT PNG.
- [ ] **[APP]** The icon shows transparent on the coloured category tile (no black or white box around it).
- [ ] Icons uploaded before the fix stay as they are until re-uploaded (expected).
- [ ] Brand logos still show on WHITE (brand logos are flattened; category icons keep transparency - different rules by design).

## O. Undo path (OWNER ONLY, never testers, never on prod without the owner's decision)
- [ ] Owner can turn the whole overlay off by dropping the `brands` collection on dev. Within about 2 minutes (server list cache) the app is back to exactly Phase 1: no merges, no logos, no renames, no hides. Products and items were never changed.
- [ ] Alternative: set `BRAND_SHOP_ENABLED` off to hide the feature entirely.
- [ ] After a drop, the admin page still loads (empty overlay, all rows automatic). Uploaded logo files stay in storage (harmless).
- Testers: do not run this. It is a database write; the owner runs it.

## Build / deploy needed
- Backend FIRST (new `/admin/brand` routes, overlay in the user brand list, search chips on merged spellings, logo flatten-to-white option). Admin boot builds the `brands` collection and its two unique indexes; if the indexes are wrong, brand writes answer 503 and buyers are unaffected.
- Admin web SECOND (Brands page + menu + route + Audit Log label). Admin web before backend = page loads errors.
- `BRAND_SHOP_ENABLED=true` on dev for the **[APP]** checks (owner sets it). No Android release.
- Automated: backend `cd packages/admin && NODE_ENV=test npx jest brand` and `cd packages/user && NODE_ENV=test npx jest brand` (in-memory Mongo); admin web `npx vitest run src/pages/Brands src/api/brands`, `tsc -b`, eslint. Admin web baseline: still exactly the 5 known OrderDetailsModal failures.
- Prod: owner's call, after dev passes. Clean spellings in Product Master first where possible: the overlay only changes what buyers see.

STATUS: done
OUTPUT: wrote /Users/office/Documents/haper/haper-misc/test-brand-admin.md (sections A-O: access, list, rename, merge, hand-picked merge, unmerge, hide, logo, reset, concurrency, audit, edge cases, API checks, category icons, owner-only undo; deploy order backend then admin)
NEXT: USER - review the guide; add an admin-client row to client-followups.md
