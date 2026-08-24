# Design Spec — Coupon Codes: Admin CRUD + POS Coupon Entry

Author: Chanchal (designer) · Date: 2026-08-24
Status: Spec for TODAY's ship (backend + admin, direct to prod per the plan). Feeds from
`haper-misc/coupon-codes-plan.md` §5 (API contract, authoritative) and §6 steps 13-15 (admin build
order). This doc does not repeat money/concurrency semantics — only how the admin/cashier interacts
with them.

Audience: tanmoy-web (implements in `haper-admin`, React/TypeScript, no build-time CSS framework —
inline `CSSProperties` + `Warehouse/ui.tsx` shared primitives, same convention `NewSalePage.tsx` and
`Discounts/*` already use).

Precedent read before writing this spec: `pages/Discounts/{DiscountsPage,DiscountRuleFormModal,
BelowCostConfirmModal}.tsx` (direct structural precedent per the brief), `pages/POS/NewSalePage.tsx`
(full file — cart, customer phone/name capture, payment, complete() flow), `pages/Warehouse/ui.tsx`
(`card`, `btn`, `input`, `PageHeader`, `errMsg` shared primitives used by POS), `pages/Config/
configTime.ts` (`istInputToUtcIso`/`utcIsoToISTInput`), `components/common/SegmentedToggle.tsx`,
`components/common/ConfirmDialog.tsx`, `hooks/useMenu.ts`, `constants/permissions.ts`.

---

## 0. Two screens, one shared vocabulary

Both screens speak the same coupon vocabulary (code, scope, discount, window, limits) so a store
admin who's seen the Coupons list recognizes the same shapes on POS. Screen 1 is the authoring
surface (super_admin only). Screen 2 is the redemption surface (any admin with POS access, walk-in
sale). Nothing about their visual language is new — Screen 1 clones Discounts' page shape verbatim;
Screen 2 is one new inline block bolted onto the existing `NewSalePage.tsx` cart panel.

---

## SCREEN 1 — Coupons management (`haper-admin/src/pages/Coupons/`)

### 1. Where this lives

- **Route:** `/coupons`
- **Nav entry** (`hooks/useMenu.ts`, in the same super-admin-only cluster as `Discounts`, right
  next to it since they're conceptually paired):
  ```
  { icon: Ticket, label: 'Coupons', path: '/coupons',
    keywords: ['coupon', 'promo code', 'code', 'discount code', 'voucher'],
    superAdminOnly: true }
  ```
  `Ticket` (lucide-react) — distinct from `Discounts`' `BadgePercent` so the two sidebar rows are
  visually distinguishable at a glance, but same icon weight/size. Matches the plan's auth (§5.1:
  `requireRoles([SUPER_ADMIN])` + `requirePermission(P.COUPONS.*)`) — `superAdminOnly` mirrors how
  `Discounts` is gated today; if `PERMISSIONS.COUPONS.VIEW` later gets its own nuanced check, swap
  to `requirePermission` the same way the Discounts spec already flagged.
- **Files:** `pages/Coupons/CouponsPage.tsx` (list + filters + page shell), `pages/Coupons/
  CouponFormModal.tsx` (create/edit), `api/coupons.ts` (mirrors `api/discountRules.ts`).
- **No below-cost modal file** — see §4.6, there is no save-time confirmation gate in v1.

### 2. User flow

1. Super admin opens **Coupons** from the sidebar → `CouponsPage` loads, `GET /admin/coupon` with
   no filters.
2. Admin optionally filters by store / enabled / active-now / text search on code — list re-fetches.
3. **Create:** clicks "New coupon" → `CouponFormModal` opens empty → either types a code or clicks
   **Auto-generate** (fills the field from `POST /admin/coupon` with `autoGenerate:true`... see
   §3.2 for the exact interaction, it's a pre-flight mint, not deferred to Save) → fills description,
   scope, discount, minimum order value, schedule, usage limits, enabled → clicks **Save**.
   - 3a. **Success:** toast "Coupon created" → modal closes → list re-fetches → new row appears.
   - 3b. **Duplicate code (409):** inline error under the code field: "A coupon with this code
     already exists." Field regains focus. Modal stays open, all other fields intact.
   - 3c. **Other validation error (400):** inline errors per field (mirrors the Discounts form's
     touched/blocking-error pattern) — never a bare toast with no field-level pointer.
4. **Edit:** clicks a row (or its Edit icon) → same modal, pre-filled, code shown **read-only** (see
   §3.2) → `PUT` instead of `POST`.
5. **Toggle enabled/disabled:** inline `Switch` in the row → `PATCH .../toggle` → optimistic flip,
   revert + toast on failure. This is the instant kill-switch the plan calls out (§5.1) — no
   confirmation needed, same reasoning as the Discounts toggle (reversible, one click).
6. **Delete:** row's Trash icon → `ConfirmDialog`. Two cases per the plan's `DELETE` contract:
   - `usedCount === 0`: plain danger confirm, "Delete coupon" — this really deletes.
   - `usedCount > 0`: the confirm copy must say so plainly (see §3.6) since the backend
     soft-disables instead of destroying — don't let the admin think they deleted history that's
     actually still there.
7. **View redemptions** (optional per plan §5.1 `GET /admin/coupon/:id/redemptions` — small nice-to-
   have, not blocking today's ship): a "View redemptions" link/icon on the row opens a lightweight
   read-only table (code, phone/userId, order, channel, amount, status, date) — flag to tanmoy-web
   as **P2, cut if the timeline is tight**; the list/create/edit/toggle/delete flow is what's
   load-bearing for today.
8. **Exit / failure paths:** network error at any step → toast, modal stays open, input intact
   (same as Discounts' `GiftTierFormModal`-derived catch-block pattern).

### 3. List page (`CouponsPage`)

#### 3.1 Layout (desktop, ≥1024px)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Coupons                                                        [+ New coupon]    │
│  Create promo codes customers and cashiers can redeem for a discount.             │
├─────────────────────────────────────────────────────────────────────────────────┤
│  [🔍 Search code…]  [Store: All ▾]  [Status: All ▾]  [● Active now]   8 coupons   │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ● │ Code       │ Description  │ Scope   │ Discount    │ Min order │ Window   │ Used     │ On │ ⋯ │
│───┼────────────┼──────────────┼─────────┼─────────────┼───────────┼──────────┼──────────┼────┼───│
│ ● │ WELCOME50  │ First order  │ Global  │ ₹50 off     │ ₹299      │ No end   │ 12 / 500 │[On]│⋯ │
│   │ 1st order  │ special      │         │             │           │ date     │ · 1/cust.│    │   │
│───┼────────────┼──────────────┼─────────┼─────────────┼───────────┼──────────┼──────────┼────┼───│
│ ○ │ DIWALI10   │ Festive sale │ This    │ 10% off,    │ No min    │ 8–15 Oct │ 500/500  │[On]│⋯ │
│   │            │              │ store   │ max ₹100    │           │ 2026     │ "0 left" │    │   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Same table shell as `DiscountsPage` (`border: 1px solid var(--border-color); border-radius:
  var(--radius-md)` wrapper, `.table-scroll` for horizontal overflow), same page header shape
  (`<h1>` + subtitle + primary CTA top-right).
- **Leading `●`/`○` column** — active-now indicator, identical semantics to Discounts §2.1: green
  filled dot = live right now (enabled AND inside `[startAt, endAt)` AND not exhausted), grey
  outline = enabled but not currently active (scheduled ahead, or window has ended but admin hasn't
  disabled it), empty cell = disabled. **New wrinkle vs Discounts: exhausted is a THIRD state that
  is not simply "inactive."** See §3.4 for how the Used column, not the dot, carries that signal —
  keeping the dot binary (live-or-not) and putting "why not live" in one adjacent, always-visible
  column avoids needing a 4th dot color (same "one status per channel" reasoning as the dense-table
  memory).
- **Code column**: bold, monospace-ish emphasis is unnecessary (codes are short, uppercase already
  makes them scannable) — `var(--text-primary)`, `font-weight: 600`. If `firstOrderOnly` is set,
  a small tag directly under the code: "1st order" in `var(--text-secondary)`, `0.68rem`, pill-free
  (plain text tag, not a colored badge — this is informational, not a status).
- **Description column**: plain text, truncate at ~40 chars with a tooltip for the full string —
  optional field, render an em-dash `—` in `var(--text-secondary)` when empty, never a blank cell
  (a blank cell in a dense table always reads as "still loading" — see the ops-table memory on
  distinguishing loading from genuinely-empty).
- **Scope column**: identical rendering rule to Discounts §2.1 — "Global" or "This store" / "N
  stores" with store names as a `title` tooltip when >1.
- **Discount column**: exact copy pattern from the plan's own acceptance criteria — `"₹50 off"` for
  FLAT, `"10% off, max ₹100"` for PERCENT with a cap, `"10% off"` for PERCENT with no cap. Never
  "capped at ₹0" for no-cap (same rule as Discounts).
- **Min order column**: `"₹299"` or `"No min"` (not `"₹0"` — zero reads as "free," "No min" reads as
  intended). Right-aligned isn't necessary here since it's a label+number combo, not a pure numeric
  column — consistent with how Discounts treats its Discount column.
- **Window column**: `"8–15 Oct 2026"` (absolute range, `en-IN`/IST, `configTime.ts`'s formatting
  convention) or `"No end date"` when `endAt` is far-future/null — the plan's schema always has a
  concrete `endAt`, but if the admin sets an intentionally-long window, still show the actual date
  rather than inventing an "unlimited" affordance the schema doesn't have. If `startAt` is in the
  future, prefix "From " so an admin scanning the list can tell a coupon is armed-but-not-live-yet
  without needing to check the dot.
- **Used column** — the most important new design decision vs. Discounts, because coupons have a
  genuine numeric cap Discounts rules don't:
  - Format: `"<usedCount> / <totalLimit>"` right-aligned (this IS a pure numeric column, align it
    right per the enterprise-table numbers-align-right rule), e.g. `"12 / 500"`.
  - `totalLimit` null → `"<usedCount> · Unlimited"` (still show the running count — an admin
    tracking a marketing code's traction wants that number even with no cap).
  - Second line, smaller, `var(--text-secondary)`: the per-customer limit and first-order flag as a
    compact caption, e.g. `"1/customer"` or `"1/customer · 1st order"` — omit entirely if both are
    unset (no caption line, don't pad with "No limit").
  - **Zero-remaining-uses state (this is the plan's explicit edge case, §"States"):** when
    `usedCount >= totalLimit` (a real, finite cap that's been fully spent), render `"500 / 500"` in
    `var(--text-secondary)` (not red — this isn't an error state, it's just spent) with a small
    inline tag right after it: **"0 left"** in the same amber `#d97706` used everywhere else in this
    codebase for "technically fine but currently inert" states (matches the Discounts spec's
    zero-matching-items and store-flag-off precedent — reuse that exact color/tone convention, don't
    invent a new severity). This is the single detail that keeps the requirement "should read
    clearly, not confusingly" — a bare `"500 / 500"` with no tag makes an admin re-derive "oh, that
    means it's full" from arithmetic; the tag says it outright.
  - The row stays fully visible and toggle-able in this state — exhausted is not disabled, an admin
    may want to raise the cap via Edit, which is exactly why it must stay in the list, not hide.
- **On column**: `Switch`, identical semantics to Discounts (durable enabled state, independent of
  the live-now dot and the exhausted tag — three genuinely different facts, three separate signals,
  never collapse them).
- **⋯ column**: Edit (pencil), Delete (trash), and the optional "View redemptions" (list icon, P2
  per §2.7) — same `ghostIconBtn` icon-button treatment as Discounts.

#### 3.2 Filter bar

Four controls, left-aligned, `input`-styled (reuse `Warehouse/ui.tsx`'s `input` since Coupons/POS
share that primitive more directly than the Discounts precedent did) + rule count on the right:

- **Search**: text input, placeholder "Search code…", debounced 300ms, matches the plan's `?q=`
  (substring on code). Auto-uppercase is NOT needed here — this is a search box, not a create field,
  and the backend substring-matches case-insensitively per the plan; forcing caps in a search box
  the admin might scan-and-paste into is an unnecessary surprise.
- **Store**: `<select>` — "All stores" then each store, same "Global OR scope includes this store"
  filter semantics as Discounts. Maps to `?storeId=`.
- **Status**: `<select>` — "All" / "Enabled" / "Disabled". Maps to `?enabled=`.
- **Active now**: toggle-style filter chip, off by default. Maps to `?activeNow=true`. Per the
  plan's schema, "active now" should also read as excluding exhausted coupons (a coupon at 500/500
  is not meaningfully "active" even if inside its date window) — flag this exact semantic to
  sumit-backend/tanmoy-web as a confirm-before-build item (§7) since the plan's `activeNow` query
  param doesn't explicitly say whether it factors in `usedCount`.

Filters compose (AND), same as Discounts. No pagination UI at launch (coupon volume is expected
small, same reasoning as Discounts) but mirror the same `DEFAULT_LIMIT = 100` ceiling + "showing
first 100 of N" hint if it's ever hit.

#### 3.3 Create/Edit form (`CouponFormModal`)

Modal, `maxWidth: 640px`, internal scroll body / pinned header+footer — identical shell to
`DiscountRuleFormModal`. Section order, single linear scroll (not tabs, same reasoning as Discounts
— field count here is actually smaller since there's no Targets section and no recurrence):

1. **Code**
2. **Description**
3. **Scope**
4. **Discount**
5. **Minimum order value**
6. **Schedule**
7. **Usage limits**
8. **Enabled**

#### 3.3.1 Code — the field that needs the most care

```
Code
┌───────────────────────────────────┐  ┌──────────────────┐
│ WELCOME50                         │  │ ⟳ Auto-generate   │
└───────────────────────────────────┘  └──────────────────┘
4–20 characters, letters/numbers/-/_. Automatically capitalized.
```

CREATE mode:
- Text input + an "Auto-generate" button to its right (same row, `input`-style text field +
  `btn('ghost')` button, matching the phone-input/action-button row rhythm already used in
  `NewSalePage.tsx`'s customer phone field).
- **Auto-uppercase as typed**: `onChange` uppercases and strips characters outside
  `/^[A-Z0-9_-]*/` client-side (mirrors the plan's server format rule `^[A-Z0-9][A-Z0-9_-]{3,19}$`)
  as the admin types — cursor position must be preserved (uppercasing must not force the caret to
  jump to the end on every keystroke; use the standard controlled-uppercase pattern: transform in
  `onChange`, don't rely on CSS `text-transform` which would submit lowercase). This is the
  confirmed-by-user "make it caps on client side" requirement — non-negotiable UX detail, don't ship
  a version that submits mixed case and relies on the server to fix it silently.
- **Auto-generate button**: on click, calls a **dedicated mint-only path**, not a full submit. Per
  the plan's contract, `POST /admin/coupon` with `{autoGenerate:true}` is the only server-side
  minter described — so either (a) tanmoy-web/sumit-backend add a lightweight `GET /admin/coupon/
  generate-code` that mints-and-returns without creating a row (**recommended** — avoids creating
  orphan coupon rows every time an admin clicks the button before finishing the rest of the form),
  or (b) if no such endpoint exists, the button is disabled/hidden and the admin must type a code
  manually for today's ship. **Flag this to tanmoy-web/sumit-backend explicitly as a build-order
  question (§7)** — do not let this silently degrade to "always requires the admin to invent a
  code," since the plan's acceptance criteria requires the auto-generate path to work.
  - While minting: button shows a small spinner + "Generating…", disabled.
  - On success: fills the Code field with the returned code (still fully editable afterward — an
    admin can auto-generate then hand-edit, e.g. append a suffix, as long as it still validates).
  - On failure (collision retries exhausted, network): toast error, field untouched, admin can
    retry the button or type manually.
- Validation: format regex from the plan, live inline error (not just on blur) once the field has
  been touched: "4–20 characters: letters, numbers, - or _ only."
- Duplicate-code 409 from Save surfaces here (see §2.3b) rather than as a generic toast — the field
  is the natural place for a "this code is taken" message.

EDIT mode:
```
Code
WELCOME50
Code can't be changed after creation.
```
- **Read-only, rendered as plain text**, NOT a disabled `<input>` — a disabled input still looks
  like a form control an admin might reasonably try to click/tab into and wonder why nothing
  happens; plain text with a caption makes the immutability legible at a glance, matching how the
  Discounts spec's below-cost item table renders read-only data as plain rows, not disabled inputs.
  Suggested treatment: same visual weight as the list's Code column (bold, `var(--text-primary)`),
  directly followed by the caption line in `var(--text-secondary)`, `0.72rem`: "Code can't be
  changed after creation." No Auto-generate button rendered at all in edit mode (there is nothing
  for it to do).

#### 3.3.2 Description

Optional `<textarea>`, 2 rows, placeholder "Optional note for your team — not shown to customers."
(identical field to Discounts §3.2, same copy, deliberate consistency.)

#### 3.3.3 Scope

Identical component and copy to Discounts §3.3 — Global vs Specific store(s) segmented toggle +
multi-select checklist. **Reuse verbatim** (same shape in the plan's schema: `scope: {type,
storeIds}`). No coupon-specific variation needed here.

#### 3.3.4 Discount

Identical layout to Discounts §3.5 (Percent/Flat segmented toggle, value input, "No cap" checkbox +
max-discount input) — **but the FLAT semantics are the opposite of Discounts', and that must be
stated in the UI**, because the plan is explicit this is "a bug factory" if conflated (§3.1 of the
plan):

```
Discount
┌──────────┬──────────┐        ┌─────────────────────┐
│ Percent  │ Flat ₹   │  Value │ [ 50         ] ₹     │
└──────────┴──────────┘        └─────────────────────┘
Applied to the WHOLE ORDER, not per item.
☐ No cap        Max discount   ₹ [ ___         ]
```

- Same segmented-toggle visual, same validation copy pattern ("Enter a percentage between 1 and
  100" / "Enter an amount above ₹0").
- **Hint text under the Flat ₹ value input reads "Applied to the WHOLE ORDER, not per item."** — the
  deliberate inversion of the Discounts form's own hint ("Applied per unit, not per line or per
  cart"). This single line of copy is the most important guard against an admin who has used the
  Discounts screen before muscle-memorying the wrong mental model into a coupon. Flag to
  tanmoy-web: do not copy-paste the Discounts hint text verbatim, the meaning is inverted on
  purpose.
- Cap field: same "No cap" checkbox pairing as Discounts, same disabled/enabled toggle. Hint text
  differs slightly: "Caps the ₹ value of the discount on the order. Leave 'No cap' checked for an
  uncapped percentage off." (drop the Discounts hint's "per unit" framing since coupons are
  cart-level throughout).

#### 3.3.5 Minimum order value

```
Minimum order value
☐ No minimum        ₹ [ 299          ]
Evaluated on the item subtotal, before delivery and platform charges.
```

- Checkbox "No minimum" (checked = `minOrderValue: 0`, and disables the ₹ input) paired with a ₹
  input, same interaction pattern as the Discount cap field (consistent checkbox+input pairing
  language reused a second time in the same form — deliberate, reduces the number of distinct
  interaction patterns an admin has to learn).
- Hint text states the basis exactly per the plan §7 ("`minOrderValue` basis: pre-discount item
  subtotal... excluding delivery and platform charges, excluding free-gift lines") — this prevents
  the marketing-intent ambiguity the plan itself calls out as needing to be unambiguous in the form.

#### 3.3.6 Schedule — simpler than Discounts, date-range only

```
Schedule
Active from                              Active until
[ 24 Aug 2026    ] [ 12:00 AM ]         [ No end date              ]
Times are India Standard Time (IST).
```

- **No recurrence section at all** — this is the one structural simplification vs. the Discounts
  form's §3.6, per the locked "v1 is date-range only, no recurrence" decision. Do not render the
  "Also limit to specific days & time window" checkbox or its sub-block; there is nothing to hide
  behind an opt-in toggle because the feature doesn't exist for coupons in v1.
- Two `datetime-local` inputs, same `istInputToUtcIso`/`utcIsoToISTInput` reuse as Discounts §3.6 —
  **identical conversion utility, don't duplicate the math.**
- `endAt` is required by the plan's schema (`schedule.endAt >= schedule.startAt` validation) — so
  there is no "no end date" checkbox to add complexity; if the admin wants an effectively-unbounded
  coupon, they pick a far-future date and the list's Window column already handles that gracefully
  (§3.1 "No end date" display threshold — pick a reasonable far-future cutoff, e.g. >2 years out,
  to trigger that display; confirm the exact threshold with tanmoy-web, it's a display nicety not a
  data-model concept).
- Validation: `endAt >= startAt`, same inline error copy as Discounts: "End must be after start."

#### 3.3.7 Usage limits — the section needing the clearest "combine freely" framing

```
Usage limits
Total redemptions      ☐ Unlimited     [ 500          ]
Per customer            ☐ Unlimited     [ 1            ]
☐ First order only

You can set any combination of these — e.g. a total cap of 500 AND a
limit of 1 per customer AND first-order-only, all at the same time.
```

- **Total redemptions**: "Unlimited" checkbox (checked = `totalLimit: null`, disables the number
  input) + number input, `min: 1`. Same checkbox+input pairing pattern used twice already in this
  form (§3.3.4 cap, §3.3.5 min order) — third and final reuse, fully consistent interaction
  language across the whole form by now.
- **Per customer**: identical pairing, "Unlimited" default checked, number input `min: 1`.
- **First order only**: plain `Switch` or checkbox (not paired with a number — it's boolean).
- **The italic/muted caption line explaining combinability is load-bearing, not decorative** — per
  the brief's explicit instruction ("make clear these can be combined... maybe a short caption").
  Placed once, under all three controls (not per-field), since it's about their relationship to each
  other, not any one of them individually. `var(--text-secondary)`, `0.75rem`.
- No validation blocks Save here — all three are independently optional, any combination (including
  all-unlimited-and-off, which just means an uncapped, always-redeemable-once-per-nobody... actually
  fully open coupon) is a legal, if unusual, configuration. That's intentional per the schema.

#### 3.3.8 Enabled

Single `Switch`, default **on** for a new coupon (unlike Discounts' segmented-toggle-defaults-to-
safer-choice reasoning — here there's no stacking-ambiguity risk, and an admin creating a coupon
almost always wants it live once saved; if they need to stage it for later, the Schedule's
`startAt` already handles "not live yet" without needing the admin to remember to separately flip
Enabled at go-time). Label: "Enabled" with hint "Turn off to stop this coupon from working
instantly, without deleting it."

#### 3.4 Save-time behavior — NO below-cost gate (confirmed, with a caveat)

The brief explicitly asks me to confirm or flag whether the aggregate silent-clamp (no admin-facing
warning) is fine for v1, or whether a warning is worth it for a large flat-₹ coupon on a low-margin
catalog.

**Confirmed fine for v1, with one flag:** the plan's design (§3.4) is that the aggregate margin
guard silently clamps the total discount so the order never sells below cost — this is categorically
different from the Discounts flow's below-cost gate, which exists because a *per-line* clamp can
make individual SKUs look suspiciously cheap or fully free, which is worth a human sanity-check at
authoring time. A coupon's clamp only ever *reduces* what the customer receives at checkout time
(a ₹500 coupon on a ₹100-margin cart silently becomes a ₹100 discount) — there's no authoring-time
data (the plan gives no "affected items" preview for coupons, unlike Discounts' targeted rule scan)
against which to run a meaningful preview anyway, since a coupon applies to whatever's in a given
cart at redemption time, not a fixed catalog scope knowable at creation.

**The flag, not blocking today's ship:** consider a small **informational** (not blocking, not a
modal) hint line in the Discount section, visible whenever discount type is Flat and the value is
"large" by some simple heuristic (e.g. > ₹200, tune with the user) — something like: "Large flat
discounts are automatically capped so an order never sells below cost — the customer may see a
smaller discount than this on a low-margin cart." This is copy-only, no new interaction, no gate,
and genuinely optional — cut it if the timeline doesn't allow, but it costs one hint line and
removes a plausible support-ticket source ("why did the coupon only take ₹40 off when it says ₹500
off"). Recommend tanmoy-web includes it; not a launch blocker.

### 4. States

- **Loading**: skeleton rows, same shape/count convention as `GiftTiersPanel`'s `SkeletonRows` /
  Discounts' skeleton (3 placeholder rows matching the real column layout).
- **Empty (zero coupons ever created)**: teaching empty state, same dashed-border/accent-icon/
  one-line-explainer/CTA pattern as Discounts §2.3 — copy: "Create a coupon to give customers a
  promo code — a percentage or flat amount off their whole order." Primary CTA "Create your first
  coupon" inline in the empty state.
- **Empty (filtered to zero)**: plain text row, no dashed card, no CTA — "No coupons match these
  filters." + "Clear filters" link. Same distinction from the teaching empty state that Discounts
  makes (never show teaching copy when coupons DO exist but the filter excludes them all).
- **Error** (list fetch failed): same `errorCardStyle`/icon+message+Retry pattern as Discounts §2.3
  — "Couldn't load coupons." + "Check your connection and try again." + Retry. Never render the
  friendly empty state on a fetch failure (indistinguishable-from-empty risk, same memory-flagged
  pattern).
- **Success** (list loaded, ≥1 row): the table as described in §3.1.
- **A coupon at zero remaining uses**: NOT a separate page state — a per-row treatment, fully
  specified in §3.1's Used-column subsection ("0 left" amber tag). Explicitly called out here per
  the brief's requirement: this state must "read clearly, not confusingly" — the row stays visible,
  toggle-able, editable; only the Used column communicates exhaustion, and it does so with an
  explicit tag rather than requiring the admin to read `"500 / 500"` and do the math themselves.
- **Save-in-flight** (create/edit modal): Save button shows spinner + "Saving…", disabled, exact
  same posture as Discounts' `isSaving || blocked` pattern.
- **Save failure**: modal stays open, all fields intact, error surfaced either inline (code
  duplicate/format) or as a toast (network/server) — never silently discard admin input.
- **Disabled coupon in the list**: row renders normally but the `On` switch shows off; no separate
  dimming/greying of the whole row is needed (unlike "0 left," a disabled coupon isn't exhausted, it
  might be intentionally paused and re-enabled any time — don't visually bury it).

### 5. Design tokens (reused, none new)

Identical token table to the Discounts spec §6 — reuse verbatim, do not re-derive:

| Purpose | Token |
|---|---|
| Panel/card surfaces | `var(--bg-panel)`, `var(--bg-secondary)` |
| Borders | `var(--border-color)`, radius `var(--radius-md)` / `var(--radius-lg)` |
| Primary/secondary text | `var(--text-primary)` / `var(--text-secondary)` |
| Accent (primary buttons, active toggle) | `var(--accent-primary)` |
| Success (active-now dot, "Enabled") | `var(--success)` |
| Danger (delete, blocking field errors, POS hard-fail reasons) | `var(--danger)` |
| Warning ("0 left" tag, POS below-min/needs-phone messaging) | `#d97706` hardcoded — no `--warning`
  token exists in this codebase, confirmed again here; reuse the Discounts-spec-confirmed hex |
| Spacing | Same scale already established: `0.35/0.5/0.6/0.75/0.85/1.05/1.35rem` |
| Type | Labels `0.85rem`/500; hints `0.72–0.75rem`/`var(--text-secondary)`; field errors
  `0.75rem`/500/`var(--danger)`; table body `0.85rem` |

### 6. Component inventory

| Component | Status | Notes |
|---|---|---|
| `Switch` | Reuse as-is | Enabled toggle in rows and form |
| `ConfirmDialog` | Reuse as-is | Delete confirm — no `acknowledgeLabel` needed for the `usedCount===0` hard-delete path; for `usedCount>0` softdisable, still no checkbox (it's the same low-risk/reversible reasoning as Discounts' delete, not the below-cost financial-risk reasoning) — just make the body copy explicit that this disables rather than destroys |
| `SegmentedToggle` | Reuse as-is | Already extracted per the Discounts spec's §7/§10 follow-up — Scope and Discount-type toggles here are the SAME component, second consumer, confirms the extraction was worth it |
| Store multi-select checklist (Scope) | Reuse as-is | Same component/pattern as Discounts §3.3, no coupon-specific variation |
| `datetime-local` + IST conversion | Reuse utils, new inputs | Same `configTime.ts` functions; only two inputs total (no recurrence sub-block), simpler than the Discounts form's schedule section |
| `CouponsPage` list/table | New | Structurally copies `DiscountsPage.tsx`'s table/skeleton/empty/error shapes, columns adapted per §3.1 |
| `CouponFormModal` | New | Structurally copies `DiscountRuleFormModal.tsx`'s modal shell/section rhythm; roughly half the field count (no Targets, no recurrence) |
| Auto-generate code button | New | Small, but depends on a backend mint-only endpoint existing — flagged as an open item, §7 |
| "0 left" tag | New, trivial | Reuses the amber hardcoded convention, one `<span>` |

### 7. Open items for build (flag to tanmoy-web / sumit-backend, not blocking the rest of the spec)

1. **Auto-generate needs a mint-without-creating endpoint.** The plan's contract only describes
   `autoGenerate:true` as a flag on the full `POST /admin/coupon` create call. If no separate
   "just mint me a code" endpoint exists, clicking Auto-generate before the admin has filled the
   rest of the form has nowhere to go without either (a) creating a real coupon row prematurely, or
   (b) the FE faking a client-side random code (bad — collision-unsafe, defeats the point of a
   server-side mint). Confirm with sumit-backend before wiring the button; if truly out of scope for
   today, ship with the Auto-generate button removed and code always admin-typed, noting it as a
   fast-follow.
2. **Does `?activeNow=true` factor in exhaustion?** (§3.2) — confirm the exact semantics so the
   filter and the list's dot/tag stay consistent with each other.
3. **`GET /admin/coupon/:id/redemptions` list UI** (§2.7) is P2 — cut without blocking today's ship
   if time is short; the raw data is already reachable via the API for a fast-follow.
4. **"No end date" display threshold** (§3.3.6) — pick a concrete cutoff (suggest >2 years from now)
   with tanmoy-web; purely a list-column display nicety, no data-model implication.

---

## SCREEN 2 — POS coupon entry (`haper-admin/src/pages/POS/NewSalePage.tsx`)

### 1. Where this fits in the existing layout

`NewSalePage.tsx` today is a two-column grid: left = item search/add, right = cart panel (`card`)
containing, top to bottom: cart line list → customer phone/name inputs → totals block (subtotal/GST/
Total) → "Complete sale" button.

**The coupon row goes directly above the totals block**, inside the same right-column `card`, in
its own visually-separated sub-block with a top border (same `borderTop: '1px solid var(--border-
color)'` separator language already used between the cart-lines list and the phone/name inputs, and
again between phone/name and totals — this becomes the third instance of that same separator
rhythm, so it reads as "another section of this same panel," not a bolted-on afterthought). This
placement is "near the order summary/total, not buried" per the brief — it's the last thing the
cashier sees before the total, exactly where a discount code visually belongs in every POS/checkout
pattern (grocery POS terminals, e-commerce checkouts) put it: immediately before the final total,
after the cart contents are settled.

```
┌ Cart panel (existing card) ─────────────────────────────────┐
│  Cart · 3 items                                    [Clear]   │
│  [line] [line] [line]                                        │
│  ──────────────────────────────────────────────────────────  │
│  [Customer phone *]  [suggestions dropdown]                  │
│  [Customer name (optional)]                                  │
│  ──────────────────────────────────────────────────────────  │  ← NEW section starts here
│  Coupon code                                                  │
│  [ WELCOME50            ] [ Apply ]                           │
│  ──────────────────────────────────────────────────────────  │
│  Subtotal (excl. GST)                              ₹186.00   │
│  GST (incl.)                                        ₹14.00   │
│  Total                                             ₹200.00   │
│  ──────────────────────────────────────────────────────────  │
│         [ Complete sale · Cash ₹200.00 ]                     │
└────────────────────────────────────────────────────────────┘
```

### 2. States — no coupon attempted (default)

```
Coupon code
[ Type a code…              ] [ Apply ]
```

- Single-line row: text `input` (flex: 1) + `btn('ghost')` "Apply" button, same row-shape pattern as
  `NewSalePage.tsx`'s phone-field-plus-suggestion-affordance rhythm.
- Placeholder: "Type a code…". **Auto-uppercase as typed**, same client-side transform rule as the
  admin Coupons form (§3.3.1) — identical implementation, same reasoning (customer/cashier-typed
  codes need this everywhere codes are entered).
- Apply button: disabled (not hidden) while the input is empty or while `cart.length === 0` (a
  coupon check needs cart contents per the plan's `POST /admin/pos/coupon/validate` body — items are
  required). Tooltip/title on the disabled state: "Add items to the cart first."
- Enter key in the coupon field triggers Apply (same "Enter submits" convention as the item-search
  field's `onSearchKeyDown` elsewhere on this page — consistent keyboard behavior across the
  screen).

### 3. Applying (in-flight)

- Apply button shows spinner + stays labeled "Apply" with the spinner replacing/preceding the label
  (same treatment as other in-flight buttons on this page, e.g. `saving` → "Recording…" convention,
  but here the button label doesn't need to change text, just show a small `Loader2` inline — this
  is a sub-second check, not a multi-second save, so a full label swap would flicker).
- Input and Apply button both disabled during the check to prevent double-submit.

### 4. Applied successfully

```
Coupon code
✓ WELCOME50 applied                                  [Remove]
  ₹50.00 off

Subtotal (excl. GST)                                ₹186.00
GST (incl.)                                          ₹14.00
Coupon (WELCOME50)                                  −₹50.00
Total                                               ₹150.00
```

- The input+Apply row is **replaced** by a compact applied-state row (not left visible alongside a
  now-redundant Apply button) — green checkmark + code + "applied", `var(--success)`/`#22c55e`
  (matches the existing green success-card border color already used for `lastSale` on this exact
  page, e.g. `borderColor: '#22c55e55'` — reuse that established green, don't introduce a second
  green).
- **Remove** link/button (ghost, small) sits at the right of that same row — same row-shape as the
  list's phone-suggestion-dismiss pattern. Clicking it calls the equivalent of `DELETE /cart/coupon`
  logic client-side (for POS this is just local state — there's no persisted server-side POS cart to
  clear per the plan; POS coupon application is re-validated at sale time per §5.2, so "Remove" on
  this screen is simply "stop sending `couponCode` on the next Apply/sale", no API call needed unless
  the plan's POS validate-endpoint has its own session state — confirm with sumit-backend, flagged
  §7).
- Discount amount line directly under the applied row: "₹50.00 off" in `var(--text-primary)`,
  `0.78rem`, so the cashier sees the number without having to scan down to the totals block.
- **Totals block gains a new line**: "Coupon (CODE)" with the discount amount in parentheses-free
  minus-prefixed format `−₹50.00`, styled exactly like the existing Subtotal/GST rows (same font
  size/color), inserted between GST and Total. The **Total row recalculates to the payable amount**
  — this must visibly change the instant Apply succeeds (no separate "new total" callout needed
  beyond the Total row itself updating, since that row is already the single source of truth the
  cashier reads before hitting Complete sale).
- **Complete sale button label updates too**: `Complete sale · Cash ₹150.00` (uses the new payable
  total) — this button already interpolates the live `total` value today (`Complete sale · Cash
  ₹${total.toFixed(2)}`), so once `total` itself is coupon-adjusted client-side (mirroring what the
  server will charge), the button label update is free — no separate wiring needed, just make sure
  the coupon-adjusted total flows into the same `total` variable the button already reads, OR
  (safer) keep `total` as the raw cart total and introduce a `payableTotal` that both the totals
  block and the button read from — **recommend the latter** so "raw cart total" and "what the
  customer actually pays" stay two clearly named values in the code, not one variable silently
  mutated by coupon state.
- On completing the sale: `couponCode` is sent in the `POST /admin/pos/sale` body per the plan §5.2.
  The server re-validates from scratch (fail-closed) — if the coupon somehow became invalid between
  Apply and Complete (e.g. another cashier just exhausted it), **the sale itself fails** with the
  specific reason (see §6) rather than silently completing at the un-discounted price — this is the
  fail-closed guarantee from the plan (§3.5), and the UI must not paper over it: show the sale-level
  error exactly like the apply-time error (§6), the applied-coupon row stays showing as "applied"
  (it WAS valid a moment ago) but the whole sale did not go through, and the cashier must resolve it
  (typically: Remove the coupon and complete at full price, or investigate) before retrying.

### 5. Applied, but the coupon needed a phone and one is now present (re-validation)

If a cashier applies a coupon successfully, then later changes the phone field (e.g. clears it, or
picks a different customer), the already-applied coupon's eligibility could change (per-customer/
first-order coupons are keyed to that phone). **Re-run the coupon check automatically whenever the
phone field changes while a coupon is applied** — silently, in the background, no button re-click
needed — and if it now fails, fall back to the same failed-apply treatment (§6) with the applied
state cleared and a toast: "WELCOME50 no longer applies — [reason]." This prevents a stale "applied"
badge from surviving a phone change that actually invalidates it, which would otherwise let a sale
complete showing one price on screen and a different (or rejected) price at the server. Flag this
specific auto-revalidation behavior to tanmoy-web explicitly — it's easy to miss since it's not in
the base "apply once" flow, but it's the direct consequence of coupon-entry and phone-entry living
on the same screen.

### 6. Applied failed — generic reasons

```
Coupon code
[ WELCOME50              ] [ Apply ]
⚠ This code has expired
```

- Input+Apply row stays as-is (not replaced — the cashier likely wants to try a different code
  immediately, or fix a typo), input keeps the (rejected) text so the cashier can see/edit what they
  typed rather than it vanishing.
- Error line directly under the row, amber `#d97706` (not red/`--danger` — a wrong/expired/exhausted
  code at a busy counter is a normal, frequent, non-alarming occurrence, not a system error; reserve
  red for things that indicate something is actually broken, matching the Discounts spec's
  "caution vs error" color discipline).
- **Message text per reason** — plain, cashier-facing, one line each, mapped from the plan's §5.2
  machine reason codes:

  | Reason | Message shown to cashier |
  |---|---|
  | `NOT_FOUND` | "We don't recognize this code. Check for typos." |
  | `DISABLED` | "This code isn't active right now." |
  | `NOT_STARTED` | "This code isn't active yet." |
  | `EXPIRED` | "This code has expired." |
  | `EXHAUSTED` | "This code has reached its usage limit." |
  | `BELOW_MIN_ORDER` | "This code needs a bigger order — add ₹{amount} more." (fill `{amount}` from the plan's response if the API surfaces a minOrderValue gap the same way the cart-preview's `message` field does per §5.4; if the POS validate response doesn't carry that computed gap, fall back to "This code needs a bigger order." and flag to sumit-backend as a nice-to-have enhancement, not a blocker) |
  | `NOT_FIRST_ORDER` | "This code is for first orders only, and this customer has ordered before." |
  | `WRONG_STORE` | "This code isn't valid at this store." |
  | `CUSTOMER_LIMIT_REACHED` | "This customer has already used this code." |
  | `TOO_MANY_ATTEMPTS` | Not reachable at POS per the confirmed "no POS attempt limiter" decision — omit this row from the mapping entirely; if the backend ever sends it anyway, fall back to the server's raw `message` field rather than silently swallowing it. |
  | `REQUIRES_CUSTOMER_PHONE` | **Special handling — see §7, not a plain one-liner.** |

- Every reason (except `REQUIRES_CUSTOMER_PHONE`) is otherwise-identical in interaction weight: one
  amber line, no special CTA, cashier reads it and either fixes the code or moves on without it. The
  brief calls out `REQUIRES_CUSTOMER_PHONE` as needing distinct treatment — that's §7 below.

### 7. REQUIRES_CUSTOMER_PHONE — the trickiest moment, worked through in full

**Why this one is different from the rest:** every other failure reason is a dead end for THIS
apply attempt — the cashier's next move is "try a different code" or "give up and sell at full
price." `REQUIRES_CUSTOMER_PHONE` is the one reason that is **immediately actionable and likely to
succeed on retry** — the coupon is real and probably fine, the walk-in is just currently anonymous
(`POS-GUEST`) and the coupon has a per-customer or first-order limit that can't be evaluated for a
shared guest identity (plan §3.10). The UI's whole job here is: make the cashier understand in under
two seconds that typing a phone number and hitting Apply again will likely just work.

#### 7.1 Layout — distinct from the generic error, amber but with a clear next step and a direct hook into the existing phone field

```
Coupon code
[ WELCOME50              ] [ Apply ]
⚠ This code needs the customer's phone number to check —
  enter it above and tap Apply again.                    [→ Go to phone field]
```

- Same amber tone as §6 (still not an error, still a normal counter occurrence) but with **two
  differences from the generic one-liner**:
  1. The message explicitly names the fix ("enter it above and tap Apply again"), not just the
     problem — every other reason states a fact the cashier can't act on beyond retrying a
     different code; this one states an action.
  2. A small secondary action **"→ Go to phone field"** (ghost, text-button weight, not a full
     `btn()` — this is a convenience jump, not a primary CTA competing with Apply/Complete sale) that
     does two things at once: scrolls/focuses the existing Customer phone input (`phoneInputRef` —
     **already exists on this page**, no new ref needed) and, if the phone field is currently below
     the fold on a small viewport, brings it into view. Since the coupon row sits directly *below*
     the phone field in the layout (§1), on desktop this is almost always already visible — the
     button's main value is the **focus jump**, so the cashier's next keystroke goes straight into
     the phone field without a manual click, which matters mid-queue.
- **The message names WHERE the phone field is ("above")** rather than a generic "enter the
  customer's phone number" — spatial language matched to the actual layout removes any ambiguity
  about which field, since there is no other phone-shaped field on this screen it could be confused
  with.

#### 7.2 What happens after the cashier enters a phone and re-applies

- The cashier types into the (already-existing, already-required-for-checkout) Customer phone field,
  then either clicks "Apply" again themselves or clicks the "→ Go to phone field" button which,
  after focusing, does NOT auto-retry the coupon on its own (auto-retrying on every keystroke while
  the cashier is still typing a 10-digit number would be premature-request noise) — the cashier
  finishes typing the phone and manually hits Apply again, same single explicit action every other
  Apply does.
- On successful re-apply: identical to §4 (applied state, totals update).
- **If the phone is entered but the coupon STILL fails** (e.g. this exact customer already used it —
  now returns `CUSTOMER_LIMIT_REACHED` instead): the message swaps to the matching §6 row — this is
  expected, not a bug, and the copy for that specific reason ("This customer has already used this
  code.") now makes obvious sense in context, since the cashier just supplied the phone that revealed
  it.

#### 7.3 The "no phone field on this screen" contingency — does not apply here, confirmed

The brief asks me to note if there's no existing phone-number field and one may be needed. **Not
needed** — `NewSalePage.tsx` already has a required Customer phone input (`phoneInputRef`, `PHONE_RE`
validated, `required` at Complete-sale time regardless of coupons) sitting directly above where the
coupon row is placed (§1). This is a genuinely fortunate existing-layout fact, not a coincidence
worth re-litigating: the coupon row's placement decision in §1 (directly below the customer fields,
directly above totals) was chosen partly BECAUSE it puts the phone field immediately adjacent and
already-visible when `REQUIRES_CUSTOMER_PHONE` fires, minimizing the visual distance between "here's
the problem" and "here's the fix."

#### 7.4 Timing / speed requirement (mid-queue, per the brief)

- The apply-failure message must render **synchronously with the API response** (no artificial
  delay) and the focus-jump must be **instant** (no scroll animation longer than ~150ms, matching the
  codebase's existing "no spring/bounce, snappy 120–150ms" motion convention already established in
  the Discounts spec §8) — a cashier mid-queue cannot wait on a decorative transition to read a
  one-line message and click one button.
- The message text itself is capped at roughly one visual line at the panel's ~380–460px width
  (per the grid's `minmax(380px, 460px)` right column) so it never wraps awkwardly or pushes the
  totals block down unpredictably — keep the copy in §7.1 as the target length; if translated/edited
  later, keep it to a similar character count.

### 8. States summary for the coupon block (complete list)

- **Idle / no coupon attempted**: input + Apply, empty state, Apply disabled if cart empty or field
  empty.
- **Applying**: input + Apply disabled, small inline spinner.
- **Applied**: green applied row + Remove + discount line + totals updated + button label updated.
- **Failed — generic reason**: amber one-liner under the (still-editable) input row, per the §6
  reason table.
- **Failed — `REQUIRES_CUSTOMER_PHONE`**: amber two-part message + "→ Go to phone field" action, per
  §7.
- **Re-validation-on-phone-change failure** (§5): applied state silently clears, toast fires,
  reverts to the idle-or-failed state depending on what the re-check returned.
- **Sale-time failure despite a currently-"applied" coupon** (§4 last bullet): sale does not
  complete, the specific reason is surfaced the same way a generic Complete-sale error is today
  (toast, per the page's existing `errMsg(e)` → `toast.error` pattern used throughout
  `NewSalePage.tsx`) — applied-coupon UI state stays as-is so the cashier can see what was attempted
  and decide whether to Remove it and retry at full price.
- **No abuse-limiter state** — explicitly confirmed absent per the plan; the cashier can retry Apply
  with a new code as many times as needed, no lockout UI of any kind on this screen.

### 9. Component inventory (Screen 2)

| Component | Status | Notes |
|---|---|---|
| Coupon input + Apply button row | New | `input` + `btn('ghost')`, same primitives already imported into `NewSalePage.tsx` from `Warehouse/ui.tsx` — no new import needed |
| Applied-coupon row (checkmark + code + Remove) | New | Reuses the existing green (`#22c55e`) already used on this exact page for the post-sale success card |
| Amber inline error line (generic reasons) | New, trivial | One `<span>`, reuses the `#d97706` convention |
| `REQUIRES_CUSTOMER_PHONE` composite message + jump-to-phone action | New | The only genuinely new interaction pattern on this screen; focuses the existing `phoneInputRef` |
| Coupon line in totals block | New | Same row shape as the existing Subtotal/GST rows, just one more `flex` row |
| `payableTotal` derived value | New (implementation detail, flagged for arijit-frontend-arch alignment if state management review is needed) | Keep raw cart `total` and coupon-adjusted `payableTotal` as two distinct named values, not one mutated in place |

### 10. Open items for build (flag to tanmoy-web / sumit-backend)

1. **Does "Remove" need an API call at POS, or is it purely local state?** Per the plan, POS has no
   persisted server-side cart (unlike the customer app's `carts.schema.js` `couponCode`) — coupon
   application for POS appears to be request-scoped (`POST /admin/pos/coupon/validate` then
   `POST /admin/pos/sale` with `couponCode`), so Remove is very likely pure client state with no
   endpoint to call. Confirm this reading with sumit-backend before build — if there's a hidden
   session concept, Remove needs to account for it.
2. **Does the POS `validate` response carry a computed "add ₹X more" gap for `BELOW_MIN_ORDER`?**
   (§6 table) — the plan's cart-preview contract (§5.4) has a `message` field with exactly this kind
   of computed copy; confirm the POS validate response includes something equivalent, or ship the
   flatter fallback message.
3. **Re-validation-on-phone-change (§5)** is a deliberate addition beyond the base "apply once" flow
   in the brief — confirm with the user/rahul that this extra automatic re-check is in scope for
   today's ship; if timeline is truly tight, the minimum-viable fallback is: leave the applied
   coupon as-is when phone changes, and let the existing sale-time re-validation (§4 last bullet)
   catch any staleness at Complete-sale instead. Flagging both options; my recommendation is to
   build the re-validation since it prevents a confusing "sale rejected at the very last step" cash-
   register moment, but it is not as load-bearing as the rest of this screen if cut.

---

## Cross-screen summary — reused vs new (both screens combined)

| Reused verbatim | New for this feature |
|---|---|
| Discounts' page/table/modal shell, `SegmentedToggle`, store multi-select, `ConfirmDialog`, `configTime.ts` IST conversion, Switch, all list-state patterns (loading/empty/error), amber `#d97706`/green `#22c55e` color conventions | Coupons list columns (Used/exhausted handling is genuinely new), Code field (auto-uppercase + auto-generate + immutable-on-edit), simplified date-range-only Schedule, Usage-limits three-field combinable section, entire POS coupon row incl. `REQUIRES_CUSTOMER_PHONE` handling |

No new design tokens were introduced anywhere in this spec.

---

**End of spec.**
