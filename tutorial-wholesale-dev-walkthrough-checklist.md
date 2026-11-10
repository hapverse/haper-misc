# Dev walkthrough checklist: wholesale tutorial

**Status: NOT RUN YET on dev.** Nobody has followed this script on dev. Fill it in as you go. (The API steps were already checked on a local sandbox on 2026-11-10: 71 of 73 checks passed. See "Try it first on your own computer" below.)
**DEV ONLY. Do NOT touch production** (no prod admin, no prod app build, no prod database). Admin: `damin.haper.in`. API: `dapi.haper.in`.
Purpose: follow `tutorial-wholesale-how-to-use.md` top to bottom on dev, tick each step, take a screenshot, and write down every label or behaviour that differs.

**How to fill a row:** ✅ = matches "Expected". ❌ = differs: write what you saw in Notes and add a row to "Corrections found".
**Screenshots:** save in `haper-misc/tutorial-wholesale-screenshots/` with the name in the last column (e.g. `A03-product-form-wholesale-tick.png`). Crop out any real phone number or real GSTIN.

## Try it first on your own computer (no real data)

A local sandbox runs the real user and admin servers on your Mac. It uses a throwaway in-memory database that vanishes when you stop it. It needs no `.env` and cannot reach any real service (SMS, email, push, payments, storage). Full details: `haper-backend/scripts/local-sandbox/README.md`.

From `haper-backend/`:

```sh
# 1. Start the sandbox (user API :4100, admin API :4200). Stop with Ctrl+C or type "stop".
PATH=/usr/local/bin:$PATH NODE_ENV=test /usr/local/bin/node scripts/local-sandbox/start.js

# 2. Or run the scripted API walkthrough (boots its own sandbox, prints PASS/FAIL, shuts down)
PATH=/usr/local/bin:$PATH NODE_ENV=test /usr/local/bin/node scripts/local-sandbox/walkthrough-api.js

# 3. Admin panel pointing at the sandbox
cd ../haper-admin && VITE_API_URL=http://127.0.0.1:4200 npm run dev

# 4. Web pointing at the sandbox (port 5174 if the admin uses 5173)
cd ../haper-web && VITE_API_BASE_URL=http://127.0.0.1:4100 VITE_DEFAULT_LATITUDE=25.7790 VITE_DEFAULT_LONGITUDE=84.7477 npx vite --port 5174
```

Fake logins (sandbox only):

| Who | Login |
|---|---|
| Super admin | `sandbox.super@example.com` / `Sandbox@12345` |
| Store admin ("Sample Store") | `sandbox.store@example.com` / `Sandbox@12345` |

Customer phone `9000000001`; retailer applicant phone `9000000002`. Login codes (OTP) are printed in the sandbox console.

**The sandbox does NOT cover** (these still need the dev walkthrough below):
- Document upload (the file is checked, but the link is fake).
- Real login codes (they are printed in the console).
- Payments (online payment cannot finish).
- The Size groups "Add wholesale pack" screen (the sandbox makes packs through the API).
- The picker, delivery and mobile apps.
- Discontinue, reject and suspend.
- The delivered-order lock and the B2B invoice download.

## 0. Pre-flight

| # | Check | Expected | ✅/❌ | Notes |
|---|---|---|---|---|
| P1 | Builds on dev | Backend `dev` with commit `0fa151f` (Business mode + tiers) or later; admin `6ff37aa` or later; Android `36cf50a` or later; picker `52e9a79` or later. Ask the developer which build each dev server runs | | |
| P2 | Runbook done on dev | Indexes built (step 6); document bucket rules (steps 1-4) | | |
| P3 | Store setup | "Sample Store Test" on dev: valid GSTIN, batch tracking ON, wholesale OFF at start | | |
| P4 | Server switch | `RETAILER_APPLICATIONS_ENABLED` OFF at start (you switch it in R0) | | |
| P5 | Accounts | Super admin; store admin of the test store; a manager without "Approve / reject"; a fresh customer phone that never applied (the applicant); a normal customer; a picker; a rider | | |
| P6 | Devices | Android phone with the dev customer app; picker device with the new picker build; rider app | | |
| P7 | Test GSTIN | Use `10ABCDE1234F1ZF` (a made-up, valid example). Do not make up your own GSTIN: the last character is a check digit and the server refuses invalid ones. Try `10ABCDE1234F1Z0` (wrong last character) once in R2 to confirm the error | | |

## 1. Store and permissions (tutorial section 3 and 4)

| Step | Expected | ✅/❌ | Notes | Screenshot |
|---|---|---|---|---|
| S1 Stores > Edit Store, wholesale ticked, batch tracking OFF, Save | "Turn on batch tracking for this store before enabling wholesale." | | | `S01-store-needs-batches.png` |
| S2 Clear GSTIN, tick wholesale, Save | "Add a valid store GSTIN before enabling wholesale..." | | | `S02-store-needs-gstin.png` |
| S3 Valid GSTIN + batch ON + "Wholesale for retailers", Save Store | Saves | | | `S03-store-wholesale-on.png` |
| S4 Reopen Edit Store | GSTIN and batch tracking show "Locked while wholesale is on..." | | | `S04-store-locked.png` |
| S5 Team > Edit the manager > Permissions grid | Row "Retailers", box "Approve / reject" | | | `S05-team-retailers-perm.png` |
| S6 Manager without the box | No "Retailers" in sidebar; `/retailers` redirects | | | `S06-manager-no-retailers.png` |
| S7 Picker device | New build installed (open any pack order later to see "1 pack = 10 pcs") | | | - |

## 2. Retailer approval (tutorial section 6, 12.1, 12.2)

| Step | Expected | ✅/❌ | Notes | Screenshot |
|---|---|---|---|---|
| R0 Developer sets `RETAILER_APPLICATIONS_ENABLED=true`, restarts user API | - | | | - |
| R1 Applicant: Profile | "Become a retailer / Buy in bulk at wholesale prices" | | | `R01-profile-become-retailer.png` |
| R2 Type `10ABCDE1234F1Z0` (wrong last character) | GSTIN error "Check the last character..." | | | `R02-gstin-checksum-error.png` |
| R3 Fill with `10ABCDE1234F1ZF`, photo, pin, Submit | Status "Under review" | | | `R03-status-under-review.png` |
| R4 Admin > Retailers > Pending > open | Detail with GST check card, "Check on GST portal" | | | `R04-admin-retailer-detail.png` |
| R5 Approve without the tick | Approve disabled, tooltip "Tick the GST check first" | | | `R05-approve-disabled.png` |
| R6 Reject with "Shop photo is unclear" | Status Rejected; app shows reason and "Edit and resubmit" | | | `R06-app-rejected.png` |
| R7 Resubmit with no change | "Change something first..." | | | `R07-resubmit-unchanged.png` |
| R8 New photo, resubmit; admin ticks box, Approve | Toast "Approved - <shop> can now see wholesale items" | | | `R08-approved-toast.png` |
| R9 App within ~60 s (reopen Profile) | "Retailer" chip; Home switch "Haper / Haper Business"; no push received | | | `R09-home-switch.png` |
| R10 Super admin: COD card | "Cash on delivery for wholesale orders" switch; "Credit" shows "Coming soon" | | | `R10-payment-options.png` |
| R11 Second account applies with the same GSTIN | "This GSTIN is already registered. Contact support if it's yours." | | | `R11-gstin-taken.png` |
| R12 Reject that second application with "This GSTIN belongs to another business", then it resubmits the GSTIN | Blocked. Note the exact Android text (tutorial expects the generic "Couldn't submit your application...") | | | `R12-gstin-blocked-android.png` |
| R13 Super admin: that profile > Blocked GSTINs > Unblock with reason | Number leaves the list | | | `R13-unblock-gstin.png` |

## 3. Tutorial A: new wholesale-only product (section 7)

| Step | Expected | ✅/❌ | Notes | Screenshot |
|---|---|---|---|---|
| A01 Product Master > New product | Dialog "New product", auto-add sentence | | | `A01-new-product-dialog.png` |
| A02 HSN `190`, Tab | "Use 4 to 8 digits", Save blocked | | | `A02-hsn-error.png` |
| A03 Tick "Wholesale-only item" | Helper text; "Bulk discounts" block | | | `A03-product-form-wholesale-tick.png` |
| A04 Tier errors: qty 1; percent 55; row 2 qty lower | Messages as in tutorial 7.2; "Fix the errors above to save." | | | `A04-tier-errors.png` |
| A05 Tiers 10/2, 15/5, barcode set, Save | "Product created" | | | `A05-product-created.png` |
| A06 Items (store selected) > Wholesale | Carton row at ₹0, 0 in stock (auto-added) | | | `A06-items-wholesale-zero-price.png` |
| A07 Android Business before pricing | Carton NOT shown | | | `A07-app-unpriced-hidden.png` |
| A08 Edit > Selling Price 449, MRP 449, Shelf, Save Item | Saved | | | `A08-item-edit-price.png` |
| A09 Add received inventory > Stock In 40, expiry | 40 in stock | | | `A09-stock-in.png` |
| A10 Product Master > Edit carton | Preview "10 to 14 units" ₹440.02, "15+ units" ₹426.55 | | | `A10-tier-preview.png` |
| A11 Set store cost so 5% is below cost, save tiers | "Some stores would sell below cost" + tick needed | | | `A11-below-cost.png` |
| A12 Untick Wholesale-only | "Remove the bulk discounts too?" | | | `A12-untick-dialog.png` |
| A13 Android: Haper vs Haper Business | Only in Business; "Bulk price" card | | | `A13-app-bulk-price.png` |

## 4. Tutorial B: pack from existing product (section 8)

| Step | Expected | ✅/❌ | Notes | Screenshot |
|---|---|---|---|---|
| B01 Size groups > New size group, add only the biscuit | "Add wholesale pack..." enabled | | | `B01-size-group-one-retail.png` |
| B02 Add wholesale pack, units 1 | "Units must be a whole number from 2 to 10000." | | | `B02-units-error.png` |
| B03 Units 10, barcode = single's barcode, Add, Save group | Refused: "A pack's carton barcode can't be the base item's barcode." | | | `B03-pack-barcode-refused.png` |
| B04 Barcode blank, price 95, Save group (1 retail + 1 pack) | Group saves (no "Need at least 2 sizes") | | | `B04-group-saved.png` |
| B05 Product Master > Wholesale | Pack row, no "Generate" button | | | `B05-pm-wholesale-pack.png` |
| B06 Assign > store > MRP 95, Selling 95 | "Assigned 1 · skipped 0" | | | `B06-assign-pack.png` |
| B07 Assign again with 99 | Skipped; price still 95 | | | `B07-assign-skips.png` |
| B08 Items > pack row > Add received inventory, Stock In | 409 "This is a wholesale pack: its stock come from the base item. Change the base item instead." (the server's wording has the slip "stock come") | | | `B08-pack-stock-refused.png` |
| B09 Single has 32 in stock | Pack shows 3 | | | `B09-pack-qty-derived.png` |
| B10 Android Business | "Wholesale" pill, "₹9.50 per piece"; normal customer does not see it | | | `B10-app-pack.png` |
| B11 Delete the single in Product Master | "...has wholesale packs and cannot be deleted..." | | | `B11-delete-refused.png` |

## 5. Order, picking, delivery, invoice (sections 11, 12.4, 12.5)

| Step | Expected | ✅/❌ | Notes | Screenshot |
|---|---|---|---|---|
| O1 Business cart: 12 cartons | ₹440.02 each, "2% OFF bulk", "Line total ₹5280.24", "Add 3 more for 5% off" | | | `O01-cart-tier.png` |
| O2 Haper cart | Separate; no carton | | | `O02-haper-cart.png` |
| O3 Pay with COD (switch OFF) | COD hidden, note "...Pay online." | | | `O03-cod-hidden.png` |
| O4 Business cart: 3 packs, pay online. Haper cart: 2 singles of the biscuit, pay online | Two orders; neither holds both packs and singles | | | `O04-orders.png` |
| O5 Admin Orders | "Retailer" pill with masked GSTIN | | | `O05-retailer-pill.png` |
| O6 Picker: pack line | "1 pack = 10 pcs", "Item inside: ...", "Qty: 3 packs (30 pcs)" | | | `O06-picker-pack-line.png` |
| O7 Picker: short pick 2 of 3, loose 12 | "That's enough loose pieces to make a full pack of 10..." | | | `O07-loose-pieces.png` |
| O8 Download invoice before delivery | "Invoice is only available for delivered orders" | | | `O08-invoice-not-delivered.png` |
| O9 Rider delivers; download invoice (app and admin) | TAX INVOICE, both GSTINs, HSN, CGST+SGST if the store GSTIN also starts with 10 (else IGST), ₹440.02 rate, "... Pack of 10 = 30 pcs" | | | `O09-b2b-invoice.png` |
| O10 Store admin: cancel the delivered order | "This retailer order was delivered with a GST invoice..." | | | `O10-delivered-lock.png` |
| O11 Rider app order screens | No GSTIN or shop details | | | `O11-rider-no-gstin.png` |

## 6. Quick edge cases (each under a few minutes)

| Step | Expected | ✅/❌ | Notes | Screenshot |
|---|---|---|---|---|
| E1 Suspend Ravi while in Business | Within ~60 s flips to Haper, "Haper Business isn't available right now."; checkout refused | | | `E01-suspended-fallback.png` |
| E2 Reinstate | Business cart back | | | - |
| E3 Store toggle OFF while in Business | Within ~5 s flips to Haper; Home switch hidden (tutorial says no "not available at this store" sheet) | | | `E03-store-off.png` |
| E4 Server switch OFF + restart | "Become a retailer" gone; record what an approved retailer in Business sees | | | `E04-apps-switch-off.png` |
| E5 Pack past 6 in Business; retail item past 6 | Pack goes to stock; retail stops at 6 | | | `E05-cap.png` |
| E6 Discontinue carton in Product Master | Record if the carton still sells in the store (tutorial says yes) | | | `E06-discontinued-carton.png` |
| E7 Set carton Selling Price 0 | Hidden in Business; add refused | | | `E07-zero-price.png` |
| E8 Two "Place order" taps (two phones) | One order; "Your order is already being placed..." | | | `E08-double-submit.png` |

## Corrections found

| Tutorial section | What was wrong | Fix |
|---|---|---|
| | | |
| | | |
| | | |

When done: hand this file and the screenshots folder to the docs owner to update the tutorial and remove its "not done yet" note.
