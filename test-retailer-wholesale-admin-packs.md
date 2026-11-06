# Test guide: retailer wholesale - admin screens (store toggle, packs, product form, items, orders)

Needs: backend on `dev` with the wholesale branch deployed (store gate, `POST /admin/product/:id/packs`, `retailerSnapshot` on orders), admin build from `dev`.
Use a fictional store ("Sample Store"), fictional GSTIN `22AAAAA0000A1Z5`, fictional product "Sample Sugar".

## 1. Store: "Wholesale for retailers" toggle (Stores > Edit)
Super admin
- [ ] Toggle sits under "Size variants"; helper says it needs batch tracking ON and a valid store GSTIN.
- [ ] Store with batch tracking OFF: tick toggle, Save -> red message "Turn on batch tracking for this store before enabling wholesale." appears under the toggle AND as a toast. The form stays open, toggle stays ticked.
- [ ] Same store, tick Batch tracking + Wholesale in the same save -> saves (batches are not locked just because you ticked wholesale).
- [ ] Store with a missing/invalid GSTIN: red message about adding a valid GSTIN.
- [ ] Store with wholesale already ON: Batch tracking checkbox is disabled and GSTIN is read-only, each with "Locked while wholesale is on."
- [ ] Untick wholesale in the form: both unlock; Save turns wholesale off.
- [ ] Add New Store: no wholesale toggle (only after the store exists).
Non-super-admin (store admin / manager)
- [ ] Toggle is visible, disabled, current value shown, text "Only a super admin can change this."
- [ ] Saving the store sends no `wholesaleEnabled` (check network tab) and still succeeds.
- [ ] Forced 403 (send as non-super-admin via API) shows "Only a super admin can turn wholesale on or off for a store."

## 2. Size groups modal (Catalog > Size groups)
Super admin
- [ ] Add 2 retail sizes of Sample Sugar. "Add wholesale pack..." button appears below the search (disabled with "Add a retail size first" when the group has no retail row; disabled at 8 sizes).
- [ ] Mini-form (labelled "Add wholesale pack"): base item select, Units per pack, optional name, optional barcode, optional pack price.
- [ ] Units 1, 10001, 2.5, blank -> "Units must be a whole number from 2 to 10000." (shown on blur / on Add). 2 and 10000 are accepted.
- [ ] Add pack of 10: a new row appears with the "Wholesale pack" tag, lock icon, "x10 of <base> (created on save)", label "Pack of 10", default radio disabled (tooltip "A wholesale pack can't be the default size"). NOTHING is created yet (network tab: no POST .../packs).
- [ ] Add the same base + 10 again -> "Pack of 10 already exists for <base>."
- [ ] Remove the staged pack with x -> it disappears; nothing was created.
- [ ] Remove the base row while a staged pack remains -> Save disabled, "Pack needs a base item in this group."
- [ ] Save group: network order is `GET /admin/product?search=<base iId>` -> `POST /admin/product/<baseId>/packs` -> `POST /admin/variant-group`. Group body contains the real pack iId, not `staged:...`.
- [ ] Give a pack price below cost: after Save a warning toast lists "Below cost in <store>..." (and/or pricier-than-singles / base stock below units). Group still saved (non-blocking).
- [ ] Force the group save to fail (e.g. duplicate group name): pack master already exists; fix the name, Save again -> pack is NOT created twice (one POST .../packs for the whole session).
- [ ] Save with a new pack whose real iId the server rejects (e.g. a live pack of that base is already in another group): the error shows on the pack's own row (or in the group error list); fix and Save again -> pack still not created twice.
- [ ] Delete the base product in another tab, then Save: banner says "Base product not found." (not "group no longer exists").
- [ ] Force pack creation to fail (discontinued base): banner shows the server message, group is NOT saved, inputs kept.
- [ ] Open an existing group that has a pack: row shows "Wholesale pack", units locked (tooltip), default radio disabled, label still editable. Making a pack the default via API returns 409 DEFAULT_NOT_RETAIL (UI never offers it).
- [ ] Pack rows do not trigger the multipack / size-name / price-outlier warnings.
Warehouse manager
- [ ] No "Add wholesale pack..." button (pack creation is super-admin only); existing packs still display.

## 3. Product master form (Products > Edit)
- [ ] New "HSN code (optional)" field. `190` + Tab -> "Use 4 to 8 digits"; Save is blocked with nothing sent. `1905` and `19059090` are accepted; blank clears HSN.
- [ ] "Wholesale-only item" checkbox on a normal master: tick + Save sends `wholesaleOnly:true`. Un-tick on a master that is a size group's default -> backend 409 shown in the error toast.
- [ ] Open a PACK master: info note "Wholesale pack of N x item <base>..."; brand, unit, weight, GST, HSN, category rows and the wholesale checkbox (ticked) are disabled; name is still editable.
- [ ] Save a pack master: request body has no brand/unit/weight/gstRate/hsn/category/taxonomy/wholesaleOnly; success toast shows. If the backend still reports `ignoredDerivedFields`, a warning toast lists them.

## 4. Item edit on a pack row (Items > Edit)
- [ ] Pack row shows the note "wholesale pack of N x item <base>... come from the base item"; Quantity, Cost price, Low stock, Max stock, Reorder qty, Brand, Weight, Unit, GST and Category rows are disabled and not sent (super admin too).
- [ ] Selling price / MRP and other fields still editable and save OK.
- [ ] Normal item: nothing changes.
- [ ] Not done here: stock-action buttons (Stock In / Adjust / Transfer) are still shown on pack rows; the API answers 409 PACK_HAS_NO_OWN_STOCK.

## 5. Orders
- [ ] Order placed by an approved retailer: Orders list shows a "Retailer" pill with masked GSTIN (`22••••••••••1Z5`) next to the order id; order detail header shows the same pill. Full GSTIN is never printed.
- [ ] Retail order: no pill.

## Not in this change
Users-list badge/filter, HSN coverage list, credit fields, ledger.

## Deploy / needs
Admin only. Backend must already have: store wholesale gate, pack endpoint, `retailerSnapshot` returned by order list/detail (already the case: lists select everything except `__v`).
