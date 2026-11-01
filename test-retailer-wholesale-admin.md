# Test guide - Retailers page (haper-admin)

Covers the admin "Retailers" screen (list, detail/verification, payment options).
Design: `design-retailer-wholesale.md` sections 7, 8, 9. Not covered here: store "Wholesale enabled" toggle, Size-groups packs, HSN, Users-list badge, order badges, credit ledger (backend/UI not ready).

**Needs backend deployed first:** `/admin/retailer/*` routes (list, detail, approve, reject, suspend, reinstate, settings) and the `retailers.verify` permission. Without them the page shows "Couldn't load retailers" (that itself is a valid check).
Use fictional test shops only (e.g. "Sample Kirana", GSTIN 10ABCDE1234F1Z5). Apply from the customer app/web first to create PENDING rows.

## 1. Menu and access
- ✅ Super admin: sidebar People section shows "Retailers"; searching "wholesale", "gst" or "b2b" in the top search finds it.
- ✅ Store admin: "Retailers" visible; no Store filter, no Store column; list only shows their own store.
- ✅ Manager/Support WITHOUT the grant: entry hidden; typing `/retailers` redirects to the dashboard.
- ✅ Team page -> manager/support permission grid has a "Retailers - Approve / reject" box; ticking it makes the entry appear after re-login.
- ✅ Warehouse roles without the grant: entry hidden.
- ❌ If an account somehow reaches the page and the API answers 403: "You do not have access to Retailers" card with a back button (no empty list).

## 2. List
- ✅ Opens on Pending tab with count badges on every tab (counts follow the store scope).
- ✅ Pending is oldest first and has a "Waiting" column ("Today", "1 day", "3 days"); 2+ days is amber with a clock icon. Other tabs: newest first, no Waiting column.
- ✅ Search by shop name, owner, phone, GSTIN (lower case and with spaces both match). Typing waits ~300 ms; clearing restores the list.
- ✅ No match: `No retailers match "xyz"` + Clear filters.
- ✅ Empty tabs: Pending "No applications waiting"; All "No retailers yet..."; others "No approved retailers".
- ✅ Loading shows 6 skeleton rows; API failure shows "Couldn't load retailers" + Retry (never the empty text).
- ✅ Narrow window (< 900 px): Phone/GSTIN/Store fold under the shop name.
- ✅ Row opens detail with click or Enter/Space; Tab shows a focus ring.
- ✅ Paging: 20 per page; approving the last row on page 2 jumps back to a valid page.

## 3. Detail (open a PENDING row)
- ✅ Header: shop name, status pill, "Applied <date> · Store: <name>". Close with ✕ or Esc.
- ✅ Application card: shop, legal name, owner, business type, phone, account created, address, "Open in Maps", PIN, serving store.
- ✅ GST check: Copy copies the GSTIN; "Check on GST portal" opens a new tab. Auto checks listed under "these do not verify the business".
- ✅ Same GSTIN on another application: red row "Same GSTIN as <shop>, <status>"; clicking the name opens that application (with a half-typed reject note, it asks "Discard this reason?" first).
- ✅ Keyboard: focus lands inside the dialog on open; screen readers announce the whole modal (header and ✕ included) as a dialog.
- ✅ Store admin: only own-store matches listed; other stores appear as a count line.
- ✅ Photo: click enlarges (lightbox), click again zooms, Esc closes and returns focus to the thumbnail. PDF certificate shows "Open GST certificate (PDF)" in a new tab. Missing file shows "No photo" / "No GST certificate".
- ✅ After ~5 minutes the images show "Link expired" + Reload; Reload fetches fresh links.
- ✅ History is newest first; a resubmission shows as "Resubmitted" under the earlier rejection reason.

## 4. Approve
- ✅ Approve is disabled (tooltip "Tick the GST check first") until the checkbox is ticked.
- ✅ Approve -> button shows "Approving...", toast "Approved - <shop> can now see wholesale items", row leaves Pending, history gains "Approved · GST portal checked".
- ❌ Two admins open the same application; first approves; second clicks Approve -> amber banner "This application was updated by someone else. Reload to see the latest." + Reload; all actions disabled until Reload.
- ❌ Tick GST box for GSTIN A; customer withdraws and resubmits with GSTIN B; click Approve (409) -> Reload -> the GST box is unticked again and Approve is disabled until re-ticked.
- ❌ If Reload itself fails, a red "Couldn't refresh this application" line with Retry shows and all actions stay disabled.
- ❌ Network off, click Approve -> red banner with Retry; the tick stays; Retry works once back online.

## 5. Reject
- ✅ Reject opens an inline panel (not a second modal); "Reject application" disabled until a reason is chosen.
- ✅ Reason "Other" makes the note required; other reasons keep it optional. Live line shows exactly what the customer will see. Note max 300.
- ✅ Confirm -> toast, status Rejected, footer says "Read only. The customer can resubmit."
- ✅ Typed a note then Esc/✕ -> "Discard this reason?" confirm; Keep editing returns. Nothing typed -> closes at once.
- ❌ Stale/403/network errors behave as in section 4; the typed note stays.

## 6. Suspend / Reinstate (super admin)
- ✅ APPROVED: Suspend opens the red confirm; confirm stays disabled until a reason is typed AND "I understand wholesale access stops immediately" is ticked.
- ✅ Suspend reason field is labelled "Reason (shown to the customer)" with a helper line: the customer sees it on their status page, so no internal notes.
- ✅ After suspend -> status Suspended, toast. SUSPENDED shows Reinstate (simple confirm, optional reason) -> back to Approved.
- ✅ Store admin / manager: Suspend/Reinstate are disabled with tooltip "Only a super admin can suspend/reinstate".
- ❌ Reinstate when the GSTIN is now used by another live application -> server message shown inside the dialog (Retry stays available).

- ✅ Reject reason "This GSTIN belongs to another business" (`GSTIN_NOT_OWNED`): selecting it shows the admin-only line "Use when the applicant does not own this GSTIN; they will be blocked from re-applying with it."; preview shows the customer label; no note needed; History row shows the same label.
- ✅ After rejecting with it, the same user resubmitting that GSTIN gets 409 `GSTIN_BLOCKED` from the backend (needs backend with the new code deployed).
- ✅ Other reasons unchanged: no hint line; note required only for Other.

## 7. Payment options (Approved and Suspended only)
- ✅ Pending/Rejected: card not shown.
- ✅ Super admin: COD switch toggles; "Save payment options" is disabled until changed; save -> toast "Payment options saved"; reopening shows the saved value.
- ✅ Credit switch is always disabled with "Coming soon". Network tab: only `{ rev, codEnabled }` is ever sent (never `creditEnabled`).
- ✅ Store admin / manager: switch is disabled but shows the real value, lock icon, "Only a super admin can change this."; no Save button.
- ❌ Stale save -> same Reload banner as section 4.
- ✅ Copy under the card: changes apply on the retailer's next checkout; placed orders unchanged.

## 8. Edge cases
- Dark and light themes both readable (pills, banners, amber waiting text).
- Keyboard only: tabs, search, row, modal controls, lightbox and confirm dialogs all reachable; Esc closes only the top-most layer.
- Backend may omit `sameGstin`/`sameGstinOtherStores`/`samePanCount`: the GST card simply shows fewer rows.
- Deleted/other-store application opened by id -> "This application isn't available".

## Needs
- Backend with `/admin/retailer` deployed (dev).
- Admin build deployed (user-manual); no new env vars.
- Automated: `npx vitest run src/pages/Retailers src/api/retailers.test.ts src/utils/permissions.retailers.test.ts src/hooks/useMenu.retailers.test.ts`.

## 9. Blocked GSTINs (retailer detail)
- ✅ No blocked GSTINs (or older backend sending plain strings): section not shown.
- ✅ Super admin: masked numbers listed (e.g. `***********F1ZF`), each with "Unblock". Dialog: explanatory copy, required Reason (max 500, counter), acknowledge tick; confirm stays off until both. Success -> toast, number leaves the list, rev bumps.
- ✅ Store admin / manager: masked list read-only, "Only a super admin can unblock.", no button.
- ✅ Network tab: POST `/admin/retailer/:id/unblock-gstin` body `{ rev, gstin, reason }`; the full GSTIN appears only in that body, never in URL, page text, titles or aria-labels.
- ❌ Stale (409 STALE) -> Reload banner, actions locked. ❌ 409 GSTIN_NOT_BLOCKED -> toast "That GSTIN is no longer blocked." and list refreshes.
- Needs backend `unblock-gstin` deployed (dev). Automated: `npx vitest run src/pages/Retailers`.

## 10. Bulk discounts (Products > edit or new product)
Plan: plan-b2b-business-mode.md (T1-T3). Super admin only (product master API).
- ✅ Product with "Wholesale-only item" unticked: no Bulk discounts block. Tick it -> block appears with "No bulk discounts yet..." and "+ Add tier". A pack master shows the block without ticking.
- ✅ Add rows ("From [qty] units -> [x] % off"); counter "n of 5 tiers"; "+ Add tier" disabled at 5. Remove a row with the x button (no confirm).
- ❌ Errors show under the row and Save is disabled with "Fix the errors above to save.": qty blank/1/100001/2.5 -> "Whole number from 2 to 100000"; % 0 or above 50 -> "Use a percent above 0 up to 50"; 3 decimals -> "Use at most 2 decimals"; qty not above the row above; same qty twice -> "Two tiers can't start at the same quantity"; % not above the row above.
- ✅ Saved product with clean tiers: preview table appears (about half a second after typing) with a store select; bands "1 to 9 units", "10 to 14 units", "15+ units"; switch store -> prices change. Network: POST `/admin/product/:id/wholesale-tiers/preview` body `{ wholesaleTiers: [{ minQty, percent }] }`. Preview failure -> "Couldn't load the preview. Retry".
- ✅ New (unsaved) product: tiers can be typed and saved; preview says it is available once the product is saved.
- ✅ Save with tiers: PATCH body has `wholesaleTiers` (numbers). Reopen the product: rows are prefilled.
- ❌ Tiers that price a store below its cost: warning "Some stores would sell below cost" with a Store / Tier / Tier price / Cost / Short by table (5 rows, then "and N more"), checkbox "I understand these tiers sell below cost in the stores above". Save disabled ("Tick the box above to save.") until ticked; then body has `acknowledgeBelowCost: true`. Editing any tier clears the tick. A server 409 `TIERS_BELOW_COST` (cost changed after the preview) shows the same warning with the server's rows.
- ❌ Server 400 `TIERS_INVALID` / `TIERS_NEED_WHOLESALE` -> message shown in the block, rows kept.
- ✅ Untick "Wholesale-only item" on a product that has tiers: dialog "Remove the bulk discounts too?" with "Keep wholesale-only" (default focus) / "Remove discounts". Keep -> still ticked, rows intact. Remove -> unticked, block hidden; Save sends `wholesaleOnly: false` and `wholesaleTiers: []`; reopen the product: no tiers. No dialog when there are no tiers.
- ✅ Product that never had tiers: Save body has no `wholesaleTiers` key (unchanged from before).
- Dark and light themes readable; keyboard order qty -> % -> remove per row, then Add tier, preview store select, tick, Save.
- Needs backend `wholesaleTiers` + `/wholesale-tiers/preview` on dev. Automated: `npx vitest run src/pages/Products`.
