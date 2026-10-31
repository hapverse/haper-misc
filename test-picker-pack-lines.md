# Picker app — Pack lines (wholesale) test guide

Tests the picker build that understands **pack lines** (retailer/wholesale rollout, plan
`haper-backend/docs/plans/retailer-wholesale.md` §3.4.5 + §6 step 29). Android picker app,
against **dev** (`dapi.haper.in`). ✅ = must happen, ❌ = must be blocked / must not happen.

**What a pack line is, in plain words:** a shop owner (retailer) can buy a "pack", e.g.
"Sample Biscuit 50g Pack of 10". The pack has no stock of its own — it is 10 pieces of the
normal "Sample Biscuit 50g" item (the **base item**) taken off the same shelf. So an order
can contain **2 singles** of the biscuit AND **3 packs of 10** of the same biscuit. Both
lines usually carry the **same barcode** (the biscuit's), unless the pack has its own
carton barcode. Quantities on a pack line are always in **packs** (3 = three packs = 30 pcs).

> **P1 HARD GATE.** Old picker builds match the *first* line with a scanned barcode in
> scan-anything mode, so with singles + pack of the same biscuit the pack line shows
> "Already done" and can never be verified there. Install this build on **every picker
> device of a store before `wholesaleEnabled` is turned ON for that store** (dev included).

Companion guide: `test-picking.md` (all the non-pack picker flows: scan gate, scanner,
partial pick, OOS, undo, complete).

---

## 0. Prerequisites

1. **Backend on dev** with the retailer/wholesale P1 picking change deployed
   (`pick-task.utils.js` `buildLines` pack fields + `looseUnitsFound` in
   `picking/src/routes/task/{controller,validator}.js`). Quick check: a pack line in
   `GET /picking/task/:id` has `unitsPerPack`, `baseItemId`, `baseName`.
2. **Picker app debug build from this change** on a device/emulator with a camera:
   `cd haper-picker && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/`.
3. **Store with picking ON** (see `test-picking.md` §0.3), batch tracking ON, and
   wholesale ON (only after step 2 is on every picker device of that store).
4. **A pack item** for a base item that has a barcode, e.g. base "Sample Biscuit 50g"
   (barcode `8901000000017`), pack "Sample Biscuit 50g Pack of 10" with **no** carton
   barcode. Optional second pack with its **own** carton barcode (e.g. `8901000000024`).
5. **An APPROVED retailer account** that can see packs.
6. Seed orders (placed by the retailer):
   - **Order P1** — 2 × Sample Biscuit 50g (singles) **and** 3 × Pack of 10 (same base).
   - **Order P2** — 3 × Pack of 10 only (for short pick / loose pieces).
   - **Order P3** — 2 × Pack of 10 only (for out of stock).
   - **Order OLD** — any normal order whose pick task was created **before** the backend
     deploy (or any normal non-pack order) — for the regression checks.

---

## A. Pack line display

1. Claim **P1**. Before scanning, both biscuit cards are hidden ("Scan to reveal product").
   - ✅ The pack card shows a small **"1 pack = 10 pcs"** pill and the shelf; the singles
     card shows no pill. The product name stays hidden until scanned.
2. Verify the pack line (tap its "Scan to verify", scan `8901000000017`).
   - ✅ Card shows the pack name ("Sample Biscuit 50g Pack of 10"), the **"1 pack = 10 pcs"**
     pill, **"Item inside: Sample Biscuit 50g"**, and **"Qty: 3 packs (30 pcs) · 📍 shelf"**.
   - ✅ Stepper label reads **"Packs found"**, value `3 / 3`; button **"Pick 3 packs"**.
   - ❌ No "Pack of N" text is invented by the app — that wording comes from the item name.
3. A pack line whose `baseName` is missing still shows the pill + "Qty: … packs (… pcs)",
   just without the "Item inside" row.

## B. Scan-anything with singles + pack sharing a barcode (the gate case)

1. Open **P1** (fresh claim, nothing verified). Tap the scanner icon in the top bar.
2. Scan `8901000000017` once.
   - ✅ Status **"✓ Sample Biscuit 50g"** (the singles line goes first: smallest pack first,
     singles count as 1).
3. **Move the camera away** from the barcode for ~2 s, then scan it again (the scanner only
   re-reads a code after it has been out of view for 1.8 s).
   - ✅ Status **"✓ Sample Biscuit 50g Pack of 10 (= 10 pcs)"** — the **pack** line is verified.
   - ❌ Must NOT say "Already done" on the second scan while the pack line is still unverified.
3a. **Holding still is not a scan:** fresh P1, scan once, then keep the camera pointed at the
   same barcode for 5+ s without moving.
   - ✅ Only the singles line is verified; status stays "✓ Sample Biscuit 50g", one beep.
   - ❌ The pack line must NOT get verified/revealed on its own.
4. Move away, then scan it a third time.
   - ✅ **"Already done: Sample Biscuit 50g"** (success tone).
5. Tap Done. ✅ Both biscuit cards are revealed (verified) and can be picked.
6. Quick double scan: re-run on a fresh order like P1 with the network slowed (emulator
   network throttling), scan, move the camera away for just over 1.8 s, then scan again before
   the first answer arrives.
   - ✅ Second scan still verifies the **pack** (never the singles line twice).
6a. **Line already resolved elsewhere:** open P1 scan-anything on device 1; on device 2, logged
   in as the **same picker**, resolve the singles line (pick it or mark it out of stock) without device 1
   refreshing. On device 1, scan the barcode.
   - ✅ Status turns red **"Couldn't verify Sample Biscuit 50g"** + error tone (the server said
     "already resolved"); the app reloads the task in the background.
   - ✅ Move away, scan again → **"✓ Sample Biscuit 50g Pack of 10 (= 10 pcs)"** — the pack line
     is reached, not stuck on the stale singles line.
6b. Any failed verify (no network, wrong-product reply) shows red **"Couldn't verify …"** with
   the error tone instead of leaving the green "✓ …".
7. Same with the singles line already **Picked** or **Out of stock** before opening the
   scanner: ✅ the first scan verifies the pack line.
8. Pack with its **own carton barcode**: scanning `8901000000024` verifies only that pack
   line; scanning the base barcode verifies only lines that carry the base barcode.
9. Scan a code not in the order. ✅ "Not in this order" + error tone (unchanged).

## C. Full pick of a pack line

1. In **P2**, verify the pack line, leave the stepper at `3 / 3`, tap **"Pick 3 packs"**.
   - ✅ Toast "Item picked"; chip "Picked ✓". No loose-pieces field appears on a full pick.

## D. Short pick on a pack line — with and without loose pieces

Reset **P2** first (Undo, §F) or use a fresh copy.

1. Verify the pack line, tap **−** to `2 / 3`.
   - ✅ A field **"Loose pieces left on shelf (optional)"** appears with the hint
     "Count every loose piece you can see. Leave blank if none." Button: **"Pick 2 of 3 packs"**.
   - ✅ The keyboard is numeric; letters, `-`, `.` cannot be typed (max 6 digits).
2. **Without loose pieces:** leave it blank, tap **"Pick 2 of 3 packs"**.
   - ✅ Toast **"Picked 2 of 3 packs — rest adjusted"**, chip "Picked 2/3 packs ✓".
   - ✅ Request body has **no** `looseUnitsFound` → base item stock set to **0** (old behaviour).
3. **With loose pieces (valid):** fresh P2, short pick `2 / 3`, enter **7**, pick.
   - ✅ Success as above; base item "Sample Biscuit 50g" stock in admin = **7**
     (minus any still-unpicked biscuit lines in the same order — the server subtracts them).
4. **Enough for another pack:** fresh P2, short pick `2 / 3`, enter **12**, pick.
   - ✅ Toast **"That's enough loose pieces to make a full pack of 10. Pick that pack
     instead, or recount the loose pieces."**; the line stays pending, the number stays in
     the field so it can be corrected.
   - ❌ Nothing is reduced/refunded on the order.
5. Return the stepper to `3 / 3` → ✅ the loose field disappears and is not sent.
6. Rotate the device with a number typed → ✅ the number is kept.

## E. Out of stock on a pack line

1. In **P3**, tap **Out of stock** on the pack line (before or after scanning).
   - ✅ Dialog shows the usual reasons **plus** the "Loose pieces left on shelf (optional)"
     field. On a singles line the field is **not** shown.
2. Blank → Confirm. ✅ "Marked out of stock"; base stock set to 0 (old behaviour).
3. Fresh P3: enter **4** → Confirm. ✅ Base stock = 4 (minus unpicked same-base lines).
4. Fresh P3: enter **15** → Confirm. ✅ Friendly "enough loose pieces to make a full pack of
   10" toast; the line stays pending.
5. Last item OOS still auto-cancels the order (unchanged, `test-picking.md` §Q).

## F. Undo

1. Pick a pack line (full or short) → **"Undo — move back to to-do"**.
   - ✅ "Pick undone", line back to pending and hidden again ("Scan to reveal product" — the
     server clears the scan verification on undo). Same as a singles line.
   - Undo of a **short** pick behaves exactly as it does for singles today (see
     `test-picking.md` §L) — this build does not change it.
2. After undo on P1 (pack line undone, singles still verified), open scan-anything and scan
   the shared barcode.
   - ✅ The first scan verifies the **undone pack line**; the next scan says "Already done:
     Sample Biscuit 50g".

## G. Old tasks / non-pack orders — regression

1. Open **Order OLD** (no pack fields on any line).
   - ✅ Cards look exactly as before: "Qty: N", "Quantity found", "Pick N" / "Pick X of N",
     no pill, no loose-pieces field, OOS dialog without the extra field.
   - ✅ Toast "Picked X of N — rest adjusted" (no "packs").
2. Scan-anything on OLD: ✅ verify / "Already done" / "is out of stock" / "Not in this
   order" behave as before.
3. Order with two plain lines sharing a barcode (rare): ✅ first scan verifies the first
   line, the next scan verifies the second (previously the second could never be verified
   in this mode — an improvement, not a regression).
4. Per-line "Scan to verify", manual entry, "Confirm without scan (override)" — ✅ unchanged.
5. Test Barcode tool (Settings) — ✅ unchanged (shares the scanner screen).

## Edge cases

- `unitsPerPack` present but `baseItemId` missing → treated as a normal line (no pill, no
  loose field). The backend always writes both together.
- Pack of 1 → pill reads "1 pack = 1 pc".
- Loose pieces `0` is sent as `0`; blank sends nothing. Both end with the base at 0 — the
  difference is only visible in the request body / audit metadata.

## Deploy / build needed

- Backend: retailer/wholesale P1 picking step (step 18) deployed to dev.
- Picker: this build (step 29) installed on every picker device of the store **before**
  `wholesaleEnabled` is switched ON for it.
