# Design spec — Admin-configurable cart quantity limits

Author: chanchal-designer · Date: 2026-09-15 · Status: **ready for build (Phase 0 of admin-configurable-cart-limits.md)**
Reads against: `haper-misc/plans/admin-configurable-cart-limits.md` §1, §5, §6, §11 Phase 0.
Consumer: `haper-admin` (React, TypeScript). Backend routes are §5 of the plan — not repeated except where a field is copy-relevant.

This screen is new but must feel like it already shipped next to Discounts. It reuses the
**exact list-page + create/edit-modal idiom** of `haper-admin/src/pages/Discounts/DiscountsPage.tsx`
+ `DiscountRuleFormModal.tsx` — same tokens, same component set, same interaction shape. Deviations
are called out explicitly with a reason; everything else should be assumed identical to Discounts
unless this doc says otherwise.

---

## 0. Reused building blocks (do not re-invent)

| Need | Reuse | Notes |
|---|---|---|
| Page shell, filter bar, table, skeleton rows, empty state, inline fetch-error banners | `DiscountsPage.tsx` structure | Same `<table className="table-scroll">`, same `thStyle`/`tdStyle`/`pillStyle`/`errorCardStyle` constants — copy them into the new page file, don't import cross-page. |
| On/off row toggle | `components/common/Switch` | Same optimistic-flip-then-revert-on-error pattern as `handleToggle` in DiscountsPage. |
| Destructive confirm | `components/common/ConfirmDialog` | `tone="danger"` for delete, `tone="warning"` + `acknowledgeLabel` for the cascade-delete-with-overrides case (§7 below). |
| Segmented pickers (target type, limit type) | `components/common/SegmentedToggle` | Same as Discount type (`PERCENT`/`FLAT`) and Scope (`global`/`store`) toggles. |
| Modal shell, `Section` wrapper, form field styles | `DiscountRuleFormModal.tsx`'s `overlayStyle`/`panelStyle`/`Section`/`inputStyle`/`checkRowStyle`/`checklistStyle`/`fieldErrStyle`/`hintStyle`/`warnNoteStyle` | Copy these constants verbatim into the new modal file (Discounts doesn't export them). |
| Searchable multi-select for SKUs | `SkuPicker` pattern inside `DiscountRuleFormModal.tsx` | Same debounce/combobox/chip shape; new component needs a category- and sub-category- flavored sibling (§3.2 below) since target type here is exclusive, not additive. |
| Store context | `useAuthStore().activeStoreId` → auto-sent as `x-store-id` header by `api/axios.ts` | **No store picker on this page.** The page is store-context-aware the same way Discounts already reacts to `x-store-id` for `skipStoreHeader` reference calls — a store_admin always has one active store; a super_admin sees the global-only view unless they've switched stores in the app-level switcher. |
| Toast feedback | `stores/toastStore` | Same `toast.success` / `toast.error(apiErrorMessage(err, fallback))` pattern. |
| Preview strip | `previewStripStyle` + debounce pattern from `DiscountRuleFormModal.tsx` | Same 600 ms debounce, same loading/failed/empty/result state ladder — this feature's preview is higher-stakes (§6) so it gets a stronger visual treatment, not a different mechanism. |

Colors used below are all existing tokens: `var(--text-primary)`, `var(--text-secondary)`,
`var(--bg-panel)`, `var(--bg-secondary)`, `var(--border-color)`, `var(--accent-primary)`,
`var(--success)`, `var(--danger)`, `var(--radius-md)`, `var(--radius-lg)`. Amber warnings use the
same hardcoded `#d97706` / `rgba(217,119,6,…)` pair Discounts already uses (project has no
`--warning` token — confirmed absent, do not invent one here either).

---

## 1. User flow

**Entry**: sidebar nav item "Cart limits" (icon: `PackageX` or `Scale` from lucide-react — pick
whichever reads clearer at 18px; `Scale` reads better for "a cap/balance" concept). Route
`/cart-limits`. Same nav placement tier as Discounts/Coupons (merchandising-rules group).

### 1.1 super_admin, no store switched (global view)
1. Lands on list → sees all global rules, `effective` = global (no override column shown).
2. Clicks **New rule** → modal opens → picks target type → picks targets → picks limit type →
   fills limit → optionally enables bulk exception → preview panel updates as they type →
   Save.
3. Success → toast, modal closes, list refetches, new row appears highlighted for 2s (see §8).
4. Failure paths: validation blocks Save (inline); `409` surfaces a named-conflict banner inside
   the modal (§5); network/server error → toast, modal stays open with the entered data intact.
5. Clicking a row's edit icon reopens the same modal pre-filled, same flow, `PUT` instead of `POST`.
6. Clicking the row `Switch` toggles enabled/disabled optimistically; a toggle-on collision (409)
   reverts the switch and shows the same named-conflict pattern as create (toast, not modal, since
   there's no open form to show it in — see §5.4).
7. Clicking delete → `ConfirmDialog`. If the rule has store overrides, the dialog **escalates**
   (§7) to name the affected stores and require an acknowledgement checkbox before Delete unlocks.

### 1.2 super_admin, store switched via the app header (viewing store X)
1. Lands on list → sees all global rules **plus** an "Your store" column resolved for store X.
2. Row-level "Edit override" action (pencil-in-a-circle, distinct icon from the global Edit) opens
   the lightweight **Store-override panel** (§4), not the full modal.
3. Global Edit/Delete/Toggle are still available (super_admin always has full CRUD, regardless of
   switched store) — both actions coexist on the row without crowding (see wireframe §2.3).

### 1.3 store_admin (always scoped to their one store)
1. Lands on list → sees all global rules, **read-only** — no New-rule button, no row Edit/Delete
   icon on the global rule itself.
2. Sees "Your store" value per row: either "Same as global" (no override) or the override value.
3. Clicks "Edit override" (or "Add override" if none exists yet) → Store-override panel (§4) →
   changes number(s) and/or on/off → Save.
4. Clicks "Reset to global default" on a row that has an override → confirm-free single action
   (no destructive-confirm needed — it's reversible in one click either direction, see §4.4) →
   optimistic removal of the override row.
5. Cannot reach the full create/edit modal by any path (route param tampering still 403s
   server-side; FE simply never renders the entry point — mirrors the Discounts pattern where
   store_admin already sees the page but the create button pattern doesn't apply there since
   Discounts has no role split — **this is the first admin screen with a real two-tier role split
   inside one page**, call this out to tanmoy-web explicitly).

### 1.4 Exit points
- Save success → back to list (both modal and override panel).
- Cancel / Esc / backdrop click → close, discard draft, no confirm needed (form has no
  destructive side effect until Save — matches Discounts' `onKeyDownModal` Esc-to-close, gated off
  while a nested confirm/below-cost-style gate is open).
- Delete confirmed → back to list, row removed (soft: `enabled` semantics aside, deletion here is
  a real delete per the API contract, not a disable — see §7 copy).

---

## 2. List page

### 2.1 Header (identical structure to Discounts)
```
Cart limits                                    [ + New rule ]   ← super_admin only
Set how much of an item or category a customer can buy in one order.
```
store_admin sees no "+ New rule" button; the subtitle copy adds a second line:
`Global rules are set by Haper HQ. You can adjust the numbers for your store below.`

### 2.2 Filter bar (same visual bar as Discounts' filter row)
- `Target type` select: All / Category / Sub-categories / SKUs.
- `Status` select: All / Enabled / Disabled.
- Row count on the right, same as Discounts (`{n} rule{s}`).
- No store filter — the store context comes from the app-level switcher, not a page-local one
  (Discounts has a store filter because one Discounts *list call* spans stores; this feature's
  list call is always scoped to "global + my/switched store", so a second picker would be
  redundant chrome).

### 2.3 Table — columns, in order

| Col | Content | Notes |
|---|---|---|
| (dot) | enabled/disabled indicator | Reuse Discounts' `activeNow`-dot pattern but simplified: solid `var(--success)` dot = enabled, hollow ring = disabled. No "activeNow" concept here (no schedule), so this column is just enabled/disabled — keep the same 8px dot sizing for visual rhythm. |
| Name | rule name + description (truncated), **+ dangling-target warning chip inline** if applicable (§7 list-row treatment: see below) |
| Target | resolved, human names — "Mustard Oil + Refined Oil" (≤2 names shown inline, 3+ collapses to "N sub-categories" with `title=` full list, same `targetsSummary` pattern as Discounts) |
| Limit | **Global** value, human units: "2 L combined" / "5 units" (never raw ml/g) |
| Bulk exception | "Packs ≥ 5 L: 1/SKU" or "—" if none |
| Your store *(store context only)* | override value if present ("3 L combined"), or muted "Same as global" if not. **Store_admin always sees this column; super_admin sees it only when a store is switched.** |
| Enabled | `Switch` — global on/off. store_admin: **disabled/read-only** switch here (grey, `title="Only Haper HQ can turn this rule fully off. Turn it off for your store from Edit override."`) — see §4.5 for the store-level on/off, which lives inside the override panel, not this column. |
| Actions | super_admin: Edit (pencil) + Delete (trash) icons, same `ghostIconBtn` as Discounts. When a store is switched, **add** a third icon — "Edit override" (a pencil inside a small store/building glyph, or reuse `Edit2` at a visually distinct weight — recommend a 1px-lighter ghost button so it doesn't compete with the primary Edit). store_admin: **only** the override icon (no pencil/trash on the global rule). |

Numbers always **right-aligned** within their cell content block where more than one number
appears (Limit / Bulk / Your store columns) — per this codebase's dense-table convention.

**Row-level dangling-target chip** (§7 of the plan, "silently matches nothing" risk): if the list
response resolves a target id to `{ _id, name: null, missing: true }`, render a small amber chip
next to the rule name:
```
Cooking Oil  [⚠ target removed]
```
`title` on hover: `"This rule targets a category or item that no longer exists in the catalog — it may not be enforcing anything. Edit the rule to fix its targets."` Same visual treatment as Discounts' `flagOff` amber note (color `#d97706`, `AlertTriangle` 11px icon), but as an inline pill next to the name rather than a second line, since this is a data-integrity warning about the row itself, not a per-store operational note.

### 2.4 States

**Loading** — skeleton rows, same shape as `SkeletonRows` in DiscountsPage (dot / name-bar /
target-bar / limit-bar / bulk-bar / [your-store-bar] / switch-pill), 3 rows.

**Error** (list fetch failed) — identical `errorCardStyle` block: icon + "Couldn't load cart limit
rules" + "Check your connection and try again." + Retry button.

**Empty — no rules at all** (super_admin):
```
        [ icon: Scale, in accent-tinted circle ]
        No cart limits configured yet
        Set a limit to stop one customer from buying out a
        scarce item — e.g. "2 L of cooking oil per order."
        [ + Create your first limit ]
```
Same `emptyStateStyle` box as Discounts' empty state.

**Empty — no rules at all** (store_admin): same illustration/copy, no CTA button (nothing for
them to create):
```
No cart limits configured yet
Haper HQ hasn't set any cart limits. When they do, you'll be
able to adjust the numbers for your store here.
```

**Empty — filtered to nothing**: same "No rules match these filters. Clear filters" pattern as
Discounts.

**Reference-data fetch errors** (categories/sub-categories/items needed to resolve target names):
same inline amber-on-red `inlineFetchErrorStyle` banner row as Discounts' stores/categories
errors, with per-source Retry. If target names can't be resolved, show the raw id truncated
(`682a33…bbf7`) rather than blank — never a blank cell (this codebase's stated anti-pattern).

**Disabled row rendering**: same visual treatment as Discounts — row content stays full-opacity
(not greyed en masse), only the `Switch` itself shows off; a disabled row's "Your store" override
(if any) is shown but muted (`color: var(--text-secondary)`) since it has no effect while the
global rule is off.

---

## 3. Create/Edit modal (super_admin only)

Same panel chrome as `DiscountRuleFormModal`: `overlayStyle`/`panelStyle`, header with icon + title
+ close X, scrollable body in `Section` blocks, sticky footer with Cancel + Save.

### 3.1 Name / description
Identical to Discounts: `Name` (required), `Description` (optional, "not shown to customers"
hint).

### 3.2 Section: "Target" (mutually exclusive — this is the one structural deviation from
Discounts' targeting, which is additive: All-items / Categories / SKUs can combine there. Here
they cannot.)

```
Target
┌─────────────────────────────────────────────┐
│  ( ) Category        ( ) Sub-categories  ( ) SKUs   ← SegmentedToggle, 3 options
│                                                │
│  [ shown only for the selected option: ]      │
│  Category    → single-select dropdown of categories (a rule targets exactly one
│                category as a whole; multiple categories in one pool isn't a
│                supported shape per the plan's "one target type per rule" rule —
│                if HQ wants two categories pooled, that's two rules)
│  Sub-categories → the SkuPicker-style searchable multi-select, but against
│                /admin/sub-category search (chips, same remove-X affordance)
│  SKUs        → the exact SkuPicker component from Discounts, unmodified
│                (search by name/iId, chip list, same "no product identity"
│                guard for items without an iId)
└─────────────────────────────────────────────┘
```
Switching the segmented toggle **clears** the other two target arrays immediately (no silent
carry-over) — same "All items clears the others" defensiveness as Discounts' `handleAllItemsToggle`,
just three-way instead of two.

`touchedTargets` error: `"Choose at least one <category/sub-category/SKU> for this rule to apply to."`
— phrase it in terms of the segment currently selected so the message is always concrete, not
generic.

**Why single-select for Category but multi-select for Sub-categories/SKUs**: the plan's
example ("Mustard Oil + Refined Oil pooled") is inherently a sub-category-level need; a
category-level rule ("Cooking Oil the whole category") naturally targets one category. If HQ later
needs two categories pooled, allow multi-select here too — flagged as a copy note, not a blocker,
since the schema (`categoryIds: [ObjectId]`) already supports it. **Recommend shipping
category as multi-select from day one** (same UI component, zero extra cost) rather than
artificially restricting to one — update: use the **same multi-select chip picker for all three
segments**, just pointed at a different search endpoint. This removes the asymmetry and is not
more code.

### 3.3 Section: "Limit"
```
Limit type     ( Size )  ( Units )       ← SegmentedToggle

[ if Size: ]
  Value            [ 2      ] [ L ▾ ]     ← number input + unit dropdown (L/ml, kg/g)
                    Internally stored as base units (ml or g) per §3.3 of the plan;
                    the unit dropdown just changes the multiplier/display, exactly the
                    way a human would type "2" and pick "L" rather than typing "2000".
  hint: "Combined across everything selected above."

  ☐ Bulk-pack exception
     "Some packs are big enough that a shopper buying just one of them
      shouldn't be blocked by the combined cap."
  [ if checked: ]
     Packs of at least   [ 5    ] [ L ▾ ]   are exempt from the combined cap,
     but capped at        [ 1    ]  unit(s) per SKU.

[ if Units: ]
  Max units        [ 5      ]
  hint: "A flat count, not a size — used for items sold as pieces
         (e.g. 'unit(s)') where a litre/kg cap doesn't apply."
  (Bulk-pack exception is not offered for Units — hidden entirely, not disabled,
   since it has no meaning here per §3.3 of the plan.)
```

**Unit-value entry UX**: admins think in "2 L" not "2000 ml". The form always displays/edits in
the larger human unit (L or kg) with a unit toggle (L/ml or kg/g) next to the number, and converts
to base units only when building the wire body — mirroring how `DiscountRuleFormModal` keeps IST
wall-clock times in the form and converts via `istInputToUtcIso` at submit. Do the same here with
a small `toBaseUnitsForForm(value, displayUnit)` helper on the FE (separate from, but numerically
identical to, the backend's `toBaseUnits`).

**Validation** (mirrors §4 pre-validate invariants 3–6 of the plan, surfaced as inline errors, not
just server 400s):
- `Value`/`Max units` must be a positive integer once converted to base units — `"Enter a value
  above 0."` If a fractional L/kg value converts to a non-integer base-unit amount (e.g. 0.001 L =
  1 ml is fine, but stray floating point from a weird input isn't), round and let the value survive;
  don't block over a display-rounding artifact.
- Bulk threshold < limit value → **inline, not just on submit** (evaluate live as both fields
  change): `"The bulk-pack threshold must be at least as large as the combined limit (2 L) — 
  otherwise a customer could buy just-over-threshold packs to dodge the cap entirely."` This is
  the exact plain-language reasoning from the plan's §4 invariant 6; use it verbatim, it's the
  right length and it's already been written to be understandable.
- Bulk max units < 1 → `"Enter at least 1 unit."`

### 3.4 Enabled toggle
Same as Discounts' pattern, but there's no schedule section here, so it sits right after Limit —
a plain `SegmentedToggle` or a labeled `Switch`: `Enabled` / `Disabled`, defaulting to Enabled on
create. Use the same `Switch` component the list row uses, for visual consistency, not a
segmented toggle here (a single binary is a Switch, not a 2-option segmented picker — that
distinction already exists in the codebase: Discounts uses `Switch` in the table row and
`SegmentedToggle` only where there are labeled semantic options like Global/Store).

### 3.5 Preview / blast-radius panel (§6 of the plan — the highest-priority state in this whole
spec; do not treat as a footnote)

Sits where Discounts' preview strip sits (bottom of form, above the footer), same debounce
mechanism (600 ms after Target/Limit fields settle), same loading/failed/empty ladder — but with
a **stronger visual escalation** than Discounts' preview, because the failure mode here
("nobody can buy oil") is worse than a wrong discount price.

```
┌ Preview ──────────────────────────────────────────────┐
│ This would affect ~37 items across 2 stores.           │
│                                                          │
│ ⚠ 3 items have a pack bigger than this limit and no     │  ← RED banner, not amber,
│   bulk exception — customers would not be able to buy   │    when unbuyableItems.length > 0.
│   them at all.                                          │    This is the one state in this
│   • Fortune Refined Oil - 15 Ltr (15 L pack)            │    whole spec that gets a danger-
│   • …show 1 more                                        │    tier treatment, per the plan's
│                                                          │    explicit ask to make it
│ ⚠ 2 items have unclear size data on the catalog and      │    "prominent, not a small
│   may not be capped correctly — worth checking their     │    footnote."
│   weight/unit on the Items page.                         │  ← amber, not red (data-quality,
│                                                          │    not a hard lockout)
└──────────────────────────────────────────────────────────┘
```

State ladder:
- `!canPreview` (target/limit invalid) → `"Nothing matches yet — check Target above."` (same copy
  pattern as Discounts).
- loading → same `Loader2` spin next to "Preview" label.
- failed → `"Preview unavailable right now. [Retry]"` (does not block Save — same as Discounts;
  a preview outage must never gate the actual write, it's an aid not a gate).
- 0 matches → `"Nothing matches yet — check Target above."`
- matches, no warnings → `"This would affect ~{n} items across {m} store{s}."` plain text, no
  banner chrome at all (don't manufacture alarm where there isn't any).
- `unbuyableItems.length > 0` → **red** banner (`var(--danger)` border/bg tint, same recipe as
  `errorCardStyle`'s red but as an inline note, not a full-width card): icon `AlertTriangle`,
  bold count, up to 3 named items with their pack size, "show N more" if truncated. Copy: *"N
  item(s) have a pack size bigger than this limit and no bulk exception — customers would not be
  able to buy them at all. If that's intended (e.g. deliberately taking a bulk SKU off-menu),
  you can still save."* — explicitly non-blocking per plan §8.12, but the copy must say so, or an
  admin will assume it's a hard stop and abandon a legitimate save.
- `itemsMissingSize.length > 0` → **amber** banner, same visual family as the Discounts
  below-cost warning: *"N item(s) have unclear size/weight data on the catalog and may not be
  capped correctly."* No item names needed inline if it clutters — a `title=` tooltip with the
  list is enough; this is secondary to the unbuyable warning.
- Both present → stack both banners, unbuyable (red) above missing-size (amber) — ordered by
  severity.

**This banner does not block Save.** Per plan §8.12, a legitimate "take this bulk SKU off-menu"
case exists. The Save button stays enabled; the risk communication is the whole job of this panel.

### 3.6 Conflict (409) state — target already covered

Triggered on Save when the API returns `409 { error, conflictingRuleId, conflictingTargetKey }`.
Render **inline inside the modal**, directly above the footer (not a toast — the admin needs to
act on it, a toast alone would need to be re-read):

```
┌────────────────────────────────────────────────────────┐
│ ⚠ This overlaps an existing rule                        │
│   "Mustard Oil" is already covered by an enabled rule    │
│   named "Cooking Oil". A sub-category can only belong    │
│   to one enabled rule at a time.                          │
│   [ Open "Cooking Oil" ]   ← link, opens that rule's edit │
│                              modal in place of this one   │
└────────────────────────────────────────────────────────┘
```
Resolve `conflictingRuleId` to a name via the already-loaded rules list (no extra fetch — the
conflicting rule is, by definition, in the current list). Red-tinted card, same recipe as
`errorCardStyle`. Save button stays enabled so the admin can adjust Target and retry without
closing the modal.

Same 409 shape applies to **toggle-on collision** from the list row — there, there's no open
modal, so surface it as a **toast** with an actionable link:
`toast.error(<>"Couldn't enable — <target> already covered by <ruleName>." </>)` — keep it a single
toast, not a modal, since the row-level toggle is a lightweight action and re-opening a whole
modal for it would be disproportionate.

### 3.7 Footer
`Cancel` / `Save cart limit` (create) or `Save changes` (edit) — identical styling/spinner
behavior to Discounts' `saveBtnStyle` + `Loader2` "Saving…" state. `disabled` when
`blocked` (name empty, target empty, limit invalid, bulk-threshold-below-limit) — **not**
disabled by preview warnings (§3.5).

---

## 4. Store-override panel (store_admin always; super_admin when a store is switched)

This must look and feel **structurally distinct from the full modal** — the plan's ask is
explicit: "clearly visually distinct from 'editing the real rule.'" Do this with:
- A **narrower** panel (max-width ~420px vs the full modal's 640px) — visually signals "this is a
  small patch, not the whole rule."
- A different accent: header icon uses a small store/building glyph (`Store` from lucide-react)
  instead of the rule-type icon, and the header shows the parent rule's name in a muted read-only
  strip so it's unmistakable which global rule this patches:
```
┌ Store override — Cooking Oil ─────────────────  X │
│ 🏬  Chhapra                                        │
│ ──────────────────────────────────────────────    │
│ Global default: 2 L combined · packs ≥5 L: 1/SKU   │  ← read-only, muted, no inputs
│ ──────────────────────────────────────────────    │
│ Enabled in this store   [ Switch: On ]             │
│                                                     │
│ Limit for this store                               │
│   [ 3 ] [ L ▾ ]         ← pre-filled with override, │
│                            or the global value if   │
│                            none exists yet          │
│                                                     │
│ ☐ Different bulk exception for this store            │
│   [ if checked: threshold + max-units inputs,        │
│     same shape as the global form's bulk fields ]    │
│                                                     │
│ [ Reset to global default ]     [ Cancel ] [ Save ] │
└─────────────────────────────────────────────────────┘
```
- `Reset to global default` is only shown/enabled when an override currently exists. It's a
  single click, **no confirm dialog** (per plan's acceptance criteria: "removing a store override
  restores the global default — no reset-to-0 state," framed as a safe, reversible action, not a
  destructive one — reopening the panel and setting new numbers is just as easy as undoing a
  mistaken reset).
- Fields left untouched from the global default show as **pre-filled but visually plain** (not
  bolded/highlighted) — only fields the admin actually changed should read as "this store's own
  value" after Save. On the **list row**, however, always show the override distinctly per §2.3
  ("Your store" column) regardless of which individual fields differ, since the row can't show a
  per-field diff at that density.
- **Target/name/scope fields never appear in this panel at all** — not disabled, not shown greyed
  out, simply absent. Disabled-but-visible invites "why can't I click this," an editorial decision
  to omit entirely reads as "this isn't the place for that," which is the correct message.

### 4.1 Validation
Same bulk-threshold-≥-limit rule as the global form, evaluated against **this store's own
effective values** (i.e. if the store only overrides the limit but keeps the global bulk
threshold, validate the new limit against the *inherited* threshold, not against nothing).
Same inline copy as §3.3.

### 4.2 role gate reminder for engineers
Route: `PUT /admin/cart-limit-rule/:id/store-override`. **The store id is never taken from any
client state or form field** — it's implicit server-side (`req.store._id`). The FE must never
render a store picker inside this panel, even for super_admin — the active-store switcher in the
app header is the only place that selection happens (§0 table). If super_admin has no store
switched, the "Edit override" action must not appear on the row at all (no store context = no
override to edit) — show a muted "Switch to a store to set an override" affordance instead if
super_admin hovers/attempts it without a store context (a `title` tooltip on a disabled ghost icon
is enough, no separate empty state needed).

### 4.3 Success/failure
Same toast pattern: `"Override saved for {storeName}"` / `"Override removed — {storeName} now
uses the global default"` on reset / error via `apiErrorMessage`.

---

## 5. Role-differentiated view — summary table

| Element | super_admin (global view) | super_admin (store switched) | store_admin |
|---|---|---|---|
| "New rule" button | visible | visible | hidden |
| Row: Edit (global) | visible | visible | hidden |
| Row: Delete | visible | visible | hidden |
| Row: global Switch | interactive | interactive | visible, **disabled**, tooltip explains why |
| "Your store" column | hidden | visible | visible (own store, always) |
| Row: Edit/Add override | hidden (no store context) | visible | visible |
| Full create/edit modal | reachable | reachable | **never reachable**, no route/action renders it |
| Store-override panel | not applicable | reachable, scoped to switched store | reachable, scoped to own store |

---

## 6. Interaction details

- **Hover/press**: identical to Discounts — ghost icon buttons get a subtle background on hover
  (reuse whatever hover CSS Discounts' `ghostIconBtn` relies on, likely a `:hover` class in
  `index.css` — verify the exact class name at implementation time since `ghostIconBtn` itself is
  inline-style-only in the TSX and the hover must come from a shared CSS rule already used
  elsewhere in the app).
- **Transitions**: `Switch` flip is instant/optimistic (no artificial delay) — matches Discounts.
  New-row highlight after create: a 2s background fade from a faint accent tint to transparent,
  `transition: background-color 1.5s ease-out` — a small "this is the thing you just made" cue,
  not applied anywhere else in this codebase today so implement it scoped to this page only
  (inline `transition` style on the row, toggled via a `justCreatedId` state that clears on a
  `setTimeout`).
- **Optimistic updates**: row Switch toggle (as described), override delete ("Reset to global
  default" removes the row's override value immediately, reverts on error same as Discounts'
  `handleToggle` catch block).
- **Destructive confirmation**: Delete rule → `ConfirmDialog tone="danger"`. If the rule has
  store overrides (`overrideCount > 0` — add this field to the list/detail response if not already
  planned; flag to sumit-backend if missing), escalate:
  ```
  Delete "Cooking Oil"?
  3 stores have their own override on this rule — deleting it removes
  their overrides too, and this can't be undone.
  ☐ I understand this also removes 3 store overrides
  [ Cancel ]  [ Delete ]  ← Delete disabled until checkbox ticked
  ```
  Uses `ConfirmDialog`'s existing `acknowledgeLabel` prop — exactly the "business-risk gate" this
  component already exists for (per this codebase's established `GiftTierFormModal`/discount
  precedent). If the rule has **no** overrides, plain `ConfirmDialog` with no checkbox, copy:
  `"Delete "{name}"? This rule stops applying to its targets immediately and can't be undone."`
  (No "soft delete/disable" framing here — unlike Discounts' delete-really-disables pattern, this
  API's DELETE is a real delete per §5 of the plan; say so honestly, don't borrow Discounts' "kept,
  not deleted" copy verbatim since it would be false here.)

---

## 7. Dangling-target warning — detail

Already specified at the row level (§2.3). Full behavior:
- Triggered when the list API resolves any target id to `{ name: null, missing: true }`.
- Amber chip inline next to the rule name (not a full-row treatment — the row is otherwise
  fully functional/readable).
- Clicking/hovering shows the tooltip copy above.
- Inside the **edit modal** for that rule, the specific missing target(s) render in their
  multi-select chip list with the same amber missing-state styling (chip background tinted amber,
  small warning glyph in place of the normal `X`-remove affordance replaced by **both** a warning
  icon and the remove `X` — the admin must be able to remove a dangling id from the chip list,
  that's the fix path) plus a hint line under the picker: `"This target no longer exists in the
  catalog — remove it or leave it (it won't match anything either way)."`

---

## 8. Empty state

Covered in §2.4 (list-level). No separate empty state needed elsewhere — the create modal and
override panel are always entered with intent (there's nothing to be "empty" about a fresh form).

---

## 9. Accessibility

- All modals: `role="dialog"` `aria-modal="true"` `aria-label` set to the mode ("Create cart
  limit" / "Edit cart limit" / "Store override — {ruleName}") — same as Discounts.
- Focus: on open, focus the Name field (create/edit modal) or the Limit-value field (override
  panel, since Name doesn't exist there) — mirrors `nameInputRef.current?.focus()`. On close,
  return focus to the row's triggering button (`previouslyFocused?.focus?.()`).
- `Esc` closes (both modal types), consistent with Discounts, disabled while any nested confirm
  (`ConfirmDialog`) is open on top.
- Segmented toggles (`SegmentedToggle`) already carry `aria-pressed`/roving-tab-index behavior —
  no new work, just reuse.
- Target multi-select chips: each has an `aria-label={"Remove " + name}` remove button — same as
  `SkuPicker`'s existing `chipRemoveStyle` button.
- Color is never the only signal: the enabled/disabled dot pairs with row content and a `Switch`
  with visible on/off state; the dangling-target chip pairs an icon + text, not just amber color;
  the unbuyable-preview banner pairs red + an explicit warning icon + text, never color alone.
- Contrast: reuse existing token pairs already verified elsewhere in this app (`var(--danger)` on
  `var(--bg-panel)`, `#d97706` on its own 6%-tint background) — per this codebase's established
  light/dark token behavior, do not introduce new hex values.
- Touch targets: all icon buttons ≥ 36×36px hit area (`ghostIconBtn`'s existing `padding: 8px`
  around a 15–20px icon already clears this; keep the same padding for the new "Edit override"
  icon).
- Table numeric cells: right-aligned per §2.3, consistent reading order for scanning size/cost
  columns.

---

## 10. Open items for engineering (things this spec assumes but that need confirming against the
final API before build)

1. **`overrideCount` on the list/detail response** — needed for the delete-escalation copy (§6).
   Not in the plan's §5 example payload; flag to sumit-backend/rajit-backend-arch — if omitted,
   the delete confirm falls back to the plain (non-escalated) copy and the cascade just happens
   silently, which is worse UX but not a blocker for Phase 0 sign-off.
2. **Sub-category and category search-by-name endpoints** for the target multi-select (§3.2) —
   Discounts' category picker uses a pre-fetched, capped-at-100 list (`/admin/category/catalog`),
   not a live search; confirm whether categories/sub-categories are few enough (as with Discounts)
   to reuse "fetch all up to 100, filter client-side" rather than building a new debounced search
   endpoint. Recommend mirroring Discounts exactly (fetch-all) unless sub-category count is known
   to exceed ~100.
3. **Unit-value display**: whether the API accepts/returns a display `baseUnit` alongside the
   converted value (the plan's example payload shows `baseUnit: "ml"` on the limit object) — this
   spec assumes yes (§3.3 depends on it for the L/ml, kg/g toggle default).

---

## 11. Platform note

This spec is web (haper-admin) only — no Android/iOS surface exists for this feature; it is purely
an admin-panel screen. No Material/HIG adaptation needed.
