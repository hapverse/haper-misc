# Design spec — product `thumbnail` (card image) across clients + admin

Status: spec ready for build.
Author: chanchal (design). Targets: tanmoy-web (haper-web + haper-admin), siddhart-android, setu-ios.
Scope: home/listing card image source, admin thumbnail upload slot, fallback behaviour.
Explicitly NOT in scope: item-detail carousel behaviour (see §7), background removal, any
change to the `images` array itself.

> File location note: the briefing suggested `haper-misc/design/product-thumbnail-spec.md`.
> This repo's settled convention is flat `haper-misc/<feature>-design.md` (e.g.
> `design-admin-image-editor.md`, `free-gift-design.md`, `discounts-admin-ui-design.md`) —
> there is no `design/` subfolder in use, so this doc follows the existing convention.

---

## 1. Problem / job-to-be-done

**Customer's job:** scanning a grid of 40+ small cards, recognise the product in under a
second and tap the right one.

**Today** every card image is `images[0]` — the first photo of a gallery shot for the
detail screen. Those photos are framed for a 280–302pt hero: lots of dead margin, sometimes
a lifestyle/pack-back shot, sometimes a wide bottle that shrinks to nothing inside a 94dp
well. The card well renders it with `object-fit: contain` / `ContentScale.Fit`, so the
product ends up small, off-centre and inconsistent card-to-card. The convention is even
written into the admin UI today: ItemModal's label literally says *"first image is the
thumbnail"* (`ItemModal.tsx:741`) and the backend repository comment says *"First entry is
the canonical thumbnail (mobile clients read images[0])"* (`item.repository.js:1190`).

**Fix:** a separate admin-curated `thumbnail` — one square, tightly-cropped image whose only
job is to be legible at 60–100dp. `images` keeps doing its job on the detail screen,
unchanged.

**The hard constraint:** on day 1, ~0% of the catalogue will have a thumbnail, and curating
thousands of SKUs takes months. So the fallback is not an edge case — **the fallback IS the
default experience for a long time**, and it must be visually indistinguishable from today.
That drives every decision below.

---

## 2. Current state (verified in code, 2026-09-07)

| Surface | File | Image source today | Well / render |
|---|---|---|---|
| Web home/listing card | `haper-web/components/ProductCard.tsx` | `product.image`, derived in `services/mappers.ts:6-8` as `images[0]` | `h-40 w-full`, `p-4`, `object-contain`, `mix-blend-multiply` (light) / `mix-blend-normal` (dark), `group-hover:scale-105` |
| Web mapper | `haper-web/services/mappers.ts` | `mainImage = allImages[0] \|\| ''` | — |
| Android grid card | `haper-android/.../ui/components/ProductCard.kt:209` | `item.images?.firstOrNull()` | well `102dp` (home) / `96dp` (aisle), radius 20dp, photo capped `94dp`/`88dp`, `ContentScale.Fit`, `.multiplyBlend()` |
| Android rail card | `.../ui/components/ProductRailCard.kt:104` | `images.firstOrNull()` | well `66dp`, radius 16dp, photo cap `58dp` |
| Android list row | `.../ui/components/HaperItemRow.kt:112` | `images.firstOrNull()` | `64dp` square, radius 18dp, 7dp inset |
| Android cart row | `.../screens/cart/CartScreen.kt:811` | `images.firstOrNull()` | small square |
| Android orders | `.../screens/orders/OrdersScreen.kt:408`, `OrderDetailScreen.kt:773`, `support/CustomerSupportScreen.kt:398` | `images.firstOrNull()` | small square |
| iOS card | `haper-ios/haper/Components/HaperProductCard.swift:43` | `item.images?.first` | well `priceStyle.wellHeight`, photo cap `photoMax` (82pt), `scaledToFit`, `.blendMode(.multiply)` |
| iOS search row | `Views/SearchView.swift:327` | `item.images?.first` | small square |
| iOS cart row | `Views/CartView.swift:97` | `product.images?.first` | small square |
| Backend admin lookup projections | `packages/shared/repositories/item.repository.js:594, 630` | `image: it.images[0] ?? null` | — |

Admin:
- `haper-admin/src/pages/Products/ProductModal.tsx` — master product form. `images: string[]`,
  upload picks files → `startEditQueue` → `ImageEditorModal` one at a time → **uploads
  immediately** via `productApi.uploadImage(files)` and appends returned URLs. Also supports
  paste-a-URL.
- `haper-admin/src/pages/Items/ItemModal.tsx` — per-store item form. `MAX_IMAGES = 3`,
  `keptImages` (already on server) + `imageFiles`/`imagePreviews` (staged), **uploaded on
  Save** as multipart. `editQueue` + `reEditIndex` drive `ImageEditorModal`; a staged (not
  yet uploaded) thumb is clickable to re-edit; a kept/server image is remove-only.
- `haper-admin/src/components/ImageEditorModal.tsx` — 551 lines, `react-easy-crop`, props
  `{ isOpen, file, onCancel, onApply }`. Crop (1:1 default, "Free" = source natural aspect),
  90° rotate, brightness/contrast −50..+50, canvas bake to `image/jpeg` on Apply. Focus lands
  on Cancel; Esc/backdrop = cancel; loading/error/applying states already built.
- `haper-admin/src/pages/Products/productForm.ts` — `MASTER_DISPLAY_KEYS` = the display fields
  the master owns; a store admin editing an item gets them disabled (`displayLocked`).
  `images` is not in that list but the image uploader is already gated behind `!displayLocked`.

Backend: `products.schema.js` has `images: [String]`; `items.schema.js:64` carries the
denormalised copy that clients read.

---

## 3. Data / contract requirements (UI's dependency — owner: backend + arijit-frontend-arch)

Design cannot ship without these; stated as requirements, not as a design decision:

1. `thumbnail: { type: String, default: "" }` on **both** `products.schema.js` (master, source
   of truth) **and** `items.schema.js` (denormalised copy), fanned out on master edit exactly
   like the other shared display fields.
2. `thumbnail` added to every **client-facing** projection that already returns `images`
   (home feed, category/aisle listing, search, cart hydrate, order items). If a listing
   endpoint returns `images` but not `thumbnail`, that whole surface silently falls back
   forever and nobody notices.
3. **Nullable / always-emitted, never required.** Missing key must decode as null on Android
   (Gson ignores Kotlin defaults — project memory `android_gson_kotlin_defaults`). Default
   `""` server-side.
4. `thumbnail` joins `MASTER_DISPLAY_KEYS` in `productForm.ts` (it is a shared catalogue field —
   one product must not look different store to store) and the equivalent backend
   `MASTER_DISPLAY_FIELDS` gate.
5. Same S3 upload pipeline and same `sharp` auto-orient/resize/compress as `images` — no new
   media pipeline. Path stored the same relative way, resolved with the same
   `itemsImageBaseURL` / `resolveMediaUrl`.

---

## 4. Home / listing card thumbnail

### 4.1 The fallback rule (the load-bearing decision)

**One resolver, three tiers, same order on every platform and every small-image surface:**

```
1. thumbnail        — non-empty string          → use it
2. images[0]        — non-empty first element   → use it
3. placeholder      — local built-in asset      → use it
```

Written as pseudo-code the engineers can mirror per platform:

```
resolveCardImage(item):
    if item.thumbnail is non-blank: return base + item.thumbnail
    if item.images is non-empty and item.images[0] is non-blank: return base + item.images[0]
    return null            // caller renders the local placeholder
```

Decisions baked into that rule, with reasons:

- **Silent fallback. The customer is never told a thumbnail is missing.** No badge, no
  different border, no "image pending". A missing thumbnail is our catalogue-ops problem, not
  a product attribute. On day 1 this makes the card pixel-identical to today → zero perceived
  regression, and the catalogue visibly improves card-by-card as curation lands.
- **Tier 2 is `images[0]`, not "no image".** `images[0]` is *already* the de-facto thumbnail
  (see the code comments quoted in §2), so tier 2 is literally today's behaviour. Choosing a
  placeholder over `images[0]` would be a massive regression for months.
- **Never fall back the other way.** The detail carousel must NOT start reading `thumbnail`
  as an extra gallery slide (except the §6.1 zero-images case) — a card-cropped image looks
  bad blown up to 300dp.
- **Blank string counts as absent.** Backend default is `""`, and admins delete images; treat
  `null`, `""` and whitespace-only identically. This is the single most likely implementation
  bug — a `!= null` check passes on `""` and renders a broken-image icon.
- **A 404/decode failure on tier 1 does NOT cascade to tier 2 at runtime.** Do not chain
  loaders — a failed `thumbnail` load goes straight to the placeholder. Reason: chained
  retries double the network requests on every card in a 40-card grid to rescue a rare
  data-integrity bug; fix the data instead. (Exception: web's existing `onError` handler stays,
  see §4.4.)
- **One function per platform, used by every small-image surface**, not copy-pasted per card:
  web in `services/mappers.ts` (fill `Product.image` from the resolver — every consumer then
  gets it for free with zero card-component changes), Android as a single extension/util used
  by `ProductCard`, `ProductRailCard`, `HaperItemRow`, cart and order rows, iOS the same as a
  computed helper. Exact placement/ownership is arijit-frontend-arch's call; the requirement
  from design is that **there is exactly one of them per platform**.

**Web gets this nearly free:** change `mappers.ts:6-8` from `allImages[0]` to the resolver.
`ProductCard.tsx` needs no change except the placeholder (§4.4).

### 4.2 Aspect ratio and sizing — **1:1 square**

The stored thumbnail is a **square (1:1)**. Rendering is unchanged: it still goes into the
existing wells with `contain` / `Fit`, never `cover`.

Why 1:1:
- Every admin render site in the app is already a square `object-fit: cover` thumb, and
  `ImageEditorModal` already defaults to a locked 1:1 crop (established in
  `design-admin-image-editor.md` §8) — one shape across the whole system.
- Card wells are near-square already (Android 102dp tall well with a 94dp photo cap; iOS
  82pt cap; web `h-40` with `p-4`). A square source fits all three with no letterboxing
  decisions per platform.
- Non-square would have to be honoured by *some* platform's `Fit`, which just reintroduces
  the dead-margin problem we're fixing.

Because the well renders `Fit`, the crop must not be edge-to-edge:

> **Curation guidance (goes in the admin helper text, §5.3):** crop square, product centred,
> filling roughly 85–90% of the frame, on a plain white background. Leave a thin margin so the
> product doesn't touch the well's edge. No lifestyle/scene shots, no packaging back, no text
> overlays or price stickers.

Output: whatever the editor bakes; the backend's existing 800×800 `sharp` resize normalises
it. No new pixel-size contract.

Background: **white, not transparent.** Android and iOS multiply-blend the photo onto the
white well (`.multiplyBlend()`, `.blendMode(.multiply)`), and web uses `mix-blend-multiply`
in light mode but `mix-blend-normal` in dark. A white-ground JPEG is what all four render
paths are tuned for today; transparency is a separate (deferred) project.

### 4.3 Loading state — skeleton, not spinner

Card image wells are small and appear 40 at a time; spinners in that many cells read as
chaos.

- **Web:** the well already has `bg-gray-50 dark:bg-gray-900`. Add a neutral shimmer/pulse on
  the well while the image is loading, fading to the image on load (`opacity` transition
  150ms `ease-out`). No layout shift — the well is a fixed `h-40`, so the image arriving must
  never resize the card.
- **Android:** Coil `placeholder`/`loading` slot = flat `SurfaceWhite` well with a subtle
  neutral shimmer; keep the existing well border and radius so nothing pops in.
- **iOS:** `CachedAsyncImage`'s placeholder is currently `Color.clear` (`HaperProductCard.swift:166`)
  — replace with the same neutral shimmer block. Detail view's `ProgressView` spinner may stay
  (one big hero, not a grid).
- Respect reduced-motion: shimmer becomes a static neutral fill.

### 4.4 Placeholder (tier 3) — one local asset, three platforms

Today the three clients disagree, and one of them is a real bug:

- Web: `onError` swaps in **`https://via.placeholder.com/150?text=No+Image`** — an *external
  third-party* request per broken image. It fails offline, adds a third-party dependency to
  every catalogue page, and leaks a request. **Remove it.**
- Android: renders *nothing* — an empty white well, which reads as "still loading, forever".
- iOS: renders nothing on the card; the detail view shows an SF `photo` glyph.

**Spec: one local, bundled placeholder, identical in intent on all three.**

```
┌──────────────────────┐
│                      │   well background: existing well fill
│         ▢            │   centred glyph, ~32% of well height
│      (image /        │   colour: text-tertiary / muted foreground
│       basket icon)   │   NO text label
│                      │
└──────────────────────┘
```

- Glyph only, **no "No image" text** — the product name sits directly below the well and
  already tells the user what it is; a text label just adds noise 40 times a screen.
- Colour: the platform's tertiary/muted foreground at ~40% opacity against the well fill —
  must stay ≥3:1 against the well in both themes (it is a meaningful, non-decorative
  indicator).
- Web: `lucide-react` `ImageOff` (already a dependency); Android: existing catalogue/basket
  vector; iOS: SF Symbol `photo` (already used on the detail view) — keep the same glyph family
  the platform already uses rather than shipping a new bitmap.
- The card is otherwise **fully functional**: name, price, Add button all render and work. A
  missing image never disables add-to-cart.
- `alt` / `contentDescription`: still the **product name** (the image slot conveys "this is
  product X"); the placeholder itself is not separately announced.

### 4.5 Card layout — unchanged

No card geometry changes. Web `h-40` well, Android 102/96dp wells with 94/88dp photo caps,
iOS `wellHeight`/`photoMax`. Discount wedge, veg mark, Add/stepper control, low-stock line,
price row: all untouched. **The only change is where the image URL comes from**, plus the
loading and placeholder states above. Keeping the layout frozen is deliberate — it makes this
change reviewable and reversible.

---

## 5. Admin thumbnail upload UX

### 5.1 Where it lives

**Primary home: `ProductModal.tsx` (Product Master).** The thumbnail is a shared catalogue
attribute — one product must look the same in every store — so it belongs where `name`,
`brand`, `weight` and `images` already live, and fans out with them.

**Secondary: `ItemModal.tsx`.** Same field, same component, but gated by the existing
`displayLocked` (`isEdit && !isSuperAdmin`): a store admin sees the thumbnail **read-only**
with the "Managed in Product Master" convention already used by the Barcode field; a super
admin can edit it. Add `'thumbnail'` to `MASTER_DISPLAY_KEYS`.

**Position within the form: directly ABOVE the existing Images field**, as its own labelled
field. Reasons: it is the more important image (it is what 99% of customers ever see); putting
it after a 3-thumb gallery row buries it; and the visual adjacency makes the relationship
("this one is the card, those are the gallery") obvious without explanation.

### 5.2 The slot — layout

```
Card thumbnail                                    [ Using first image ]   ← status chip, right-aligned
┌──────────┐
│          │   Shown on home, search and cart cards.
│    +     │   Square crop, product centred, plain white background.
│  Upload  │   ← 96×96 dashed dropzone when empty
│          │
└──────────┘

— when set —

Card thumbnail
┌──────────┐  ⓧ         Replace   Remove
│ ▓▓▓▓▓▓▓▓ │            ← text buttons, right of the preview
│ ▓ img  ▓ │   Click the image to re-edit crop / brightness.
│ ▓▓▓▓▓▓▓▓ │
└──────────┘

Images  (2/3 · shown on the product detail screen)     ← existing field, label reworded
[ existing 72px thumb row + dashed upload dropzone ]
```

- Empty slot: `96×96`, `border: 2px dashed var(--border-color)`, `var(--radius-md)`,
  `background: var(--bg-secondary)`, centred `Upload` icon (`lucide-react`, already imported)
  + "Upload" at `0.72rem` `var(--text-secondary)`. Same dashed-dropzone language as ItemModal's
  existing images dropzone, just square and single-slot.
- Filled slot: `96×96` preview using the existing `thumbWrapStyle` / `imgThumbStyle` +
  `thumbRemoveBtnStyle` (the `var(--danger)` circular ⓧ) so it matches the Images row exactly.
  Slightly larger than the gallery's 72px — it is the more important one, and hierarchy should
  say so.
- **Locked (store-admin) state:** preview only, no ⓧ, no Replace/Remove, `opacity: 0.6`, with
  the existing helper line "Managed in Product Master (super admin)." — reuse the Barcode
  field's exact copy and styling.
- Helper text under the label, `0.7rem` / `var(--text-secondary)`, always visible (not a
  tooltip): *"Shown on home, search and cart cards. Square crop, product centred on a plain
  white background."*

### 5.3 Status chip — the curation signal

Right-aligned on the field's label row, `0.68rem`, pill, `var(--radius-sm)`:

| Condition | Chip | Colours |
|---|---|---|
| `thumbnail` set | *(no chip)* | — |
| No thumbnail, `images[0]` exists | **Using first image** | bg `var(--bg-secondary)`, text `var(--text-secondary)`, 1px `var(--border-color)` |
| No thumbnail, no images | **No card image** | text `#d97706` on a 12%-alpha tint (the established warning hex — there is still no `--warning` token; see the gift-tier convention) |

This is the only place the fallback is ever *surfaced*, and it's for the admin, not the
customer. It answers "does this product still need work?" without a separate report.

**Recommended, small, optional:** the same two chips (or just a dot marker) on the
`ProductsList` / `ItemsList` row thumbnail, so a merchandiser can eyeball a page and see
what's left. A "Thumbnail: missing" filter is genuinely useful for bulk curation but is
scope-creep for v1 — flag it as a Phase 2 ask rather than sneaking it in.

### 5.4 Flow

1. Admin opens Product Master → a product → Edit. Form renders with the thumbnail slot in
   whatever state §5.3 describes.
2. Admin clicks the empty slot (or **Replace**) → OS file picker (`accept="image/*"`,
   **`multiple` OFF** — one slot, one file).
3. `ImageEditorModal` opens on top, **aspect locked to 1:1**, title "Edit thumbnail". Admin
   crops/rotates/adjusts.
4. **Use this photo** → editor bakes and hands back the `File`.
   - *In ProductModal*, matching its existing behaviour: upload immediately via the same
     `productApi.uploadImage` pipeline, set `form.thumbnail` to the returned URL, slot switches
     to the filled state.
   - *In ItemModal*, matching its existing behaviour: stage the `File` + object URL, upload on
     Save with the rest of the multipart payload.
5. **Cancel / Esc / backdrop** → nothing staged, file input cleared so re-picking the same file
   re-fires `onChange` (identical to the existing editor contract).
6. Clicking a **staged (not yet uploaded)** thumbnail preview re-opens the editor on the last
   applied result — same `reEditIndex` semantics as the gallery, just a single boolean instead
   of an index. An **already-uploaded** thumbnail is remove-and-re-upload only (unchanged v1
   scope from `design-admin-image-editor.md` §3.7).
7. **Remove** → clears the field (in ProductModal, sends an empty `thumbnail` on Save so the
   backend unsets it). No confirm dialog: it is instantly reversible by re-uploading, nothing
   is destroyed downstream, and the card silently falls back to `images[0]`. A confirm here
   would be friction without safety.

### 5.5 REUSED as-is vs NEW — exact list

**Reused with zero changes:**
- `ImageEditorModal`'s entire editing surface: crop box, 90° rotate buttons, brightness and
  contrast sliders (−50..+50), Reset, canvas bake to `image/jpeg`, `filterFor` preview/bake
  parity, loading / error / applying states, focus-to-Cancel on open + focus restore, Esc and
  backdrop handling, z-index-410 modal-over-modal stacking.
- Its existing props `{ isOpen, file, onCancel, onApply }` — the parent wiring is the same
  shape, just a single slot instead of a queue.
- The 1:1 crop *default* — already the component's default, so the locked mode is a
  restriction, not a new behaviour.
- The S3 upload pipeline (`productApi.uploadImage` / ItemModal's multipart), the backend
  `sharp` auto-orient + 800×800 + compress, `resolveMediaUrl`.
- `thumbWrapStyle`, `imgThumbStyle`, `thumbRemoveBtnStyle`, `labelStyle`, `fieldStyle(locked)`,
  the dashed-dropzone treatment, and the inline-style-over-CSS-vars convention.

**NEW — deliberately as small as possible:**
1. **One optional prop on `ImageEditorModal`**, e.g. `aspectLock?: 'square'` (undefined =
   today's behaviour). When set: force `aspectMode='square'` and **do not render the 1:1 / Free
   segmented control at all** (hide it — never show a control that can't do anything). Nothing
   else about the component changes.
2. **One optional `title?: string` prop** (default `"Edit photo"`), passed `"Edit thumbnail"`
   from the slot, so the admin knows which image they're editing when both fields exist on the
   same form.
3. Single-slot state in each parent: `thumbnailFile` / `thumbnailPreview` / `thumbnailUrl` +
   a `thumbnailEditing` boolean (replacing the queue/index machinery for this field).
4. The thumbnail field UI itself (§5.2) — slot, Replace/Remove, helper text, status chip.
5. `'thumbnail'` added to `MASTER_DISPLAY_KEYS` and the ItemModal locked-field treatment.
6. **Copy change:** ItemModal's Images label loses *"first image is the thumbnail"*
   (`ItemModal.tsx:741`) and becomes *"(2/3 · shown on the product detail screen)"*. Leaving the
   old text in place would actively contradict the new field and is the single most likely
   source of admin confusion.

**Explicitly NOT new:** no free-angle rotate, no filters, no multi-thumbnail, no per-store
thumbnail override, no auto-generate-from-images[0] button, no bulk tool. (An auto-crop /
bulk-generate tool is the obvious next ask — it needs its own spec and its own quality
review, and shipping it inside this change would remove the human eye that makes a curated
thumbnail worth having.)

### 5.6 Admin states

| State | Treatment |
|---|---|
| Loading (form fetching) | Existing modal skeleton/disabled-field behaviour; slot renders as a neutral 96px block, not the dashed dropzone (avoids "empty" flashing before data arrives) |
| Empty | Dashed 96px dropzone + chip per §5.3 |
| Uploading (ProductModal) | Slot shows the preview at `opacity 0.5` with a centred `Loader2` + `.spin` (the pattern already used for `uploading`); Save disabled while in flight |
| Applying (editor bake) | Existing editor "Applying…" spinner — unchanged |
| Success | Preview appears, chip disappears, brief `toast.success("Thumbnail updated.")` on save — reuse the existing toast convention |
| Error (upload fails) | Slot returns to its previous state (nothing half-staged) + `toast.error(apiErrorMessage(e, 'Failed to upload thumbnail.'))` — matches the existing image-upload error path exactly. Error must never look like "empty": the chip stays whatever it was |
| Error (file won't decode) | Editor's existing inline "Couldn't open this image. Try a different file." |
| Disabled / locked | Store admin on an existing item: preview only, `opacity 0.6`, "Managed in Product Master (super admin)." |

---

## 6. Edge cases — every combination

| # | Data | Card (home/search/cart) | Detail screen | Admin |
|---|---|---|---|---|
| 1 | thumbnail + images | thumbnail | `images` carousel (unchanged) | preview, no chip |
| 2 | **no thumbnail + images** *(the common case for months)* | `images[0]` — pixel-identical to today | `images` carousel (unchanged) | gallery-first preview + **"Using first image"** chip |
| 3 | **thumbnail, no images** | thumbnail | **carousel renders `[thumbnail]` as its single slide** (see §6.1) | preview, no chip |
| 4 | **neither** | placeholder glyph (§4.4); card otherwise fully functional | existing empty treatment: iOS SF `photo` glyph; Android + web currently render an empty well → give them the same §4.4 placeholder at hero size | dashed empty slot + **"No card image"** amber chip |
| 5 | thumbnail is `""` / whitespace | treat as absent → row 2 or 4 | — | treat as empty |
| 6 | thumbnail URL 404s / fails to decode | placeholder (no cascade to `images[0]` — §4.1) | — | broken preview + Remove available |
| 7 | Admin removes the last gallery image, thumbnail still set | thumbnail (unaffected) | falls to case 3 | fine |
| 8 | Admin removes the thumbnail | falls back to `images[0]` silently, next render | unchanged | chip flips back to "Using first image" |
| 9 | Store admin's item row is stale mid-fan-out | shows the old thumbnail until the fan-out lands — acceptable, same as every other master display field today | — | — |

### 6.1 Case 3 is the one exception to "never use thumbnail on detail"

If `images` is empty but a thumbnail exists, the detail carousel shows `[thumbnail]` as a
single non-swipeable slide (no dots) rather than an empty hero. Rationale: a square card crop
scaled to a 300dp hero is imperfect but is unambiguously better than a blank screen on a page
where the customer has already committed enough interest to tap through. This is a
**fallback-only** rule — the moment `images` is non-empty, `thumbnail` never appears on the
detail screen.

---

## 7. Item detail carousel — confirmation, and one correction

**This spec changes nothing about the item detail image carousel** (other than the case-3
fallback in §6.1 and the case-4 placeholder). It keeps reading the `images` array.

Read from the code today:

- **Android** — `ItemDetailScreen.kt:378-460`: Compose `HorizontalPager` over
  `currentItem.images`, 302dp hero on the app surface, multiply-blended, 8dp dot row shown only
  when `images.size > 1`. **Manual swipe only.**
- **iOS** — `ItemDetailView.swift:33-58`: SwiftUI `TabView` with
  `.tabViewStyle(.page(indexDisplayMode: images.count > 1 ? .automatic : .never))`, 300pt frame,
  `ProgressView` placeholder, SF `photo` glyph when there are no images. **Manual swipe only.**
- **Web** — `pages/ProductDetail.tsx:76-120`: a large selected image plus a clickable thumbnail
  strip when `images.length > 1`. **Click-to-select, no swipe, no auto-advance.**

> ⚠️ **Correction to the briefing.** The brief describes the detail carousel as "auto-rotating
> AND manually swipeable". As of 2026-09-07 **none of the three clients auto-rotates** — there
> is no timer/`LaunchedEffect` advancing the pager on Android, no auto-advance on iOS, and web
> isn't a swipe carousel at all. All three are manual-only. Nothing here is broken; the
> description is just out of date. If auto-rotation is actually wanted, it is a **separate
> feature request** with its own accessibility requirements (pause on interaction, honour
> reduced-motion / "Prefers Cross-Fade Transitions", never auto-advance while a screen reader
> is focused inside it) — it should not be smuggled into this change. Flagging to the PM
> rather than silently designing it.

---

## 8. Interaction and motion

- Image fade-in on load: `opacity 0 → 1`, **150ms `ease-out`**. No scale/slide — 40 cards
  animating on scroll is noise.
- Web card hover: existing `group-hover:scale-105 duration-300` on the image — unchanged.
- Admin slot hover: dropzone border `var(--border-color)` → `var(--accent-primary)`, background
  `var(--bg-secondary)` → 8%-alpha accent tint, 120ms. Filled preview hover: 1px accent ring +
  `cursor: pointer` with `title="Click to re-edit"` — mirrors the gallery thumb's existing
  affordance.
- Press feedback: platform default (web active state, Android ripple, iOS highlight) —
  unchanged.
- No optimistic UI for the upload itself: ProductModal uploads immediately and the preview
  appears on success; showing a preview that can silently fail to persist is worse than a
  200ms spinner.
- Reduced motion: shimmer → static fill, fade-in → instant, hover scale suppressed.

---

## 9. Accessibility

- **Card image `alt` / `contentDescription` = the product name** (unchanged today, and the same
  in the placeholder state). Do not use "product image" or the filename.
- The card image is inside the card's tap target; the Add/stepper control keeps its own
  `aria-label` and stays a separate ≥44×44 (web/iOS) / ≥48×48dp (Android) target. Unchanged.
- Admin: the slot is a real `<label>`+`<input type="file">` (keyboard-focusable, Space/Enter
  opens the picker) — not a `<div onClick>`. Visible focus ring: 2px `var(--accent-primary)`,
  2px offset.
- Focus order in the admin form: label → slot → Replace → Remove → Images field. Opening the
  editor moves focus into the dialog and returns it to the slot on close (the component already
  does the save/restore).
- Buttons: "Replace" / "Remove" need accessible names that include the field —
  `aria-label="Replace card thumbnail"` / `"Remove card thumbnail"` — because "Remove" appears
  twice on the form once the gallery is present.
- The status chip is text, not colour-only: "Using first image" / "No card image" read fine
  in greyscale. The amber `#d97706` on its tint must clear **4.5:1** in both admin themes —
  verify, don't assume (the admin's light-mode `--bg-panel` equals `--bg-secondary`, so a tinted
  chip can lose its separation there; add a 1px border if it does).
- Placeholder glyph ≥3:1 against the well fill in both light and dark.
- No information is conveyed by the image alone — every card already carries the name, weight
  and price as text.

---

## 10. Handoff notes per platform

| Platform | Work |
|---|---|
| **tanmoy-web (haper-web)** | `mappers.ts` resolver (`thumbnail` → `images[0]` → null); `types.ts` `ItemModel.thumbnail?: string`; `ProductCard.tsx` — delete the `via.placeholder.com` `onError`, add the local placeholder + shimmer. Verify with `tsc --noEmit` + `vite build` (no eslint gate in this repo). |
| **tanmoy-web (haper-admin)** | `ImageEditorModal` gets `aspectLock` + `title` props; thumbnail slot in `ProductModal` + `ItemModal`; `MASTER_DISPLAY_KEYS`; ItemModal images-label copy fix. `tsc -b` + eslint, and the Vitest baseline stays at exactly its 5 known-failing `OrderDetailsModal` tests. |
| **siddhart-android** | `HomeModels.kt` + `OrderModels.kt`: `val thumbnail: String? = null`; one resolver util; wire `ProductCard`, `ProductRailCard`, `HaperItemRow`, `CartScreen`, `OrdersScreen`, `OrderDetailScreen`, `CustomerSupportScreen`; Coil placeholder shimmer; hero placeholder for case 4. `./gradlew assembleDebug`. |
| **setu-ios** | `Item` model `thumbnail: String?`; one computed resolver; wire `HaperProductCard`, `SearchView`, `CartView`; replace `Color.clear` placeholder with the shimmer; keep `ItemDetailView` as-is apart from §6.1. |
| **arijit-frontend-arch** | Owns where the resolver lives per platform and whether it belongs in the mapper layer vs the view layer. Design's only requirement: exactly one per platform. |
| **Backend** | §3. New field must be nullable/defaulted and present in every client projection that already returns `images`. |
| **Docs** | A matching `haper-misc/test-product-thumbnail.md` walkthrough is required in the same session as the build (project rule): ✅/❌ steps for each of the nine §6 rows. |

## 11. Sign-off

| Item | Decision needed from | Status |
|---|---|---|
| Silent fallback (no customer-facing "missing thumbnail" signal) | PM | pending |
| 1:1 square crop, locked (no Free toggle for thumbnails) | PM / catalogue ops | pending |
| Thumbnail is master-owned (store admins can't override per store) | PM | pending |
| Removing the `via.placeholder.com` external dependency on web | tanmoy-web | pending |
| Detail carousel is manual-only today — auto-rotate is a separate ask (§7) | PM | **needs a decision** |
| Products-list "missing thumbnail" filter deferred to Phase 2 | PM | pending |
