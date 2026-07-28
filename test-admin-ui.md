# Admin panel — cross-cutting UI behaviours (Test Guide)

Small, app-wide admin UI fixes that aren't tied to one feature area. Test against
**dev** (`damin.haper.in`) with any admin build that has the change deployed.
Each item says **what to do** and **what to expect** (✅ good / ❌ should not happen).

---

## Issue 7 — Mouse wheel must not change number-input values

> **Why:** a `<input type="number">` can have its value changed accidentally two
> ways: (a) the mouse **wheel** while focused (browser default), and (b) clicking
> the tiny **up/down spinner arrows**. Both nudge the value silently — e.g. an
> Item Quantity of `50` becoming `47`. Fixed globally, app-wide:
> - **Wheel:** a single document-level guard blurs the focused number input the
>   instant a wheel scroll starts, so the wheel only scrolls the page
>   (`haper-admin/src/utils/numberInputScrollGuard.ts`, installed in `main.tsx`).
> - **Spinner arrows:** hidden via global CSS (`index.css`, `appearance: textfield`
>   + `::-webkit-*-spin-button { -webkit-appearance: none }`) — there are no arrows
>   to click, and it also stops the spinner clipping narrow fields (e.g. Receive
>   Goods → Cost / piece). Typing + keyboard still work normally.

Test on **any** numeric field. Good coverage spots:
- **Items → Add/Edit item → Quantity** (the reported field).
- **Products → Assign to store → price / selling price / low-qty**.
- **Stores → Store modal → Minimum order value / Delivery charges / lat-long**.
- **Config → Settings** numeric fields.
- **Delivery Boys → Cash reconcile → amount**.

Steps:
1. Open a form with a number field. Type a value (e.g. Quantity `50`).
2. Leave the cursor **focused** in that field. Scroll the mouse wheel up/down.
3. ✅ The value **stays `50`** — it does not increment/decrement.
4. ✅ The **page still scrolls** normally (the field just loses focus on the first
   scroll notch). Click back into it to keep editing.
5. ✅ There are **no up/down arrows** on the field anymore — nothing to click that
   would change the value.
6. ✅ **Typing and keyboard** still work normally — only wheel + spinner are gone.
7. ✅ Text fields, dropdowns, and date fields are unaffected (they never had this).
8. ❌ At no point does scrolling over — or clicking within — a focused number field
   change its value on its own.

> Regression check: this is a passive, blur-only guard — it never calls
> `preventDefault`, so it can't block page scrolling anywhere. Covered by
> `src/utils/numberInputScrollGuard.test.ts` (vitest).

---

## Issue 8 — Shelf (location) column in Items list

**Where:** Items → Items Management table (`src/pages/Items/ItemsList.tsx`).
**Why:** pickers need each item's shelf location visible at a glance without opening
the item. The value is the item's `location` field (also editable via the item form's
"Shelf Location" input, e.g. `A3-B05`). The admin list API already returns `location`
(admin projection strips only `__v`/`createdAt`).

> **Updated:** this column is **no longer read-only**. Anyone with `items.edit` can now
> click the shelf value and change it right there in the row — see
> **[Issue 11](#issue-11--shelf-column-is-click-to-edit-in-the-items-list)** for those
> steps. The display checks below are unchanged and still apply.

Steps:
1. Open **Items**. The table columns are now: Item · Price · **Shelf** · Stock ·
   Status · Stock Value · Actions (Shelf sits directly after Price).
2. ✅ An item with a shelf set (e.g. `A3-B05`) shows it in monospace under **Shelf**.
3. ✅ An item with **no** shelf shows a muted `—` (never blank/`undefined`).
4. ✅ Editing an item's **Shelf Location** in the form and saving updates the value
   shown in this column after refresh.
5. ✅ Column counts line up — no header/cell misalignment (7 headers, 7 cells).
6. ❌ It must not show `null`/`undefined` or shift other columns.

---

## Issue 9 — Search items by iId + shelf (and product-master by iId)

**Where:** Items → search box; Product Master → search box.
Backend: `packages/shared/repositories/item.repository.js` (both search `$or` blocks) +
`product.repository.js` (already had iId).
**Why:** staff need to find a row by product identity (`iId`, e.g. `BI692052`) or shelf
code (`location`, e.g. `A3-B05`), not just name/brand/barcode. Both item search blocks now
include `iId` and `location`; barcode/name/brand/tags/category still match.

Steps:
1. ✅ **Items** — a full or partial **iId** (`BI692052`, `692052`) returns that item.
2. ✅ **Items** — a **shelf** code (`A3-B05`, `F1`) returns items on that shelf.
3. ✅ **Items** — barcode / name / brand still work (unchanged).
4. ✅ **Product Master** — an **iId** returns that master (already worked; placeholder now says so).
5. ✅ Placeholders: Items → "name, brand, barcode, iId, or shelf"; Products → "name, brand, barcode or iId".
6. ❌ Regression: empty search still returns the full list; existing name/barcode searches
   return the same rows (the change only *adds* `$or` branches).

## Issue 10 — Store "View details" (read-only, incl. _id)

**Where:** Stores Management (`/stores`) → each row's **Actions** → the new **eye** button.
Frontend only: `haper-admin/src/pages/Stores/StoreDetailsModal.tsx` (new) +
`StoresList.tsx` (the eye action + modal wiring). No backend change — uses the store object
already in the list.
**Why:** super-admin needs to see every stored field for a store at a glance — especially the
Mongo **`_id`** and other reference ids (`servingWarehouseId`, `ownerId`) for support/DB lookups —
without opening the edit form and risking an accidental change.

Steps:
1. ✅ Click the **eye** (View Details) icon on any store row → a read-only modal opens with the
   store name + ACTIVE/INACTIVE pill in the header.
2. ✅ **Identity** section shows the **Store ID** (`_id`) in monospace with a **copy** button →
   clicking it copies the id and toasts "Copied".
3. ✅ All fields render grouped: Identity, Contact (email/GSTIN copyable, map link opens in a new
   tab), Location & delivery area (coordinates as `lat, lng`, service-area, radius), Order & charges,
   Delivery incentives, Supply layer (serving-warehouse / owner ids, copyable), Villages (chips),
   Business hours (per day), and Image (thumbnail) — each shows **"—"** when empty.
4. ✅ It's **read-only** — no inputs, no save; **Close** (or the ✕) dismisses it. Edit/Delete
   actions are unchanged and still work.
5. ❌ Regression: opening details must not mutate the store; the list is unchanged after closing.

---

## Issue 11 — Shelf column is click-to-edit in the Items list

**Where:** Items (`/items`) → the **Shelf** column of the Items Management table.
Frontend only: `haper-admin/src/pages/Items/ShelfCell.tsx` (new cell),
`src/pages/Items/shelfEdit.ts` (the rules), wired into `ItemsList.tsx`.
**Why:** re-shelving an item used to mean opening the item's edit modal, changing
**Shelf Location**, saving, and losing your scroll position / search / page. Now you
click the shelf value in the row, type the new code, press **Enter** — done, without
leaving the list. The column is still backed by the item's **`location`** field.

**What deploy this needs**
- **`haper-admin` front-end only** — needs an admin build deployed to `damin.haper.in`
  (**user-manual** deploy, as always).
- **ZERO backend changes.** It reuses the existing `PUT /admin/item/:itemId` with a
  one-field body (`{ "location": "A3" }`). **No migration, no schema change, no new
  env var**, no new endpoint.

> **The one rule to remember.** Moving an item off a **real** shelf (e.g. `FRIDGE6`)
> asks you to confirm first. Moving it off **`DefaultShelf1`** (the "unassigned"
> placeholder) or off a **blank** shelf saves straight away — plenty of items sit
> there and nagging about them would be noise.

**Setup:** log in to `damin.haper.in` as someone with the **`items.edit`** permission
(super admin, store admin, or a manager), pick a store, open **Items**.

### ✅ A. Edit a shelf with no confirmation (placeholder or blank)
1. Find an item whose **Shelf** shows `DefaultShelf1` (or `—`, i.e. blank).
2. Hover the value — it turns into a link-ish underline with a small **pencil**.
3. Click it. The cell becomes a **text input** right in the row (no modal, no page
   change), with the old text pre-selected.
4. Type `A3` and press **Enter**.
5. ✅ It saves immediately — **no dialog** — a green toast says **"Shelf updated."**
   and the cell now reads `A3`.

### ✅ B. Edit a shelf that is REAL → it asks first
1. Find an item on a real shelf, e.g. **Amul Butter 500g** on `FRIDGE6`.
2. Click the value, type `A3`, press **Enter**.
3. ✅ A dialog titled **"Change shelf?"** appears, spelling out the actual move:
   *"Amul Butter 500g" is currently on shelf **FRIDGE6**. Move it to **A3**?*
4. Click **Cancel** → ✅ nothing is saved, the cell still shows `FRIDGE6`, and the
   **editor stays open with `A3` still typed** so you can retry or Escape out.
5. Press **Enter** again, then click **Change shelf** → ✅ saved, toast
   **"Shelf updated."**, cell reads `A3`.

### ✅ C. `default shelf` (with a space) counts as a REAL shelf
1. Put an item on the shelf literally spelled **`default shelf`** (a space in the
   middle). It saves and displays as `DEFAULT SHELF`.
2. Now change it to `A3` and press **Enter**.
3. ✅ You **DO** get the **"Change shelf?"** dialog. Only **`DefaultShelf1`**
   (no space) is the system placeholder; `default shelf` is treated as a normal,
   uniqueness-enforced shelf. This mirrors the backend exactly — do not "fix" it.

### ✅ D. Clearing a shelf is allowed
1. Click the shelf of an item on `A3`, **delete all the text**, press **Enter**.
2. ✅ The dialog reads *"…is currently on shelf **A3**. **Clear its shelf?**"*.
3. Click **Change shelf** → ✅ the cell now shows a muted **`—`**.
4. Doing the same on an item already on `DefaultShelf1`/blank → ✅ no dialog at all.

### ✅ E. Shelf codes are stored UPPERCASE
1. Click a shelf, type `a3` (lower case), press **Enter**.
2. ✅ The input itself uppercases as you type, and the saved/displayed value is `A3`.
3. **No-op case:** on a row that still shows legacy lower-case `a3`, type `A3` and
   press **Enter** → ✅ the editor just **closes**: no dialog, no toast, and **no
   network request at all** (the same letters = the same shelf). Same if you change
   nothing and press Enter.

### ✅ F. A shelf already in use is rejected (409)
1. Note an occupied shelf, e.g. `A3` currently holds **Amul Butter**.
2. On a **different** item, inline-edit its shelf to `A3` and confirm.
3. ✅ A red toast shows the **backend's own message**, word for word:
   *Shelf "A3" is already assigned to "Amul Butter". Each shelf can hold only one item.*
4. ✅ The cell **reverts to its old value** and the editor closes. Nothing was saved.
5. This is the **same rule** as the item edit form — see
   [`test-inventory.md` §14 Shelf (location) uniqueness](./test-inventory.md).

### ✅ G. Saving does NOT reload the list (this is deliberate)
1. Search for something, scroll down, go to page 2 — then inline-edit a shelf there.
2. ✅ After saving, your **search text, filters, page number and scroll position are
   all exactly where you left them**. Only that one cell changes.
3. ✅ **Expected, not a bug:** if you searched `FRIDGE` and then move that item to
   `A3`, the row **stays on screen** showing `A3` — it does not disappear under your
   cursor. It drops out of the results the next time you refresh or re-search.
4. Note the difference from the other row actions on this page — **delete**,
   **status toggle** and **popular toggle** DO refresh the list. Only the shelf edit
   keeps your place.

### ✅ H. Keyboard behaviour
1. **Enter** = save. **Escape** = cancel and revert (nothing sent).
2. ✅ **Clicking away does NOT save.** If you typed something and click elsewhere, the
   editor **stays open** with your text. (An untouched editor closes itself.)
3. ✅ When the editor closes — saved, cancelled or failed — focus goes back to **that
   row's shelf button**, so you can Tab/Enter your way down the list shelf by shelf.

### ✅ I. While a save is in flight
1. Confirm a shelf change and watch the cell.
2. ✅ The input is **disabled** and shows **"Saving…"** — you cannot type or
   double-submit by hitting Enter again.
3. ✅ You cannot open **another row's** shelf editor until this save finishes.
4. ✅ Once you have clicked **Change shelf**, the dialog's **Cancel / ✕ / Escape /
   click-outside stop working** until it finishes. That is on purpose: the write is
   already on its way, so the dialog will not pretend to cancel it.

### ❌ J. No `items.edit` permission → nothing to click
1. Log in as an account **without** `items.edit` (e.g. a support user) and open **Items**.
2. ❌ The Shelf column must look **exactly like the old read-only column**: plain
   monospace text, **no hover underline, no pencil icon, no cursor change**, and
   clicking it does nothing.

### ✅ K. Store scope
1. As **super admin** on **"All Stores"**, inline-edit a shelf → ✅ it still saves; the
   request carries that row's own store id.
2. As a **store admin**, you are hard-bound to your own store by the backend — you
   cannot reach another store's item at all.

> Covered by `src/pages/Items/shelfEdit.test.ts` (22) and
> `src/pages/Items/ShelfCell.test.tsx` (13), both vitest.

---

## Issue 12 — `/config` page layout revamp

**Where:** Settings → **Config** (`damin.haper.in/config`).
Frontend only: `haper-admin/src/pages/Config/ConfigSettings.tsx`,
`src/pages/Config/GiftTiersPanel.tsx`, `src/pages/Config/GiftTierFormModal.tsx`,
plus a one-line app-wide fix in `src/index.css` (`.skeleton-bar`).
Design spec: [`config-page-redesign.md`](./config-page-redesign.md).

**Why:** all six settings boxes were dropped into one auto-fitting grid. On a
2560px monitor the browser fitted **four boxes across**, and a CSS grid stretches
every box in a row to the height of the tallest one — so the body-less
**Maintenance Mode** box (a title and one line of text) was inflated into a
~500px-tall empty black box next to Store Controls. **Force Update** did not fit
on that row, dropped to a second row **on its own**, and left roughly **1700px of
empty black** beside it. That is what the client meant by "looks absurd".

Now: **one centred column capped at 1080px**, split into two labelled groups —
**STORE SETTINGS** (Store Controls, Free Gift on Order) and **PLATFORM SETTINGS**
(Support Contact, Not Serviceable Message, Force Update, Maintenance Mode).
Cards take their **natural height** (nothing is stretched to match a neighbour),
and two columns appear only at **1180px and wider**.

**What deploy this needs**
- **`haper-admin` front-end only** — an admin build deployed to `damin.haper.in`
  (**user-manual** deploy, as always).
- **ZERO backend changes.** Same five endpoints, same payloads:
  `PUT /admin/config/store`, `/admin/config/support`, `/admin/config/not-serviceable`,
  `/admin/config/force-update`, and the same gift-tier calls.
  **No migration, no schema change, no new env var, no new endpoint.**
- The `.skeleton-bar` CSS fix rides along in the same build and touches
  **three other pages** — see step **L**.

> **The one rule to remember.** Nothing about *what gets saved* changed. Every
> value, every field, every endpoint is the same as before. If a number saved
> before this build, it saves now — only the layout, the wording and when the
> **Save** button lights up have changed.

**Setup:** log in to `damin.haper.in` and open **Config**. You need two accounts to
finish this guide: a **super admin** and a **store admin**. Steps A, B, E and H are
pure "look at the screen" checks — resize the browser window (or use the browser's
responsive/device toolbar) to the width each step names.

### ✅ A. Super admin at 2560px — the whole point of this change
1. Log in as **super admin**, pick a real store in the top store switcher, open **Config**.
2. Maximise the browser on a wide monitor (2560px). If you do not have one, open
   the browser dev tools' responsive mode and set the width to **2560**.
3. ✅ All the content sits in **one centred column** with equal empty margin on the
   left and right. The column stops growing at about **1080px wide** — the empty
   space is symmetric background, **not a hole inside the content**.
4. ✅ You see **two headings** in small grey capitals with a hairline running to the
   right: **STORE SETTINGS**, then **PLATFORM SETTINGS**.
5. ✅ Under **STORE SETTINGS**: **Store Controls** and **Free Gift on Order**, each
   the full width of the column, stacked.
6. ✅ Under **PLATFORM SETTINGS**: **Support Contact** and **Not Serviceable Message**
   **side by side**, then **Force Update** full width beneath them, then a slim
   **Maintenance Mode** row at the very bottom.
7. ✅ **No card is alone on a row with empty space beside it.** Force Update spans
   the whole column, so there is nothing to its right.
8. ✅ **No card is stretched.** Support Contact and Not Serviceable Message end at
   whatever height their own contents need — the shorter of the two has a **clean
   bottom edge**, it is not padded out with empty space to match the taller one.
9. ❌ There must be no ~500px-tall empty Maintenance box and no wide black gap
   anywhere on the page. That was the reported bug.

### ✅ B. Widths: 1366px laptop, 1180px and 1179px
1. Set the window to **1366px** (a normal laptop).
   ✅ Support Contact and Not Serviceable Message are still **two columns**, side by
   side. Everything else is full width. Nothing is cut off.
2. Set it to exactly **1180px**.
   ✅ Still **two columns** — this is the narrowest width that keeps them side by side.
3. Set it to **1179px** (one pixel narrower).
   ✅ It drops to **one column**: Support Contact, then Not Serviceable Message, then
   Force Update, then the Maintenance row, all stacked full width.
4. ✅ At every width there is **no sideways scrollbar** and no text runs off the edge.
5. ✅ Inside Store Controls, the three money fields stay **3-across** down to about
   760px wide, and the two toggle boxes (Picker workflow / Delivery incentive) stay
   **side by side** down to about 900px, then stack. Cards never look stretched.

### ✅ C. Store admin — two sections and no group headings
1. Log in as a **store admin** (not a super admin) and open **Config**.
2. ✅ The page title reads **"Store Configuration"** with the subtitle
   *"Manage the commercial settings for your assigned store."*
3. ✅ You see exactly **two cards**: **Store Controls** and **Free Gift on Order**,
   both full width, stacked.
4. ✅ There are **no group headings** — no "STORE SETTINGS", no "PLATFORM SETTINGS".
   With only one group, a heading would just repeat the page title.
5. ❌ **Support Contact, Not Serviceable Message, Force Update and the Maintenance
   Mode row must NOT appear at all** — not greyed out, not empty: absent.
6. ✅ The page looks **complete** — two full-width cards, no gap where the platform
   cards used to be.
7. ✅ The scope pill in each card header still reads **THIS STORE**.

### ✅ D. Super admin on "All Stores" — layout identical, gift panel inert
1. As **super admin**, set the top store switcher to **"All Stores"**.
   (Changing the switcher reloads the page — that is normal.)
2. ✅ The layout is **exactly the same** as step A: same two groups, same six
   sections, same order. Nothing moves or collapses.
3. ✅ **Store Controls** scope pill now reads **NO STORE SELECTED**. Its fields and
   its Save button behave exactly as before.
4. ✅ **Free Gift on Order** shows a proper empty state inside a dashed box: a grey
   gift icon, **"Pick a store to manage gifts"**, and
   *"Gift tiers are set per store. Use the store switcher at the top of the page."*
   Its scope pill reads **NO STORE SELECTED**.
5. ✅ The gift card shows **no master switch, no tiers table and no Save bar** in
   this state, and **no gift API call is made** — open the browser Network tab,
   reload, and confirm there is no `gift-tiers` request.
6. ✅ Now pick a real store in the switcher → the gift card comes back with the
   master switch, the tiers and the Save bar, and the pill reads **THIS STORE**.

### ✅ E. Both themes — dark and light
Use the theme toggle in the top bar. Check the page in **dark** first, then **light**.
1. ✅ **Dark theme:** every card has a visible border, the two toggle boxes inside
   Store Controls are visibly boxed, the scope pills read clearly, and the
   Maintenance row is separated from the background.
2. ✅ **Light theme (the important one — panels and inner boxes are both white
   here):** every card outline, every inner toggle box outline, and every scope
   pill outline is still **visible as a thin grey line**. Nothing "disappears" into
   a white sheet.
3. ✅ Turn **Enable picking** ON → that toggle box's border turns **purple**. Turn it
   OFF → back to grey. Same for **Enable delivery incentive** and the Free Gift
   master switch. Check this in **both** themes.
4. ✅ Hover the **Maintenance Mode** row → its border turns purple and the `›`
   chevron slides a few pixels right. The row's background does **not** change
   colour (deliberate — a white-on-white fill change would be invisible).
5. ✅ Change any field → the **"● Unsaved changes"** line shows in **amber** and is
   readable on both themes.

### ✅ F. Save scope — each Save still writes only to its own endpoint
Open the browser **Network** tab (filter: Fetch/XHR) and keep it open.
1. Change **Delivery fee** to `15` → click **Save** in Store Controls.
   ✅ Exactly **one** request: `PUT /admin/config/store`. Toast: *"Store settings saved"*.
2. Change **Support phone** → click **Save** in Support Contact.
   ✅ Exactly **one** request: `PUT /admin/config/support`. Toast: *"Support contact saved"*.
3. Change the **Title** in Not Serviceable Message → **Save**.
   ✅ `PUT /admin/config/not-serviceable`. Toast: *"Not-serviceable message saved"*.
4. Change **Min Android version** → **Save**.
   ✅ `PUT /admin/config/force-update`. Toast: *"Force update settings saved"*.
5. Flip the **Free Gift** master switch → **Save**.
   ✅ The gift master-switch call only. Toast: *"Free gift turned on"* / *"turned off"*.
6. ✅ Reload the page after each one — the value you saved is still there.
7. ❌ No Save may fire more than one request, and no Save may touch another card's
   endpoint.
8. **Real example end-to-end:** set **Delivery fee** to `15`, Save, then open the
   customer app on that store and add an item → the cart shows a **₹15** delivery
   charge. Exactly as before this change.

### ✅ G. Keyboard and focus
1. Click on the page title, then press **Tab** repeatedly.
2. ✅ Focus moves **card by card, top to bottom, in the order you read them**:
   the three Store Controls money fields → picking switch → delivery-incentive
   switch → (the two extra fields if the incentive is ON) → Store Controls **Save**
   → the Free Gift card → Support Contact → Not Serviceable → Force Update →
   the **Maintenance Mode** row.
3. ✅ Every focused control shows a clear **2px purple ring** around it — inputs,
   textareas, switches, Save buttons, and the whole Maintenance row.
4. ✅ Press **Enter** on the focused Maintenance row → it opens `/maintenance`.
5. ✅ **Space** toggles a focused switch.
6. ❌ Focus must never jump backwards or land on something invisible.

### ✅ H. Mobile — 768px and below
1. Set the width to **768**, then to **480** (or open the page on a phone).
2. ✅ Everything is a **single column**; card padding tightens; nothing overlaps.
3. ✅ Each card's Save bar **stacks**: the status text on one line, and a
   **full-width Save button** underneath it, big enough to tap comfortably.
4. ✅ The Maintenance row's description drops to a **second line** under the title
   (the `·` separator disappears) instead of squashing.
5. ✅ The money fields go 1-per-row at 480px; the tiers table inside Free Gift
   scrolls sideways on its own without the page scrolling sideways.
6. ❌ No horizontal scrollbar on the page at any width.

### ❌ I. No `store_config.edit` permission → gifts are look-only
1. Log in as an account that can **see** config but does **not** have
   **`store_config.edit`** (ask whoever manages roles to set one up).
2. ✅ The layout is **exactly the same** — same groups, same cards, nothing hidden
   or moved.
3. ✅ The Free Gift **tiers are visible** (you can read the thresholds, gift items,
   windows and status pills).
4. ❌ The Free Gift **master switch cannot be flipped**, its **Save** button is
   greyed out, and the **Add tier / edit (pencil) / delete (bin)** controls are not
   usable.

### ✅ J. Save buttons: all read "Save", and stay off until you change something
This is the behaviour change most worth testing. **All five** Save buttons now read
just **"Save"** — the old wording ("Save Store Settings", "Save Support Contact",
"Save Message", "Save Force Update") is gone. Three of them (Support Contact,
Not Serviceable Message, Force Update) **used to be clickable at all times**; now
they behave like Store Controls and Free Gift already did.

1. Reload `/config` and touch nothing.
   ✅ **All five Save buttons are greyed out** (faded, and the cursor shows
   "not allowed"). Each card's status line reads its clean text:
   - Store Controls and Free Gift → *"All changes saved."*
   - Support Contact and Not Serviceable Message → *"Applies to all stores. Apps update within minutes."*
   - Force Update → *"Use X.X.X format. Set 0.0.0 to disable."*
2. Type one character into **Support phone**.
   ✅ **Only Support Contact's** Save button turns solid/clickable and its status
   line changes to amber **"● Unsaved changes"**.
3. ✅ **The independence check (do not skip this):** with Support Contact dirty,
   look at the other four cards — **Not Serviceable Message, Force Update, Store
   Controls and Free Gift Save buttons must still be greyed out** and still show
   their clean status text. Editing one card must never light up another card's Save.
4. Click **Save** on Support Contact.
   ✅ The button briefly reads **"Saving…"**, then flashes **"Saved"** with a tick
   for about 2 seconds, then goes back to **"Save"** — and **greys out again**,
   because there is nothing left to save. The status line returns to
   *"Applies to all stores. Apps update within minutes."*
5. Repeat steps 2–4 for **Not Serviceable Message** (change the Title) and
   **Force Update** (change Min iOS version). Same behaviour each time.
6. Flip the **Free Gift** master switch → ✅ its status line reads
   **"● Unsaved switch change"** and only its own Save lights up.
7. ✅ Screen-reader / accessibility check (optional, needs dev tools): the five
   buttons all *show* "Save" but each has its own hidden name — inspect the button
   and check `aria-label` reads "Save store controls", "Save free gift switch",
   "Save support contact", "Save not-serviceable message", "Save force update".

### ✅ K. Renamed field and shorter hints
1. In **Store Controls → Pricing & fees**, read the first field.
   ✅ It is now labelled **"Free delivery above"** (it used to say *"Minimum order
   value for free Delivery"*), with a **₹** sign inside the box and the hint:
   **"Carts below this pay the delivery charge. It does not stop customers from ordering."**
2. ✅ The other two are **"Delivery fee"** (*"Added to every delivery order. 0 = always free."*)
   and **"Platform fee"** (*"Kept by Haper on each order."*).
3. **Prove the hint is true — the real example.** Set **Free delivery above** to
   `150` and **Delivery fee** to `15`, then Save. In the customer app on that store:
   - Build a cart worth **₹120** → ✅ the order **can still be placed**, and the
     bill charges **₹15** delivery.
   - Build a cart worth **₹200** → ✅ delivery is **₹0**.
   - ❌ A ₹120 cart must **never** be blocked with a "minimum order value" error.
     This field only decides whether delivery is free.
4. ✅ The **Enable picking** hint is now one short line, exactly:
   *"Adds a pick-and-pack step: Open → Picking → Packed → Assigned. Riders are
   assigned only after packing."* (It used to be a three-line paragraph.)
5. ✅ **Delivery incentive** is still there, still fully editable, now sitting to the
   **right of Picker workflow**. Turn it ON → the two extra fields (**On-time
   threshold** in minutes, **Bonus per order** in ₹) appear inside its box, and the
   Picker workflow box beside it **does not grow taller**. Turn it OFF → they hide.
   Its default is OFF and this test does not ask you to leave it on.
6. ✅ The small purple icons that used to sit next to each field label are gone.
   The `₹` prefix inside each money box is what tells you the unit.

### ✅ L. Maintenance row, toast position, and loading skeletons
1. As super admin, scroll to the bottom of **PLATFORM SETTINGS**.
   ✅ Maintenance Mode is now a **single slim row**, roughly one line tall, reading
   **"Maintenance Mode · Take the whole app or a single store offline"** with
   **Open ›** on the right. It is **not a card** any more.
2. Click it → ✅ it opens the **`/maintenance`** page, exactly as the old card did.
3. ✅ It is **super-admin only** — a store admin does not see this row at all (step C).
4. **Toast position.** Save any card and watch where the confirmation pops up.
   ✅ It appears in the **bottom-right corner**, the same corner as every other
   toast in the admin panel (e.g. the "Copied" toast on Stores → View details).
   The page's own differently-styled popup is gone.
   ✅ Save a config card and then save a gift tier — ❌ two differently-styled
   popups must **not** fight for the same spot.
5. **Loading skeletons in LIGHT theme** (this is the app-wide `.skeleton-bar` fix).
   Switch to **light theme**, then throttle the network (dev tools → Network →
   Slow 3G) and reload each of these:
   - ✅ `/config` — grey placeholder bars inside skeleton cards while it loads,
     under real page and group headings.
   - ✅ `/config` gift tiers — three grey skeleton rows in the tier area.
   - ✅ **Dashboard** — grey placeholder bars, not a blank white page.
   - ✅ **Maintenance** (`/maintenance`) — grey skeleton rows in the store list.
   ❌ None of these may show a **completely blank white area** while loading.
   That was the bug: the skeletons were white on white and invisible in light theme.

### Edge cases

- **Only one card can save at a time.** While any Save is in flight, **all five**
  Save buttons are disabled for that second or two. This is on purpose — it stops
  you firing two writes at once. ✅ Once the save finishes, the other cards go back
  to their normal state (still greyed unless they have their own unsaved edits).
- **Changing the store switcher reloads the page and discards unsaved edits.**
  ✅ Type something into Support phone (do **not** save), then switch store — the
  page reloads and your typing is gone. Expected: the switcher does a full reload,
  and the page deliberately keeps no draft state.
- **Whole-page load failure.** Kill the network and reload `/config`.
  ✅ You get one error card with a warning triangle, **"Couldn't load settings"**,
  *"Check your connection and try again."* and a **Retry** button. Restore the
  network, click **Retry** → the page loads normally.
- **Gift tiers load failure only.** If just the tiers call fails, the error stays
  **inside** the Free Gift card ("Couldn't load gift tiers" + Retry) — the rest of
  the page still works.
- **Save failure.** Block the network and click a Save.
  ✅ A red error toast appears, and the card **stays dirty** ("● Unsaved changes",
  Save still clickable) so you can retry. Nothing is silently lost.
- **A store with the delivery incentive already ON.** ✅ The toggle is still
  visible and can be switched OFF from this page. It is deliberately never hidden —
  a setting you can turn on must always be turnable off.
- **Reduced motion.** With the OS "reduce motion" setting on, ✅ the hover slide and
  the switch animation stop; everything still works.
- **Very long text.** Paste a long office address and a long update message.
  ✅ They wrap inside their cards; nothing overflows the 1080px column and no
  sideways scrollbar appears.

> **Automated coverage:** none for this change — it is layout, wording and CSS, so
> it has to be checked by eye at the widths and themes above. Existing Config unit
> tests (`src/pages/Config/configTime.test.ts`) are unaffected.

