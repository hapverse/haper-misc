# Brands admin page (Shop by Brand, Phase 2) - design spec (v1, 2026-11-20)

Owner bar: "neat, clean and easy to use."
Mockup: `/Users/office/Documents/haper/haper-misc/design-brand-admin-mockup.html` (desktop, dark + light toggle).
Builds on: `plan-brand-shop-business.md` (section 7 "Phase 2" overlay), `haper-backend/docs/reference/brand-shop.md`
(Phase 1 rules), `design-brand-shop-business.md` section 4 (letter badge + logo tile).
Implements: haper-admin (the admin web engineer). Backend contract below is what the screen NEEDS; the backend engineer /
frontend architect own the final shape.

Plain words: today a "brand" in the app is built from the free-text Brand typed on each product. This page lets a
super admin put a small "overlay" on top of each brand: a nicer display name, a logo, other spellings that should
count as this brand ("Cadbbury" -> Cadbury), and a Hide switch. Product data is never edited from here.

---

## 0. Decisions in this spec (summary)

| # | Decision | Why |
|---|---|---|
| 1 | One list page + one right-side drawer. No create button, no delete. | Brands come from products; staff only adjust them. |
| 2 | Everything in the drawer is a draft until **Save changes** (one save, one audit row). | One mental model; nothing changes the app by accident. |
| 3 | Merging is "merge INTO this brand" from the brand you open. A preview dialog always runs before a merge is saved. | The brand you opened is clearly the one that stays (same as HubSpot's "primary record" pattern), and the preview shows the result before anything changes. |
| 4 | The merge picker shows **3 sample product names** per spelling, and blocks catch-alls and chains. | Product names, not counts, are what tell "Cadbbury" (typo) from "Cadbury Bournvita" (sub-brand). |
| 5 | Key shown under the name (mono), not as its own column. | Saves ~140px on a 1366px laptop; key is reference info, not a scanning column. |
| 6 | Logo upload is NOT cropped (no square crop editor). | Most logos are wide wordmarks; a square crop cuts letters. The app already fits a logo inside a white square. |
| 7 | Admin badge = the exact app badge (same 8 colour pairs, same initials rule). | Staff should see what retailers see. These 8 pairs are the only new hex values, and they copy the app's colours. No new CSS tokens. |
| 8 | Super admin only: `superAdminOnly` menu item + `ProtectedRoute requireRole={['super_admin']}` + backend `requireRoles([SUPER_ADMIN])`. | Same as Product Master. |

---

## 1. User flows

**A. Fix a misspelling (main job)**
1. Sidebar Catalog -> **Brands** (or top-bar search "brand", "logo", "merge", "spelling").
2. Optional: Spellings filter = **Possible duplicates**. Sort = Most products.
3. Click a row (e.g. **Cadbury**) -> drawer opens.
4. "Possible duplicates" lists **Cadbbury** with 3 product names, "1 letter different", 3 products.
5. Click **Merge in** -> Cadbbury moves into "Merged spellings" with a **New** pill (still a draft).
6. **Save changes** -> preview dialog "Merge 1 spelling into Cadbury?" with before/after counts.
7. **Merge and save** -> toast "Cadbury saved. Buyers see it within 5 minutes." -> drawer closes, row flashes, the Cadbbury row is gone from the list.
Exits: Cancel in the dialog returns to the drawer with the draft intact. Errors -> section 6.

**A2. Opened the wrong one** (staff open "Cadbbury", the typo): the suggestion row for Cadbury says
"Bigger than this brand" and its button reads **Merge into Cadbury** -> the drawer switches to Cadbury with
Cadbbury already staged as New (asks "Discard changes?" first if the current draft is dirty). Then steps 6-7.

**B. Add a logo**: row -> drawer -> **Upload logo** -> file picker (PNG/JPG) -> preview tile updates instantly ->
**Save changes** -> toast. No preview dialog (nothing is merged).

**C. Rename / hide**: row -> edit Display name or flip **Hide from Shop by brand** -> Save -> toast.

**D. Undo a merge**: row -> "Merged spellings" -> **Unmerge** on a row (marked "Will unmerge", Undo link) -> Save.
No dialog (unmerging only splits the brand back out, nothing is lost).

**E. Leave without saving**: X / Esc / click outside with a dirty draft -> ConfirmDialog "Discard changes to
Cadbury?" -> **Discard** closes, **Keep editing** returns.

---

## 2. Where it lives

- **Sidebar**: section **Catalog**, directly after **Product Master** (brand is a product field Product Master owns):
  Items, Product Master, **Brands**, Categories, Banners, ...
  `{ icon: Badge (lucide), label: 'Brands', path: '/brands', superAdminOnly: true, keywords: ['brand', 'brands',
  'logo', 'brand logo', 'company', 'manufacturer', 'spelling', 'misspelling', 'merge', 'duplicate brand',
  'shop by brand', 'hide brand'] }`. Use `superAdminOnly` alone (not also `requireAnyRole`; `isVisible()` returns on
  it first). None of these keywords exist on another item today (checked), so "brand" / "logo" / "merge" land
  on Brands as the top result.
- **Route**: `/brands` inside `<ProtectedRoute requireRole={['super_admin']} />` next to `/products` in `App.tsx`.
  Drawer state in the URL: `/brands?brand=<key>` (refresh or a shared link reopens the same drawer; unknown key ->
  drawer does not open, toast.info "That brand no longer exists.").
- **Backend mirror**: every `/admin/brand*` route `requireRoles([SUPER_ADMIN])`. No new permission string. If the
  architect prefers one (`brands.manage`), FE `permissions.ts` and BE `permission.js` must list the same roles.

---

## 3. List page

### 3.1 Layout (desktop >= 900px viewport)
Follows `VariantGroupsList.tsx` / `RetailersPage.tsx` exactly: `PageHeader`, a filter `card`, a table `card`,
footer pager. No max-width (house tables are full width).

```
Brands                                                                           (PageHeader)
Name, logo and spellings Haper Business buyers see in Shop by brand.

+-- filter card -----------------------------------------------------------------------------+
| Search                    Store (wholesale counts)  Visibility     Logo        Spellings       Sort          |
| [Name, key or spelling ]  [Patna Main        v]     [All      v]  [Any    v]  [Any       v]  [Most products v] |
+--------------------------------------------------------------------------------------------+
(i) Shop by brand is off in the app right now. Changes here are saved and show up once it is on.   <- only if flag off

+-- table card ------------------------------------------------------------------------------+
|                                                                               Updating...  |
| BRAND                        SPELLINGS                    PRODUCTS  WHOLESALE AT PATNA  VISIBILITY  LAST EDITED  |
| [Ca] Cadbury                 Cadbury, CADBURY  +1 merged       45        12           Shown     18 Nov 2026  > |
|      cadbury                                                                                |
| [logo] Amul                  Amul, AMUL, Amul                  38         9           Shown     -            > |
|      amul                    2 look-alikes                                                  |
| [Ge] Generic                 Generic, GENERIC                 364         -           Catch-all  -           > |
| [Ha] Haldiram's              Haldiram's                        21         0           Hidden    17 Nov 2026  > |
| ...                                                                                        |
| 403 brands - 41 with a logo                                   < Prev  Page 1 of 9  Next >  |
+--------------------------------------------------------------------------------------------+
```

### 3.2 Filters (one row, `flex-wrap`, house `fieldLabel` + `input` with `minHeight: 40`)
| Control | Options | Default | Notes |
|---|---|---|---|
| Search | text, `maxLength 60`, placeholder "Name, key or spelling" | empty | Matches display name, automatic name, key, any raw spelling, any merged spelling. Case-insensitive contains. 300ms debounce (house `DEBOUNCE_MS`). |
| Store (wholesale counts) | every store (`/admin/store`, `skipStoreHeader`, as RetailersPage) | top-bar store if one is picked, else the first store | Changes only the Wholesale column (and the "In the app" option below). No "All stores" option: the count is per store by definition. |
| Visibility | All - In the app at this store - Not in the app at this store - Hidden by admin - Catch-all names | All | "In the app at this store" = not hidden, not catch-all, wholesale count >= 1 (exactly what retailers at that store see). |
| Logo | Any - Has logo - No logo | Any | "No logo" + Sort "Most wholesale" = the logo to-do list. |
| Spellings | Any - Has merged spellings - Possible duplicates | Any | "Possible duplicates" = brands with >= 1 look-alike (section 4.4 rules). |
| Sort | Most products - Most wholesale at this store - Name A-Z - Recently edited | Most products | Ties: name A-Z. |

Any filter change -> page 1 (house render-phase reset). A **Clear filters** ghost button appears at the end of
the row only when something differs from the defaults.

Data: one call loads the whole list (~400 brands, server cap 1,000); search/filter/sort/paging run on the client,
so typing is instant. Changing Store refetches (counts change). 50 rows per page.

### 3.3 Columns
| Column | Content | Align | Width hint |
|---|---|---|---|
| Brand | 32px brand tile (section 5) + display name `0.85rem` 600 `--text-primary`; second line key in `ui-monospace` `0.74rem` `--text-secondary`. If an admin display name is set and differs from the automatic name, add `0.74rem` secondary text "auto: Cadbury Ltd" after the key. | left | ~260px |
| Spellings | Raw spellings seen on products, comma-joined, max 2 then "+N more" (`title` lists all). After them a neutral pill "+1 merged" when aliases exist. Under it, when look-alikes exist and none are merged yet: `0.74rem` `--warning-text` "2 look-alikes". | left | ~240px, ellipsis |
| Products | Active products in Product Master with any of this brand's spellings (incl. merged). `tabular-nums`. InfoTooltip on header: "Products in Product Master with this brand, in any store." | right | 90px |
| Wholesale at {store} | Number of item cards a retailer at that store sees (= app `itemCount`). `0` in `--text-secondary`. `-` for catch-alls (never shown). Header text truncated at 18 chars with full name in `title`. InfoTooltip: "Item cards a Haper Business buyer at this store sees for this brand right now (active, priced, in stock)." | right | 120px |
| Visibility | "Shown" plain `--text-secondary` text (not a pill: the normal case should not shout). **Hidden** = neutral pill with `EyeOff` 12px. **Catch-all** = neutral pill with `Lock` 12px. Pill recipe = house `StatusChip` (`color-mix` 40% border / 12% fill) with `--text-secondary`. | left | 100px |
| Last edited | `fmtDate(updatedAt)`; `-` when never edited. `title` = "by {name or email}". | right | 110px |
| (open) | `ChevronRight` 16 `--text-secondary`, sr-only header "Open". | - | 32px |

Row: whole row is the button (house `.vg-row`: `tabIndex 0`, Enter/Space opens, hover/focus `--accent-soft`
background + 2px accent focus ring). `aria-labelledby` = the name element.

Footer: left "403 brands - 41 with a logo" (counts for the current filter result); right house pager.

### 3.4 Narrow screens (< 900px viewport)
Hide Spellings and Last edited (`.br-col{display:none}`); show a sub-line under the key: "3 spellings - +1 merged
- edited 18 Nov" (`.br-sub`, house pattern). Table scrolls sideways inside the card if still too wide. The drawer
becomes full width below 600px.

---

## 4. Edit drawer

### 4.1 Shell
Right drawer, reusing the `WalletHistoryDrawer` shell: fixed overlay `rgba(0,0,0,0.45)`, `zIndex 200`, panel
`width: min(520px, 100vw)`, `height: 100vh`, `--bg-panel`, `border-left: 1px solid var(--border-color)`,
column flex. Three regions: sticky header, scrolling body (`padding 1rem 1.25rem`, sections separated by
`1px solid var(--border-color)` dividers, never by fill - light theme panel == card colour), sticky footer.
Opens with a 180ms slide from the right (`transform: translateX(16px)` + opacity, `ease-out`); reduced motion:
no slide, instant.

```
+--------------------------------------------------+
| [Ca] Cadbury                                 [X] |  header
|      cadbury - 45 products - 12 wholesale at Patna |
+--------------------------------------------------+
| ! Someone else changed this brand ...  [Reload]  |  banner slot (only when needed)
|--------------------------------------------------|
| NAME AND LOGO                                    |
|  +--------+   Display name                       |
|  |  [Ca]  |   [ Cadbury                     ]    |
|  | 96x96  |   Leave blank to use "Cadbury"       |
|  +--------+   (the most common spelling).        |
|  Cadbury      [Upload logo]  [Remove logo]       |
|  12 items     PNG or JPG, up to 5 MB. A square   |
|  app preview  or transparent PNG looks best.     |
|--------------------------------------------------|
| SPELLINGS                                        |
|  Seen on products (merge automatically)          |
|   Cadbury 40 - CADBURY 2                         |
|  Merged into this brand                          |
|   cadbbury   3 products  [New]          [Undo]   |
|   Cadbbury Dairy Milk 50 g, Cadbbury Gems ...    |
|  Possible duplicates                             |
|   [Cd] Cadburry   2 products  1 letter different |
|        Cadburry Bournvita 500 g, ...  [Merge in] |
|  Merge another brand                             |
|   [ (search) Search brands to merge in       ]   |
|--------------------------------------------------|
| VISIBILITY                                       |
|  Hide from Shop by brand                  [o  ]  |
|  Hidden brands don't appear in the brand strip,  |
|  All brands or brand search chips. Their items   |
|  stay in categories and search. Every store.     |
|--------------------------------------------------|
| Last edited by Priya S - 18 Nov 2026, 4:12 pm    |
+--------------------------------------------------+
| (error strip, if save failed)                    |
|                        [Cancel] [Save changes]   |  footer
+--------------------------------------------------+
```

Section titles: house small-caps style from PaymentOptionsCard (`0.8rem`, uppercase, `letter-spacing .04em`,
`--text-secondary`, `<h3>`). Body text `0.85rem`; helper text `0.76rem` `--text-secondary`.

### 4.2 Header
- 40px brand tile (live: reflects draft name/logo), name `1.05rem` 700, sub-line `0.78rem` `--text-secondary`:
  "{key} - {N} products - {M} wholesale at {store}". Key in monospace.
- Close X: `aria-label="Close"`, 44x44 hit area.

### 4.3 Name and logo
- **App preview** (left, 96px tile = the app's grid tile size): tile + name (2 lines max, ellipsis) + "{M} items"
  (`countLabel` rule: "1 item"/"N items"), caption "App preview" `0.72rem` secondary. Updates live as the name
  is typed or a logo is picked. Note for staff (helper under the field): the badge colour comes from the name, so
  renaming can change the colour - expected.
- **Display name**: text input, `maxLength 40`, placeholder = automatic name. Blank = automatic (the most common
  spelling, Phase 1 rule). Helper: `Leave blank to use "Cadbury" (the most common spelling).`
  Validation (on Save, inline under the field, `aria-describedby`):
  - must contain a letter or digit: "Use at least one letter or number."
  - non-blocking warning (amber `--warning-text`, does not block Save) when another visible brand already shows
    the same name (case-insensitive): `Another brand is also called "Amul". Buyers will see two "Amul" tiles.
    Merge it instead?` with a link button "Find it" that puts the name in the merge search box.
- **Logo**: buttons `btn('ghost')` "Upload logo" (or "Replace logo" when one exists) and "Remove logo"
  (only when a logo exists or is staged). Hidden `<input type="file" accept="image/png,image/jpeg">`.
  - No crop editor (decision 6). The preview tile shows exactly what the app will draw: white tile, logo fitted
    inside 12% padding, never cropped.
  - Client checks before staging: type PNG/JPEG else "Use a PNG or JPG file."; size <= 5 MB (backend
    `maxUploadFileSizeMb`) else "This file is {x} MB. Use one under 5 MB."; natural size < 200px on the long
    side -> non-blocking amber "This logo is small ({w} x {h} px) and may look blurry."
  - "Remove logo" stages removal: the preview goes back to the letter badge; Save sends `removeLogo: true`.
  - Logo saved = multipart with the rest of the save (like CategoryModal), not a separate upload.
- **BACKEND MUST (logo)**: `uploadAndProcessImages` re-encodes to JPEG with `sharp().jpeg()`, which turns
  transparent PNG pixels **black**. For the brand entity, flatten onto white first (`.flatten({ background:
  '#ffffff' })`) or keep PNG. The app tile is white, so flatten-to-white looks identical. Keep the uuid in the S3
  key (new URL per upload) so the app's image cache never shows the old logo.

### 4.4 Spellings
Three read areas + one picker, top to bottom:

1. **Seen on products** - raw spellings with product counts, inline: "Cadbury 40 - CADBURY 2". Helper: "Same
   letters with different capitals or spaces merge automatically." Read-only.
2. **Merged into this brand** (hidden when empty and nothing staged) - one row per alias:
   alias spelling (bold) - "{n} products" - up to 3 sample product names (`0.76rem` secondary, one line, ellipsis,
   full list in `title`) - action:
   - saved alias: ghost button **Unmerge** -> row stays, gets a pill **Will unmerge** (`--warning-text` on
     `--warning-soft`), text gets `text-decoration: line-through` on the spelling only, action becomes link
     **Undo**.
   - staged (not yet saved) alias: pill **New** (`--accent-text` on `--accent-soft`), action link **Undo**
     (removes it from the draft).
3. **Possible duplicates** (hidden when there are none and show the one-line empty copy instead) - look-alike
   brands that are not merged anywhere yet, max 5, sorted by similarity then product count. Each row:
   24px tile - spelling - "{n} products" - reason chip (neutral) - sample names line - button.
   Reasons (same rules as the Phase 0 report, one shared implementation on the backend):
   "Same without punctuation" (haldiram / haldiram's, p&g / pg), "1 letter different" / "2 letters different"
   (edit similarity >= 0.85), "Starts with the same words" (marico / marico ltd).
   Button: **Merge in** (`btn('ghost')`, 36px). If the candidate has MORE products than this brand, the row also
   shows `0.74rem` `--warning-text` "Bigger than this brand" and the button becomes **Merge into {Name}**
   (flow A2). Empty copy: "No look-alike spellings found. Search below if you know one."
4. **Merge another brand** - searchable combobox (visual = house `OwnerPicker` in `StoreModal.tsx`; add the
   a11y it lacks, section 8). Searches the already-loaded list (no network). Option row: 24px tile - name (bold)
   - "{n} products" - second line sample names. Picking an option stages it (row appears in area 2 with **New**).
   Options that cannot be merged stay in the list (reachable by arrow keys), `aria-disabled="true"`, 55% opacity,
   with the reason as the second line instead of sample names:
   | Case | Reason text |
   |---|---|
   | catch-all (generic, genric, na, n/a, unbranded, local, none, symbol-only) | "Catch-all name - can't be merged" |
   | already merged into another brand | "Merged into {Other} - unmerge it there first" |
   | has its own merged spellings | "Has its own merged spellings - unmerge those first" |
   | this brand itself | not listed |
   | this brand already has 20 merged spellings | input disabled, helper "A brand can have up to 20 merged spellings." |
   No-results copy: `No brand matches "xyz".`
   A manual pick (not from Possible duplicates) is marked in the staged row with a neutral pill "Picked by hand"
   so the preview dialog can ask for the extra check (4.6).

Catch-all brand opened (Generic etc.): drawer is read-only. Banner (neutral, `Lock` icon): "Catch-all names like
Generic are always hidden from Shop by brand. Their items stay in categories and search." Name, logo, picker and
switch are disabled; Spellings "Seen on products" still shows. Footer shows only **Close**.

### 4.5 Visibility
`Switch` (house component) in a 44px-tall row: label "Hide from Shop by brand", helper (`id`, wired via
`ariaDescribedBy`): "Hidden brands don't appear in the brand strip, All brands or brand search chips. Their items
stay in categories and search. Applies to every store." When the brand also has 0 wholesale items at the selected
store, add one more helper line: "Not in the app at {store} right now anyway (no wholesale items in stock)."

### 4.6 Save, preview and confirm
Footer (sticky, `1px` top border, `padding 0.9rem 1.25rem`): **Cancel** `btn('ghost')` and **Save changes**
`btn()`, both `minHeight 40`. Save is disabled (55% opacity, `not-allowed`) until the draft differs from the
loaded brand, and while saving (label "Saving...").

- Draft has **no new merges** -> save directly.
- Draft has **new merges** -> `ConfirmDialog` first, `zIndex={210}` (default 60 sits BEHIND the drawer's 200):
  - title: `Merge 1 spelling into Cadbury?` / `Merge 3 spellings into Cadbury?`
  - tone `default`; tone `warning` + `acknowledgeLabel="I checked these are the same brand, not two different
    brands."` when ANY new merge was picked by hand OR has 10+ products.
  - body (a small 3-column table, numbers right-aligned):
    ```
                              Products   Wholesale at Patna
    Cadbury (stays)              42            12
    + Cadbbury                    3             1
      Cadbbury Dairy Milk 50 g, Cadbbury Gems 20 g, Cadbbury 5 Star
    = Cadbury                    45            13
    ```
    then bullets:
    - "In the app, Cadbbury stops showing as its own brand. Its items show under Cadbury."
    - "Products are not edited. Product Master keeps the spelling it has."
    - "You can unmerge any time from this drawer."
    - only if an alias brand had its own logo/name/hidden setting: "Cadbbury's own logo and name are not used
      while it is merged."
    - only if an alias brand is hidden: "Cadbbury is hidden now. Its items will show under Cadbury."
  - confirm label **Merge and save**; Cancel returns to the drawer, draft intact.
- Success: `toast.success("Cadbury saved. Buyers see it within 5 minutes.")`, drawer closes, list refetches,
  the saved row gets a 1.2s `--accent-soft` background fade (none with reduced motion), focus returns to that row.
  Merged-away rows disappear from the list.

### 4.7 Last edited / audit
Line at the bottom of the body: "Last edited by {name or email} - {fmtDateTime}" or "Never edited - automatic
name and letter badge." Each successful save writes ONE row in the admin audit log:
`action: "brand.update"`, `target.displayName: <brand name>`, `before`/`after` = the overlay
(`displayName, hidden, logoUrl, aliases`), `metadata: { key, added: [...], removed: [...] }`.
Audit Log page: add `'brand.update': { label: 'Brand updated', color: '#38bdf8' }` to `ACTION_LABELS` and an
option "Brand updated" to the action filter (same hue as "Updated"; no new colour).

---

## 5. Brand tile in admin (same look as the app)

New shared piece `src/components/common/BrandTile.tsx` + pure `src/utils/brandBadge.ts`:
- `brandInitials(name)` and `brandColourSlot(name)` = exact ports of Android `BrandDisplay.initials` /
  `colourSlot` (`haper-android/.../ui/screens/brand/BrandDisplay.kt`): split on whitespace; 0 words -> "#";
  1 word -> first 2 code points, first upper, second lower; 2+ words -> first char of the first two words, upper.
  Slot = sum of code points of (lower-cased, whitespace-collapsed, trimmed) name, mod 8. Unit-test with the
  Android fixtures: "Amul" -> "Am", slot 7; "Ching's Secret" -> "CS"; "9am" -> "9a".
- Palette (constant in `brandBadge.ts`, same in both themes because the tile is a picture of the app tile):
  | slot | bg | initials | slot | bg | initials |
  |---|---|---|---|---|---|
  | 0 | #F5E3CD | #8A5A12 | 4 | #D5EDE9 | #20654E |
  | 1 | #D8EEE1 | #20654E | 5 | #F7EBCF | #8A5A12 |
  | 2 | #DCEAF3 | #1F332B | 6 | #E1E3F5 | #1F332B |
  | 3 | #FADEE4 | #1F332B | 7 | #F7E0EA | #1F332B |
  All >= 4.72:1 (from the app spec).
- `BrandTile({ name, logoUrl?, size })`: square, radius `round(size * 0.23)` (22 on 96, 7 on 32, 6 on 24, 9 on
  40), `box-shadow: inset 0 0 0 1px var(--border-color)` ring. Badge: initials 700, font-size `round(size * 0.30)`,
  `font-family: Quicksand, inherit` (admin falls back to Inter; colour and letters are what matter).
  Logo: white `#fff` background, `<img>` `object-fit: contain`, padding 12%. Show the badge while the logo loads
  and if it fails (no broken-image icon). Always `aria-hidden` (the name next to it is the label).
- Sizes: table 32, picker/suggestions 24, drawer header 40, app preview 96.

---

## 6. States (exact copy)

All panels reuse the house card patterns from `VariantGroupsList.tsx`. **Error text is never red**: errors use a
`--danger` border + `AlertTriangle` icon in `--danger` + copy in `--text-primary` (`--danger` #ef4444 as small
text is 3.76:1 on light and 4.13:1 on dark, below AA).

### List page
| State | What shows |
|---|---|
| Loading (first) | Header + filter card (controls enabled) + table card with sr-only "Loading brands..." and 8 skeleton bars 44px (house `.vg-skel` recipe: `background: var(--border-color)`, pulse 1.2s, static with reduced motion). |
| Updating (store change / after save) | Rows stay; top-right "Updating..." with `Loader2` (house fade-in indicator, `aria-live="polite"`). |
| Error | `role="alert"` card: **Couldn't load brands** / "Check your connection and try again." / ghost **Retry**. |
| Denied (403) | Card: **You do not have access to Brands** / "Only a super admin can manage brands." / ghost **Back to dashboard**. |
| Empty (no product has a brand) | Card: **No brands yet** / "Brands appear here once products have a Brand filled in Product Master." / ghost **Open Product Master** (`/products`). |
| No match (search) | **No brands match "xyz"** + ghost **Clear filters**. |
| No match (other filters) | **No brands fit these filters** + **Clear filters**. Special case Visibility = "In the app at this store": **No brands are in the app at Patna yet** / "A brand shows once this store has a wholesale item of it in stock." + **Clear filters**. |
| Flag off | Info strip above the table (neutral: `1px solid var(--border-color)`, `Info` icon `--accent-text`, `0.82rem`): "Shop by brand is off in the app right now. Changes here are saved and show up once it is on." Needs `shopEnabled` in the list response. |
| 0 wholesale everywhere (prod today) | Normal table; Wholesale column shows `0`. No special panel. |

### Drawer
| State | What shows |
|---|---|
| Opening | Instant: everything comes from the loaded list row. No spinner. |
| Draft clean | Save disabled. |
| Saving | Save "Saving..." disabled; Cancel, X, Esc disabled; inputs `disabled`. |
| Save failed (network/500) | Strip above the footer buttons (`role="alert"`, danger border): "Couldn't save. Your changes are still here." Save label becomes **Retry save**. |
| Stale (409 `BRAND_STALE`) | Banner at top of the body (warning: `--warning-soft` bg, `--warning-border`, `AlertTriangle` `--warning-text`, copy `--text-primary`): "Someone else changed Cadbury while you were editing. Reload to see their changes. Your edits here will be lost." Button **Reload** (refetches the list, re-seeds the drawer). Save stays disabled until reload. |
| Alias taken (409 `BRAND_ALIAS_TAKEN`, details `{ aliasKey, ownerName }`) | Same banner slot: "Cadbbury was just merged into Cadbury Dairy Milk by someone else." The staged row for that alias gets `--danger` border + inline "Already merged into Cadbury Dairy Milk." and its **Undo** link becomes **Remove**. Save re-enables once removed. |
| Alias not allowed (400 `BRAND_ALIAS_INVALID`) | Same treatment as alias taken with the server's reason line. |
| Brand gone (404 or key no longer in list after reload) | Banner: "This brand no longer has any products. It may have been renamed in Product Master." Button **Close**. |
| Denied (403 on save) | Banner: "Only a super admin can change brands. Your changes were not saved." Everything locked; footer **Close**. |
| Logo invalid / too big / small | Inline under the logo buttons (copy in 4.3). |
| Dirty close | ConfirmDialog (`zIndex 210`, tone danger): title "Discard changes to Cadbury?", body "Your changes haven't been saved.", confirm **Discard**, cancel **Keep editing**. |
| Catch-all | Read-only (4.4). |
| Possible duplicates empty | "No look-alike spellings found. Search below if you know one." |

Branch on `apiErrorCode(e)` / `apiErrorStatus(e)` (never on message text); fallback copy via
`apiErrorMessage(e, "Couldn't save.")`.

Disabled states (complete list): Save (clean / saving / stale / denied), picker input (20 aliases or catch-all),
disabled picker options (reasons above), every drawer control while saving, catch-all drawer controls.

---

## 7. What changes in the app, and how fast

| Admin change | Retailer app (Haper Business only) | Haper (retail) shop |
|---|---|---|
| Display name | Tile label, brand page title, search chip, home strip. Badge colour may change (it comes from the name). | Nothing |
| Logo added / replaced | Tile shows the logo everywhere; no app update needed (Phase 1 already switches badge -> logo). | Nothing |
| Logo removed | Back to the letter badge. | Nothing |
| Hide | Gone from strip, All brands and brand chips. Someone already on that brand page sees "Amul isn't available here" on next load. Items stay in categories and search. | Nothing |
| Merge | One tile, combined item count; the old spelling's tile disappears. | Nothing |
| Unmerge | The spelling comes back as its own brand. | Nothing |

Timing (state it exactly this way in the toast and help text): **"Buyers see it within 5 minutes."**
- Server: Phase 2 deletes the brand cache for every store after a save, so a fresh request gets the change at
  once. If that delete fails (Redis down), the 120s cache TTL still expires it.
- App: Android keeps the brand list in memory for 5 minutes; pull-to-refresh or reopening the app shows it right
  away. So "about 2 minutes" would be wrong for a buyer who already has the app open.

**Backend needs (for the screen above)** - final shapes are the backend engineer's call:
- `GET /admin/brand?storeId=` -> `{ shopEnabled, brands: [{ key, name, autoName, displayName|null, logoUrl|null,
  hidden, catchAll, spellings: [{ raw, products }], aliases: [{ key, products, samples[3] }], samples[3],
  products, wholesaleCount, lookalikes: [{ key, reason }], updatedAt|null, updatedBy|null, rev }] }`.
  Merged-away brands are NOT separate rows. Products and look-alikes come from the product master (all brands,
  not only wholesale), so the page is useful before wholesale stock exists.
- `PUT /admin/brand?key=` multipart: `rev, displayName, hidden, aliases[] (full list), removeLogo, images` ->
  409 `BRAND_STALE` / `BRAND_ALIAS_TAKEN` (details `aliasKey, ownerKey, ownerName`), 400 `BRAND_ALIAS_INVALID`
  / `BRAND_NAME_INVALID`, 403. Query param, not path (keys contain `&`, `'`, `/`, same reason as Phase 1).
- Search chips should also match merged spellings ("cadbbury" -> Cadbury chip). Confirm with backend.

---

## 8. Accessibility (WCAG 2.2 AA)

- **Contrast**: body `--text-primary`; secondary `--text-secondary` (4.83:1 light, 5.94:1 dark on panel);
  pills on `color-mix` fills keep the house values; `--warning-text` 7.09:1 light / 9.3:1 dark;
  `--accent-text` 6.29:1 light / 7.79:1 dark. No red small text (section 6). Badge pairs >= 4.72:1.
- **Targets**: rows >= 44px tall; drawer buttons >= 36px with >= 8px spacing (2.5.8 minimum is 24px); close X
  44x44; Switch row 44px.
- **Focus**: inputs in this page must NOT carry inline `outline: 'none'` (it beats `:focus-visible`); every
  control gets the house `2px solid var(--accent-primary)`, offset 2px.
- **Drawer**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` = header name. On open, focus the header
  name (`tabIndex -1`); Tab is trapped (same logic as ConfirmDialog); Esc = close (with dirty check) unless the
  picker listbox is open (then Esc closes the listbox only). On close, focus returns to the row that opened it.
- **Focus order in drawer**: Close -> Display name -> Upload logo -> Remove logo -> merged rows (Unmerge/Undo)
  -> suggestion buttons -> merge search -> Hide switch -> Cancel -> Save.
- **Combobox** (fixing OwnerPicker's gaps): input `role="combobox"`, `aria-expanded`, `aria-controls`,
  `aria-activedescendant`; list `role="listbox"`; options `role="option"`, disabled ones `aria-disabled="true"`
  (still reachable); Up/Down/Enter/Esc; highlighted option = `--accent-soft` background.
- **Labels**: suggestion button `aria-label="Merge Cadbbury into Cadbury, 3 products"`; Unmerge `aria-label=
  "Unmerge cadbbury"`; tiles `aria-hidden`; sortable state announced via the Sort select (no clickable headers).
- **Announcements**: staging a merge -> polite live region "Cadbbury added. Not saved yet."; save errors use
  `role="alert"`.
- **Reduced motion**: no drawer slide, no skeleton pulse, no row flash.

---

## 9. Component inventory

| Piece | Status | Notes |
|---|---|---|
| `PageHeader`, `card`, `btn`, `input`, `th`, `td` (`pages/Warehouse/ui.tsx`) | reuse | as VariantGroupsList |
| `Switch` (`components/common/Switch.tsx`) | reuse | Hide toggle |
| `ConfirmDialog` | reuse | merge preview (`acknowledgeLabel`, `tone`), discard, both `zIndex 210` |
| `InfoTooltip` | reuse | Products / Wholesale headers |
| `toast` (`stores/toastStore.ts`), `apiErrorMessage/Code/Status` | reuse | |
| `fmtDate`, `fmtDateTime` (`utils/date.ts`) | reuse | |
| WalletHistoryDrawer shell | copy the shell styles | no shared Drawer exists; do not extract one for this page |
| `BrandTile` + `brandBadge.ts` | NEW | section 5; unit tests with Android fixtures |
| `BrandsPage.tsx` (list) | NEW | `pages/Brands/`, scoped CSS prefix `.br-` |
| `BrandDrawer.tsx` | NEW | sections 4.1-4.7 |
| `BrandMergePicker.tsx` | NEW | combobox, section 4.4 |
| `api/brands.ts` + `types/brand.ts` | NEW | |
| `useMenu.ts`, `App.tsx`, `AuditLogList.tsx` | edit | sections 2, 4.7 |

No new CSS tokens. Only new hex values: the 8 badge pairs (copied from the app) and `#fff` logo tile.

---

## 10. Open questions (recommendation first)

1. **Merge preview always, extra checkbox only for risky merges?** Recommend YES: preview dialog for every merge;
   the "I checked these are the same brand" checkbox only when a spelling was picked by hand or has 10+ products.
   A checkbox on every merge becomes a reflex click.
2. **Toast timing "within 5 minutes" (not "about 2 minutes")?** Recommend YES: the server is fresh at once, but
   the Android app keeps the list for 5 minutes in memory. If the owner wants faster, shorten the app cache to 2
   minutes (Android change, separate decision).
3. **Show catch-all names (Generic, Genric, ...) in the list, read-only?** Recommend YES: staff otherwise ask
   "where did Generic go?". They cannot be renamed, merged or un-hidden here.
4. **Flatten transparent logos onto white on the server?** Recommend YES (simplest; the app tile is white). The
   alternative (keep PNG) needs a new upload path.
5. **Search chips match merged spellings?** Recommend YES, so a buyer typing the old spelling still finds the
   brand. Backend to confirm.
6. **"View products" link from the drawer to Product Master filtered by spelling?** Recommend LATER: the 3 sample
   names cover the merge decision; the link needs Product Master to read `?search=` from the URL.
