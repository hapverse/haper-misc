# /config page redesign — design spec

**Screen:** `damin.haper.in/config` — "Platform Configuration" (super admin) / "Store Configuration" (store admin)
**Owner of this spec:** Chanchal (design). **Implementer:** web engineer, in a later phase, after sign-off.
**Date:** 2026-07-28
**Scope rule:** this is a **layout, hierarchy and copy** revamp. Same fields, same values, same endpoints
(`PUT /admin/config/store`, `/admin/config/support`, `/admin/config/not-serviceable`, `/admin/config/force-update`,
same gift-tier calls). Anything that changes what the page *does* is parked in §8 for the user to approve separately.

Files this spec covers:
- `/Users/office/Documents/haper/haper-admin/src/pages/Config/ConfigSettings.tsx`
- `/Users/office/Documents/haper/haper-admin/src/pages/Config/GiftTiersPanel.tsx`
- `/Users/office/Documents/haper/haper-admin/src/pages/Config/GiftTierFormModal.tsx` (colour token cleanup only)

---

## 1. Diagnosis — what is wrong, in plain language

### The one-line version
The page puts every settings box into a single row of equal-width columns, so on a wide monitor the boxes get
stretched to the height of the tallest one and the last box is left sitting alone with a huge empty black
space beside it.

### The concrete example
Open `/config` on a 2560px-wide monitor as a super admin. The browser fits **four** boxes across the row:

```
Store Controls | Maintenance Mode | Support Contact | Not Serviceable
Force Update   |     (empty)      |    (empty)      |    (empty)
```

- **Store Controls** is the tallest box — three price fields, two switches and a Save bar. Because all boxes in
  a row are forced to the same height, **Maintenance Mode gets stretched to match it**. Maintenance Mode has a
  title and one line of text and nothing else, so you get a box that is roughly 500 pixels tall and 90% empty.
- **Force Update** does not fit on the first row, so it drops to the second row **on its own** — leaving about
  **1700 pixels of empty black to its right**. That is the single thing that makes the page look broken.
- **Free Gift on Order** then sits *below* all of that at full page width. So one screen has three different
  widths: four-across, one-across-with-a-hole, and full-width. Nothing lines up.

### The other four problems (less visible, more damaging)
2. **No grouping.** Settings that affect **one store** (prices, picking, gift tiers) sit next to settings that
   affect **every customer on every store** (support phone number, "update your app" enforcement) with nothing
   telling them apart. A store manager changing the delivery fee and a super admin locking old app versions out
   are two completely different jobs, mixed on one screen.
3. **Four different Save behaviours.** Store Controls has one Save that stays greyed out until you actually
   change something. The other three Save buttons always look clickable, even when you have changed nothing —
   so you cannot tell whether you have unsaved work. And the buttons are worded four different ways
   ("Save Store Settings", "Save Support Contact", "Save Message", "Save Force Update").
4. **Everything shouts equally.** All six box titles are the same size, all six icons use the same purple
   tint, and every field has a small purple icon next to it. When everything is emphasised, nothing is. The
   "Enable picking" explanation alone is a three-line paragraph sitting inside a switch row.
5. **Two toast systems.** The page has its own hand-built "Saved" popup while the gift panel underneath uses
   the app-wide one, so two different popups can appear in the same corner.

---

## 2. Chosen information architecture — and why

### The recommendation (one, not a menu)

**A single centred column, capped at 1080px, split into two labelled groups. Inside each group, a two-column
card grid at ≥1180px viewport where the wide cards span both columns.**

```
                    ┌──── page-content (padding 2rem) ────┐
                    │                                     │
        (empty)     │   max-width 1080px, margin 0 auto   │     (empty)
                    │                                     │
                    └─────────────────────────────────────┘
```

**Group 1 — STORE SETTINGS** (always shown): Store Controls, Free Gift on Order. Both **full width**.
**Group 2 — PLATFORM SETTINGS** (super admin only): Support Contact | Not Serviceable Message side by side,
Force Update full width beneath them, Maintenance Mode as a single link row at the very bottom.

Why this and nothing else:

1. **The 1080px cap kills the dead space with no cleverness at all.** Today's bug exists only because the page
   is allowed to be 2400px wide. Cap it and the worst gap on the page becomes one 24px gutter. 1080px is
   already the house number — `ProfitPage.tsx:253` and `MostSoldItemsPage.tsx:222` both use it.
2. **`align-items: start` kills the stretching.** Cards then take their natural height. Maintenance Mode can
   never be inflated to match Store Controls again.
3. **Full-width store cards mean no orphans in any role state.** A store admin sees exactly two full-width
   cards stacked — a complete, deliberate-looking page. If the store cards were half-width, a store admin
   would see one card with a permanent hole next to it, which is the current bug in miniature.
4. **The two group headings are the missing information architecture.** They are the first time the page ever
   says out loud "this half changes your store, this half changes everything for everyone." That is the
   difference in blast radius that the save endpoints already encode but the UI never showed.
5. **Ordering inside Group 2 is risk-ordered**: routine first (Support Contact, Not Serviceable copy), highest
   blast radius last (Force Update, then Maintenance). This is the familiar "settings first, dangerous stuff at
   the bottom" pattern from GitHub / Stripe / Vercel settings pages — users already know it.

### What I rejected

| Rejected | Why |
|---|---|
| **Tabs / segmented control** | There is not a single tab anywhere in haper-admin (verified by grep across `src`). Inventing one here creates a bespoke, orphaned component and makes a product-wide navigation decision on one page. Worse: a store admin only has 2 sections, so they'd get a 2-item tab bar — more chrome than content. And `/config` is a flat route (`App.tsx:128`), so tabs would need either new URLs (a behaviour change) or local state that the store switcher's `window.location.reload()` (`AdminLayout.tsx:131-139`) destroys on every store change. |
| **Left settings-nav rail** | Same orphan problem, plus in light mode `--bg-panel` and `--bg-secondary` are both `#ffffff`, so a rail can only be separated by a border — it would read as a stray column, not navigation. Six sections do not justify a nav. |
| **Keeping `repeat(auto-fit, minmax(…))`** | This *is* the bug. `auto-fit` cannot express "two columns on a laptop, one column when the sidebar squeezes me" because it only knows its own width, not the breakpoint. Note `.form-grid-2col` in `index.css:419` has the identical failure mode — do not reach for it here. |
| **A sticky save bar at the bottom of the page** | No precedent in the app, and with four separate save endpoints one sticky bar would imply one Save, which would be a behaviour change. |
| **Accordions / collapsed sections by default** | Hides settings behind a click for no gain once the page is only ~2.5 screens tall. (One exception is proposed under approval in §8.) |

### Where I differ from the architect
I agree with Arijit's structure (grouped sections, 1080px cap, scoped `<style>`, no tabs). Three changes:
1. **Store Controls and Free Gift are full-width (span 2), not grid cells.** Store Controls is naturally a
   *wide and shallow* form (three short number fields + two switches), not a tall narrow one. Letting it span
   the full width turns it from the tallest card on the page into one of the shortest — which removes the root
   cause rather than just capping it. Free Gift contains a table; tables need width.
2. **Force Update spans full width too**, because three cards in a two-column grid leaves an orphan — the exact
   problem we are fixing, just smaller. Its body then becomes `320px | 1fr` (versions left, message right),
   which uses the width honestly instead of stretching two version inputs to 500px each.
3. **The breakpoint is 1180px, not 1100px.** At 1100px viewport the sidebar is 220px and page padding is 48px,
   leaving 832px — two 404px cards, which is too tight for a labelled form field with a hint. 1180px leaves
   912px → two 444px cards, which is comfortable.

---

## 3. Section-by-section layout rules

### 3.0 Spacing scale (use these names, nothing else)

| Name | px | rem | Used for |
|---|---|---|---|
| `s1` | 4 | 0.25 | label→hint gap, pill padding-y |
| `s2` | 8 | 0.5 | icon→text gap, inline gaps |
| `s3` | 12 | 0.75 | card header icon gap, group-title gap |
| `s4` | 16 | 1 | field gap, card body row gap, card body padding on mobile |
| `s6` | 24 | 1.5 | grid gutter, card body padding (desktop) |
| `s8` | 32 | 2 | gap between the two groups |

Radius: `var(--radius-md)` (8px) for inputs / inner boxes / buttons, `var(--radius-lg)` (12px) for cards.
Never introduce a third radius.

### 3.1 The scoped `<style>` block — copy this verbatim

Rendered as `<style>{scopedCss}</style>` as the last child of the page root, exactly like
`MaintenancePage.tsx:553` + `839-870`. Prefix `cfg-`.

```css
/* ── shell ───────────────────────────────────────────── */
.cfg-page {
  max-width: 1080px;
  margin: 0 auto;
  display: grid;
  gap: 32px;                       /* s8 between groups */
  position: relative;
}
.cfg-head { display: flex; justify-content: space-between; align-items: flex-start;
            gap: 16px; flex-wrap: wrap; }

/* ── group ───────────────────────────────────────────── */
.cfg-group { display: grid; gap: 16px; }               /* s4 heading → first card */
.cfg-group-head { display: flex; align-items: center; gap: 12px; }
.cfg-group-head::after { content: ''; flex: 1; height: 1px; background: var(--border-color); }
.cfg-group-title {
  font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--text-secondary); white-space: nowrap;
}

/* ── card grid ───────────────────────────────────────── */
.cfg-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;                       /* s6 gutter */
  align-items: start;              /* <- the line that kills equal-height stretching */
}
.cfg-span-2 { grid-column: 1 / -1; }
@media (min-width: 1180px) {
  .cfg-grid { grid-template-columns: 1fr 1fr; }
}

/* ── card ────────────────────────────────────────────── */
.cfg-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.cfg-card-head {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color);
}
.cfg-card-body { padding: 24px; display: grid; gap: 16px; }

/* ── field grids ─────────────────────────────────────── */
.cfg-fields-2, .cfg-fields-3 { display: grid; gap: 16px; grid-template-columns: 1fr; }
@media (min-width: 620px)  { .cfg-fields-2 { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 760px)  { .cfg-fields-3 { grid-template-columns: repeat(3, 1fr); } }

/* ── two toggle cards side by side (Store Controls) ──── */
.cfg-toggles { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
@media (min-width: 900px) { .cfg-toggles { grid-template-columns: 1fr 1fr; } }

/* ── Force Update body: versions left, message right ─── */
.cfg-fu-body { display: grid; grid-template-columns: 1fr; gap: 24px; }
@media (min-width: 1180px) { .cfg-fu-body { grid-template-columns: 320px 1fr; align-items: start; } }

/* ── maintenance link row ────────────────────────────── */
.cfg-linkrow {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 24px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  text-decoration: none;
  transition: border-color 150ms ease, transform 150ms ease;
}
.cfg-linkrow:hover { border-color: var(--accent-primary); }
.cfg-linkrow:hover .cfg-linkrow-chev { transform: translateX(3px); }
.cfg-linkrow-chev { transition: transform 150ms ease; }

/* ── inner boxes (toggle cards) — border, never fill ─── */
.cfg-inner {
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  transition: border-color 150ms ease;
}
.cfg-inner--on { border-color: var(--accent-primary); }

/* ── inputs ──────────────────────────────────────────── */
.cfg-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 0.9375rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: border-color 120ms ease;
}
.cfg-input:hover { border-color: var(--text-secondary); }
.cfg-input:focus { border-color: var(--accent-primary); }

/* ── footer bar ──────────────────────────────────────── */
.cfg-footer {
  display: flex; justify-content: space-between; align-items: center;
  gap: 16px; flex-wrap: wrap;
  padding-top: 16px; margin-top: 4px;
  border-top: 1px solid var(--border-color);
}

/* ── scope pill (border only — light-mode safe) ──────── */
.cfg-scope {
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 999px;
  border: 1px solid var(--border-color); color: var(--text-secondary);
  background: transparent; white-space: nowrap; flex-shrink: 0;
}

/* ── focus ring (applies to everything on the page) ──── */
.cfg-page a:focus-visible,
.cfg-page button:focus-visible,
.cfg-page input:focus-visible,
.cfg-page textarea:focus-visible,
.cfg-page [role="switch"]:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
  border-radius: var(--radius-md);
}

/* ── mobile: carry our own padding rule (see §9) ─────── */
@media (max-width: 768px) {
  .cfg-page { gap: 24px; }
  .cfg-grid { gap: 16px; }
  .cfg-card-head, .cfg-card-body, .cfg-linkrow { padding: 16px; }
  .cfg-footer { flex-direction: column; align-items: stretch; }
  .cfg-footer button { width: 100%; justify-content: center; }
}

/* ── reduced motion (precedent: MaintenancePage.tsx:867) ── */
@media (prefers-reduced-motion: reduce) {
  .cfg-page *, .cfg-page [role="switch"] span {
    transition: none !important;
    animation: none !important;
  }
}
```

### 3.2 Breakpoint table (viewport width → what happens)

Usable content width = viewport − sidebar − `.page-content` padding.

| Viewport | Sidebar | Usable | Cards per row | Notes |
|---:|---:|---:|---:|---|
| 2560 | 260 | 2236 → **capped 1080** | 2 | The fix. Empty space is symmetric margin, not a hole. |
| 1440 | 260 | 1312 → **capped 1080** | 2 | Two 528px cards. |
| 1366 | 260 | 1042 | 2 | Two 509px cards. Container is 1042 (under the cap). |
| 1280 | 220 | 1012 | 2 | Two 494px cards. |
| 1180 | 220 | 912 | 2 | Two 444px cards — the floor for two columns. |
| 1179 | 220 | 911 | **1** | Single column. Field grids inside stay 2-up / 3-up so cards never look stretched. |
| 1024 | 200 | 784 | 1 | Toggles still 2-up (≥900 rule fires at 900 viewport). |
| 899 | 200 | 659 | 1 | Toggles stack. |
| 768 | drawer | ~736 | 1 | Mobile padding rules fire; footers stack, Save goes full width. |
| 480 | drawer | ~456 | 1 | All field grids 1-up. |

### 3.3 Per-section rules

#### A. Page header — no group, sits above both groups
- `.cfg-head`. Left: `h1` + subtitle. Right: nothing (deliberately — the store switcher in the top nav at
  `AdminLayout.tsx:127-161` already shows which store you are editing; a second scope chip here would duplicate it).
- h1 copy unchanged: `Platform Configuration` / `Store Configuration`.
- Subtitle unchanged.

#### B. Group 1 — STORE SETTINGS

**B1. Store Controls** — `.cfg-card .cfg-span-2` (full width in both 1-col and 2-col modes).

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚙  Store Controls                                    [ THIS STORE ]  │
│    Pricing, fees and delivery rewards for your store.                │
├──────────────────────────────────────────────────────────────────────┤
│ PRICING & FEES                                                       │
│ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐             │
│ │Free delivery ab│ │Delivery fee    │ │Platform fee    │  .cfg-fields-3
│ │ ₹ 150          │ │ ₹ 15           │ │ ₹ 1            │             │
│ │Carts at or abo…│ │Added to every …│ │Kept by Haper …│             │
│ └────────────────┘ └────────────────┘ └────────────────┘             │
│ ──────────────────────────────────────────────────────────────────── │
│ ┌───────────────────────────────┐ ┌───────────────────────────────┐ │
│ │ PICKER WORKFLOW               │ │ DELIVERY INCENTIVE            │ │ .cfg-toggles
│ │ Enable picking          [ ●]  │ │ Enable delivery incent. [○ ]  │ │
│ │ Adds a pick-and-pack step…    │ │ Bonus for riders who…         │ │
│ │                               │ │ (2 fields appear when ON)     │ │
│ └───────────────────────────────┘ └───────────────────────────────┘ │
│ ──────────────────────────────────────────────────────────────────── │
│ ● Unsaved changes                                        [   Save  ] │
└──────────────────────────────────────────────────────────────────────┘
```

- Section labels (`PRICING & FEES`, `PICKER WORKFLOW`, `DELIVERY INCENTIVE`) become the section label style in §5.
  The two toggle section labels move **inside** their own `.cfg-inner` boxes as the box's eyebrow — that is what
  lets them sit side by side without two stray headings floating above one row.
- Divider between pricing and toggles: `height:1px; background:var(--border-color)` (existing `dividerStyle`), full body width.
- `align-items: start` on `.cfg-toggles` so the Picker box does not grow when Delivery Incentive expands.
- **Height before/after:** today ≈ 620px tall × 320px wide. After: ≈ 330px tall × full width. This is what stops
  it inflating its neighbours.

**B2. Free Gift on Order** — `.cfg-card .cfg-span-2`. Structure unchanged from `GiftTiersPanel.tsx`; only the
header (icon/title per §5), the scope pill, and the card/footer classes change. The tiers table keeps
`.table-scroll`. Master-switch box uses `.cfg-inner` / `.cfg-inner--on`.

#### C. Group 2 — PLATFORM SETTINGS (super admin only)

**C1. Support Contact** — `.cfg-card`, column 1. Four stacked full-width fields (`gap: 16px`). At 444–528px card
width a single-column form is correct; do **not** two-up email/phone (an email input needs the width).

**C2. Not Serviceable Message** — `.cfg-card`, column 2. Title input, subtitle `<textarea rows=3>`, button-text
input, all full width. Sits opposite Support Contact; both land within ~40px of each other in height and
`align-items:start` absorbs the rest.

**C3. Force Update** — `.cfg-card .cfg-span-2`, row below.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 📱  Force Update                                       [ ALL STORES ]│
│     Require customers to update to a minimum app version.            │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────┐  ┌────────────────────────────────────────────┐ │
│ │ Min iOS version  │  │ Update message                             │ │  .cfg-fu-body
│ │ [ e.g. 1.2.3   ] │  │ ┌────────────────────────────────────────┐ │ │  (320px | 1fr)
│ │ Min Android ver. │  │ │                                        │ │ │
│ │ [ 2.0.1        ] │  │ │                                        │ │ │
│ └──────────────────┘  │ └────────────────────────────────────────┘ │ │
│                       └────────────────────────────────────────────┘ │
│ ──────────────────────────────────────────────────────────────────── │
│ Use X.X.X format. Set 0.0.0 to disable.                  [   Save  ] │
└──────────────────────────────────────────────────────────────────────┘
```
Left column is a nested `display:grid; gap:16px`. Textarea `min-height: 132px; resize: vertical`.

**C4. Maintenance Mode** — **not a card. A link row.** `<Link className="cfg-linkrow cfg-span-2">`.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🔧  Maintenance Mode  · Take the app or a single store offline    ›  │
└──────────────────────────────────────────────────────────────────────┘
```
- One line, ~56px tall. Title `0.9375rem/600 var(--text-primary)`; the descriptor after the `·` is
  `0.8125rem/400 var(--text-secondary)`; on <620px the descriptor drops to a second line.
- New copy: title **`Maintenance Mode`**, descriptor **`Take the whole app or a single store offline`**, and a
  trailing right-aligned `Open ›` affordance. Drop "Moved to its own page" — after a redesign nobody remembers
  where it used to be, and it reads as an apology.
- Hover: border turns accent + chevron slides 3px. **No background change** — see the light-mode rule in §9.

---

## 4. The save model

**Default proposal = zero behaviour change.** Four buttons still write to four endpoints. What changes is that
the page finally *explains* them.

### 4.1 Three reinforcing signals of scope
1. **Group heading** — `STORE SETTINGS` vs `PLATFORM SETTINGS`.
2. **Scope pill in each card header** — `THIS STORE` or `ALL STORES` (`.cfg-scope`, border-only pill).
   - Store Controls, Free Gift → `THIS STORE`; when `activeStoreId === null` (super admin "All Stores") →
     `NO STORE SELECTED`. Derived from the `activeStoreId` already read at `ConfigSettings.tsx:14` — no new data.
   - Support, Not Serviceable, Force Update, Maintenance → `ALL STORES`.
3. **Footer status line** — states the reach in a sentence (table below).

### 4.2 Unified footer bar (identical in all five saveable cards)

```
[ status text, 0.75rem ]  ……………………………………………  [  Save  ]
```

| Card | Status line — clean | Status line — dirty | Button label | `aria-label` |
|---|---|---|---|---|
| Store Controls | `All changes saved.` | `● Unsaved changes` (amber, 600) | `Save` | `Save store controls` |
| Free Gift | `All changes saved.` | `● Unsaved switch change` (amber, 600) | `Save` | `Save free gift switch` |
| Support Contact | `Applies to all stores. Apps update within minutes.` | *(no dirty state today)* | `Save` | `Save support contact` |
| Not Serviceable | `Applies to all stores. Apps update within minutes.` | *(no dirty state today)* | `Save` | `Save not-serviceable message` |
| Force Update | `Use X.X.X format. Set 0.0.0 to disable.` | *(no dirty state today)* | `Save` | `Save force update` |

Notes:
- **All buttons read `Save`.** Four differently-worded buttons made the page feel like four apps. The card
  header says what you are saving; the footer says how far it reaches. Screen-reader users get the distinction
  from `aria-label` (mandatory — five identical "Save" buttons is otherwise an a11y regression).
- **Amber `#d97706` is kept hardcoded.** There is no `--warning` token in `index.css`; `#d97706` already appears
  at `ConfigSettings.tsx:777`, `GiftTiersPanel.tsx:386`, `MaintenancePage.tsx:740` and passes on both themes.
  Do not invent a token for one page.
- **Dirty copy loses the button name**: `● Unsaved changes — click Save Store Settings to apply` →
  `● Unsaved changes`. Once the button is 200px to the right on the same bar, naming it is redundant.
- Save button visual is unchanged (`--text-primary` fill / `--bg-primary` text), padding `10px 20px`,
  `font-size 0.875rem`, `font-weight 600`, `gap 8px`, radius `--radius-md`. Disabled = `opacity .55` +
  `cursor: not-allowed` (existing).
- Button states: idle `Save` + `Save` icon → in-flight `Saving…` + spinner (reuse `@keyframes spin`) →
  success flash `Saved` + `Check` icon for 2s (existing `savedFlash` logic, unchanged).

### 4.3 States every card must define

| State | What it looks like |
|---|---|
| **Loading** | Page header renders for real; both group headings render; then **skeleton cards** — a `.cfg-card` with a 140×14 `.skeleton-bar` in the head and 3 rows of 100%×38 bars in the body. Replaces today's centred "Loading configuration…" text (`ConfigSettings.tsx:216`). Precedent: `MaintenancePage.tsx:605-619`. |
| **Error (whole page)** | Replaces "Config could not be loaded." with an error card: `AlertTriangle` at `var(--danger)`, heading `Couldn't load settings`, hint `Check your connection and try again.`, and a `Retry` ghost button calling the existing `fetchConfig`. Copy the shape of `GiftTiersPanel.tsx:182-191`. |
| **Empty** | Only Free Gift has a true empty state — keep the existing teaching empty state (`GiftTiersPanel.tsx:216-227`), it is already good. |
| **Success** | Global toast (bottom-right) + the 2s `Saved` button flash. Both already exist. |
| **Disabled** | Save disabled when `!dirty` (Store Controls, Free Gift), when `isSaving`, or when `!canEdit` (Free Gift). Disabled = `opacity .55`, `cursor: not-allowed`, `aria-disabled`. Gift edit/delete icons and the master switch stay disabled without `canEdit` — unchanged. |

---

## 5. Hierarchy, typography and icon rules

### 5.1 Type scale (5 levels — no more)

| Level | Size | Weight | Colour | Where |
|---|---|---|---|---|
| L1 Page title | `1.875rem` (30px) | 700 | `--text-primary` | h1. Unchanged. |
| L1b Page subtitle | `0.9375rem` (15px) | 400 | `--text-secondary` | under h1 |
| **L2 Group heading (new)** | `0.75rem` (12px) | 700, `letter-spacing .1em`, UPPERCASE | `--text-secondary` | `STORE SETTINGS` / `PLATFORM SETTINGS`, with a hairline rule running to the right edge |
| L3 Card title | **`1.05rem` (16.8px)** | **600** | `--text-primary` | h2. **Down from `1.15rem`/700.** |
| L3b Card subtitle | `0.8rem` (12.8px) | 400, `line-height 1.45` | `--text-secondary` | one line, hard limit |
| L4 Section label | `0.7rem` (11.2px) | 700, `letter-spacing .08em`, UPPERCASE | `--text-secondary` | `PRICING & FEES` etc. (weight 600 → 700) |
| L5 Field label | `0.8125rem` (13px) | 500 | `--text-primary` | |
| L5b Input text | `0.9375rem` (15px) | 400 | `--text-primary` | |
| L6 Hint | `0.75rem` (12px) | 400, `line-height 1.4` | `--text-secondary` | **max 2 lines at 440px card width** |

**Why card titles shrink:** with a group heading above them, card titles no longer have to carry the page's
structure. Dropping 1.15rem/700 → 1.05rem/600 makes the group headings and the h1 the only things that lead.

> **Gotcha — pick 1.05rem exactly, not 1rem.** `index.css:373` forces `.page-content h2 { font-size: 1.05rem
> !important }` below 768px. If you set 1rem, card titles get *bigger* on phones than on desktop. 1.05rem makes
> desktop and the forced mobile value identical, so there is nothing to fight.

### 5.2 Icon rules

**Rule: accent purple is reserved for things you can act on. Decoration goes neutral.**

| Icon | Today | New |
|---|---|---|
| Card header icons (Settings2, Gift, Headphones, Smartphone, Wrench) | 20px accent, inside a 36px accent-tinted tile | **18px, `var(--text-secondary)`, no tile.** Precedent: `MaintenancePage.tsx:257` uses a bare icon, no tile. |
| Not Serviceable header icon | `AlertTriangle` accent | **`MapPinOff`, `var(--text-secondary)`.** AlertTriangle wrongly signals danger and collides with Maintenance's real danger semantics. This card is just app copy. |
| Field micro-icons (`IndianRupee`, `Truck`, `Percent`, `Timer`, `Gift` at 14px) | one per field label | **Remove all five.** Five different tiny icons next to five labels is noise, not scanning aid — the `₹` prefix inside the input already carries the unit and "Delivery fee" does not need a truck. This is the single biggest craft win on the page. |
| Switch (ON) | accent | **keep accent** — it is state you act on |
| `.cfg-inner--on` border | accent | **keep accent** |
| Gift empty-state icon | accent | **keep accent** — it sits inside a call-to-action block |
| Gift status pills | `#16a34a / #6b7280 / #6366f1 / #d97706` | **keep as-is** — a status palette must not collapse into one hue |
| Save icon / Check | inherits button text colour | keep |
| Maintenance chevron | `--text-secondary` | keep, add the 3px hover slide |

Removing the tiles also removes six `color-mix()` calls and buys back 36px of header height per card.

### 5.3 Copy rules — exact new strings

**Rule for hints: one sentence, ≤ 90 characters, no "leave off to keep things as they are" (that is what "off"
means). If a hint needs two sentences it belongs in an `InfoTooltip`.**

| Where | Current | **New (use verbatim)** |
|---|---|---|
| Picking hint | "Orders flow Open → Picking → Packed → Assigned. A pick task is created per order and a rider can only be assigned once the order is packed. Leave off to keep the current flow unchanged." (3 lines) | **`Adds a pick-and-pack step: Open → Picking → Packed → Assigned. Riders are assigned only after packing.`** |
| Field label | "Minimum order value for free Delivery" | **`Free delivery above`** — see the flag below |
| …its hint | "Smallest cart total for free delivery." | **`Carts at or above this get free delivery.`** |
| Field label | "Delivery Charges" | **`Delivery fee`** |
| …its hint | "Fee added to every delivery order. Set 0 for free delivery." | **`Added to every delivery order. 0 = always free.`** |
| Field label | "Platform Charges" | **`Platform fee`** |
| …its hint | "Small fee retained by the platform per order." | **`Kept by Haper on each order.`** |
| Incentive hint | "Reward riders who complete orders within the time window." | **`Bonus for riders who deliver within the time window.`** |
| Reward field label | "Reward per eligible order" | **`Bonus per order`** |
| …its hint | "Bonus paid to rider for each on-time delivery." | **`Paid to the rider for each on-time delivery.`** |
| Office address hint | "Leave blank to hide the office address in the apps" | **`Leave blank to hide it in the apps.`** |
| Force Update footer | "Use `X.X.X` format (e.g. `1.2.3`). Set to `0.0.0` to disable." | **`Use X.X.X format. Set 0.0.0 to disable.`** (drop the `<code>` tags — three code chips in a 12px footer is visual litter) |
| Maintenance descriptor | "Moved to its own page — take the whole app or a single store offline, with live countdowns." | **`Take the whole app or a single store offline`** |

> ⚠ **One flag before shipping the `Free delivery above` label.** Confirm with backend that
> `minimumOrderValue` **only** gates free delivery and does not also block checkout below that amount. The
> current label says "for free Delivery" so the intent looks right — but if it also enforces a minimum cart, keep
> the label as `Minimum order value for free delivery` (lowercase "delivery" either way; today's capital D is a typo).

---

## 6. The three role / state views

### 6.1 Store admin — 2 sections, no group headings

`isSuperAdmin === false`. Only Store Controls + Free Gift render.

**Rule: group headings render only when two or more groups render.** With a single group, a heading that says
"STORE SETTINGS" under a title that already says "Store Configuration" is noise. So a store admin sees:

```
Store Configuration
Manage the commercial settings for your assigned store.

┌────────────────────────── Store Controls ─────────────────────────┐
│ pricing 3-up · picker | incentive · save bar                      │
└───────────────────────────────────────────────────────────────────┘
┌────────────────────── Free Gift on Order ─────────────────────────┐
│ master switch · tiers table · save bar                            │
└───────────────────────────────────────────────────────────────────┘
```

Two full-width cards, ~900px of content in a 1080px column. **Nothing looks missing**, because full-width store
cards do not leave a hole where the platform cards would have been. Contrast with today: as a store admin the
current page renders one 320px card floating in a 2200px row.

Scope pills still render (`THIS STORE`) — a store admin with two stores assigned still benefits from seeing that
they are editing one of them, and it costs nothing.

If `canEditStoreConfig` is false: the Free Gift master switch, Add/Edit/Delete and its Save are disabled
(existing behaviour) — the card stays visible in read-only form. No layout change.

### 6.2 Super admin + a store selected — 6 sections, the full page

`isSuperAdmin === true`, `activeStoreId !== null`. This is the canonical view.

```
Platform Configuration
Manage both store-scoped settings and global operational controls.

STORE SETTINGS ────────────────────────────────────────────────────────
┌─────────────────────── Store Controls  [THIS STORE] ────────────────┐
└─────────────────────────────────────────────────────────────────────┘
┌───────────────────── Free Gift on Order [THIS STORE] ───────────────┐
└─────────────────────────────────────────────────────────────────────┘

PLATFORM SETTINGS ─────────────────────────────────────────────────────
┌──── Support Contact  [ALL STORES] ───┐ ┌ Not Serviceable [ALL STORES]┐
│ email / phone / address / hours      │ │ title / subtitle / button   │
│ ● save bar                           │ │ ● save bar                  │
└──────────────────────────────────────┘ └─────────────────────────────┘
┌──────────────────── Force Update  [ALL STORES] ─────────────────────┐
│ versions │ message                                     ● save bar   │
└─────────────────────────────────────────────────────────────────────┘
┌ 🔧 Maintenance Mode · Take the whole app or a single store offline ›┐
└─────────────────────────────────────────────────────────────────────┘
```

Balance check: three full-width blocks + one paired row + one link row. Largest empty area anywhere on the page
is a single 24px gutter or the height difference between Support Contact and Not Serviceable (~40px, absorbed by
`align-items:start` as a clean bottom edge, not a stretched box).

Below 1180px this becomes five stacked full-width blocks + the link row. Still balanced — nothing orphans,
because there is no second column to orphan into.

### 6.3 Super admin + "All Stores" — 6 sections, gift panel inert

`isSuperAdmin === true`, `activeStoreId === null`.

- Group heading + card layout **identical** to 6.2. Do not reflow — a layout that jumps when you change the
  store switcher (which triggers `window.location.reload()`) feels broken.
- **Store Controls**: scope pill reads `NO STORE SELECTED`. Fields and Save behave exactly as today
  (no behaviour change).
- **Free Gift**: today it renders one bare sentence (`GiftTiersPanel.tsx:159`), which makes the card look
  broken. Restyle it as a proper empty state using the panel's own `emptyStateStyle` shape — dashed border,
  centred, ~180px tall, so the card has real presence instead of collapsing:

```
┌─────────────── Free Gift on Order  [NO STORE SELECTED] ─────────────┐
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│                              🎁                                    │
│                     Pick a store to manage gifts                   │
│           Gift tiers are set per store. Use the store switcher      │
│                       at the top of the page.                      │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
└─────────────────────────────────────────────────────────────────────┘
```
  Gift icon at `var(--text-secondary)` (not accent — there is no action to take here). Footer save bar is not
  rendered in this state, exactly as today.

---

## 7. Delivery Incentive — my decision

**Decision: keep it rendered, in place, fully editable. Demote it by position and by copy only. Do not hide it,
do not collapse it, do not label it "deferred".**

Reasoning:

1. **Hiding a persisted setting creates a trap.** `deliveryIncentiveEnabled` is a real field on
   `PUT /admin/config/store`. If it were ever ON for a store — set by an older build, a migration, or a direct
   DB edit — hiding the toggle would leave riders being paid a bonus with **no way to turn it off from the
   admin panel**. A settings page must always be able to undo the state it can create.
2. **A collapsed "Advanced" accordion has the same problem as tabs.** There is no accordion anywhere in
   haper-admin. Introducing one new interaction pattern for one toggle is not worth the precedent.
3. **Position + the toggle row make demotion free.** Placing it in the **right** slot of `.cfg-toggles` (Picker
   Workflow on the left, first in reading order) costs **zero extra vertical space** — when it is OFF, the whole
   section is one 88px box that sits beside a box that is already there. Compare with today, where it is a full
   third section stacked below everything and adds ~150px of height. That is real demotion without hiding.
4. **The two conditional fields still reveal on ON**, in a `.cfg-fields-2` grid inside the box. Unchanged.

**What I do NOT do:** add a "Not in use" / "Beta" / "Deferred" pill. That would be putting an internal roadmap
decision into a customer-facing admin UI, and the client did not ask for it.

If the user later wants it gone from the default view, §8 item 5 has the approval-gated version.

---

## 8. Behaviour changes needing SEPARATE user approval

None of these are in the default spec. Each needs an explicit yes.

| # | Change | Why it is worth doing | Risk if skipped |
|---|---|---|---|
| **1** | **Add dirty-tracking to Support Contact / Not Serviceable / Force Update**, so their Save buttons disable until something actually changes — matching Store Controls and Free Gift. | It is the last remaining inconsistency in the save model. Right now three buttons look clickable when there is nothing to save, so the user cannot tell whether their edit landed. It also prevents pointless writes to three global endpoints that affect every customer. | The page still has two save behaviours. Users keep re-clicking Save "to be sure", firing needless global writes. Cosmetically fine, conceptually still muddled. |
| **2** | **Replace the page's hand-rolled toast** (`ConfigSettings.tsx:26, 226, 807`) **with the global `toast` store.** | The page currently runs two toast systems in the same corner — its own, and the global one used by `GiftTiersPanel`. Save Store Controls and then save a gift tier and you can get two differently-styled popups fighting for the same spot. This is closer to a bug fix than a feature. | Two visual languages for "saved", possible overlap, and ~20 lines of duplicated code with its own hardcoded `#16a34a` / `#dc2626`. **Toast position moves to the global Toaster's corner** — that is the visible change. |
| **3** | **Delete the local `Switch`** (`ConfigSettings.tsx:637-670`) **and import `components/common/Switch`.** | The shared one is a verbatim copy of this one (its own doc comment at `Switch.tsx:12-17` says so), plus it supports `disabled`, `tone` and `ariaLabel` — which this page needs for the a11y labels in §10. Pixel-identical. | Two switch implementations drift. The Config switches keep having no `ariaLabel` and no disabled state. |
| **4** | **Demote Maintenance Mode from a card to a link row.** | It has no body. As a card in a stretched grid it becomes a 500px-tall empty box — the second-worst thing on the page. As a 56px link row it looks deliberate and reads as "this lives elsewhere". | Keep it as a card and it stays the emptiest element on the page even after the width cap (it would be a short card next to a normal one). Strongly recommend approving this one. |
| **5** | *(Optional, my own)* **Put Delivery Incentive behind an "Advanced" disclosure** inside Store Controls, closed when the toggle is OFF, auto-open when ON. | Removes a deferred feature from the default view without making it unreachable. | Nothing breaks — §7 is a complete design without it. Only take this if the client says the incentive setting is confusing store managers. |
| **6** | *(Optional, my own)* **Rename the field label "Minimum order value for free Delivery" → "Free delivery above".** | Shorter, unambiguous, and fixes the stray capital D. | Only take it after backend confirms the field does not also enforce a minimum cart (see the flag in §5.3). If unconfirmed, keep the old wording — a mislabelled money field is worse than a clunky one. |
| **7** | *(Optional, my own, global)* **Give `.skeleton-bar` a base fill** in `index.css:228-233`. | It is `linear-gradient(90deg, rgba(255,255,255,.08) …)` — white-on-white. In **light theme it is invisible**, so every skeleton in the app (Maintenance, Gift tiers, and the new Config skeletons) shows nothing at all while loading. One-line fix: add `background-color: var(--track-bg);` before the gradient. | Light-theme users see a blank page during load instead of a skeleton. Affects pages beyond /config, which is why it is listed separately. |

---

## 9. Implementation notes for the web engineer

### 9.1 The two rules that will bite you

1. **Light-mode fill collision.** In `index.css:38-39`, `--bg-panel` and `--bg-secondary` are **both `#ffffff`**.
   Any surface separated only by fill is invisible in light theme. **Rule: separate surfaces with
   `1px solid var(--border-color)`, never with fill alone.** This is why `.cfg-inner` has a border, why
   `.cfg-scope` is a border-only pill, and why `.cfg-linkrow:hover` changes `border-color`, not `background`.
   Test every state in light theme before calling it done.
2. **`index.css:391` inline-padding gotcha.** The mobile override
   `[style*="padding: 2rem"] { padding: 1.25rem !important }` works by string-matching the **serialized inline
   style**. The Config cards currently use `1.5rem`, so they are not relying on it today — but the moment
   padding moves from an inline style into a `cfg-` class, that mechanism can never apply. That is why
   `.cfg-card-head`, `.cfg-card-body` and `.cfg-linkrow` **carry their own `@media (max-width: 768px)` rule** in
   §3.1. Do not delete it.

### 9.2 Mechanism
- One `<style>{scopedCss}</style>` as the last child of the page root, exactly like `MaintenancePage.tsx:553`
  with the CSS constant at the bottom of the file (`MaintenancePage.tsx:839-870`). No new dependency, no build
  change.
- Do **not** use `.form-grid-2col` / `.form-grid-2col-wide` (`index.css:419-430`) for page layout — they are
  `auto-fit` and carry the exact ultrawide bug being fixed. They are fine inside modals.
- Keep inline styles for one-off cosmetics; move anything that needs a breakpoint into the `cfg-` block.

### 9.3 Reuse these (exact import paths from `src/pages/Config/`)

| Thing | Path | Note |
|---|---|---|
| Switch | `'../../components/common/Switch'` | needs approval item 3 |
| ConfirmDialog | `'../../components/common/ConfirmDialog'` | already used by GiftTiersPanel |
| InfoTooltip | `'../../components/common/InfoTooltip'` | use if any hint refuses to fit one sentence |
| toast | `'../../stores/toastStore'` | needs approval item 2 |
| Skeleton | class `.skeleton-bar` (`index.css:228`) | see approval item 7 |
| Permissions | `'../../hooks/usePermission'`, `'../../constants/permissions'` | already used, **do not touch the gating logic** |

There is no shared Button / Input / Card / FormField in this codebase. Keep the local `Field` helper in
`ConfigSettings.tsx` (drop its `icon` prop per §5.2) and give it the `.cfg-input` class for its inputs.

### 9.4 Small but mandatory
- **Remove `outline: 'none'` from the input style** (`ConfigSettings.tsx:706`). An inline `outline:none` beats
  the `.cfg-page :focus-visible` rule, so leaving it in silently kills the focus ring. Move the whole input
  style to `.cfg-input`.
- **Token cleanup while you are in here:** `GiftTierFormModal.tsx:19` `ERR_RED = '#dc2626'` → `var(--danger)`.
  Keep the gift status palette (`GiftTiersPanel.tsx:21-24`) and amber `#d97706` as-is — documented exceptions.
- **Do not change** `isSuperAdmin` / `canEditStoreConfig` gating, the fetch logic, the payload shapes, or the
  `savedFlash` timing. Regrouping JSX is safe as long as the same conditionals wrap the same cards.
- **Do not store layout state** (expanded/collapsed, scroll, active section). The store switcher calls
  `window.location.reload()` (`AdminLayout.tsx:131-139`), so it would be wiped on every store change.
- Verify with `tsc -b` + `eslint` (no **new** errors — haper-admin has a non-zero eslint baseline).
- Check all three role states, both themes, at 2560 / 1440 / 1366 / 1180 / 1179 / 1024 / 768 / 480.

### 9.5 Test guides to update in the same session (project rule)

**Primary — `/Users/office/Documents/haper/haper-misc/test-admin-ui.md`** (this is the cross-cutting admin-UI
guide; add the next issue number, currently `Issue 12`):
- `## Issue 12 — /config page layout revamp`
- ✅ A. Super admin at 2560px — two groups, capped 1080px column, no card is alone on a row, no card is stretched taller than its content
- ✅ B. Super admin at 1366px and 1180px — two columns; at 1179px it collapses to one, nothing overflows horizontally
- ✅ C. Store admin — only Store Controls + Free Gift, **no group headings**, page looks complete
- ✅ D. Super admin + "All Stores" — layout identical, gift panel shows the "Pick a store" empty state, scope pill reads NO STORE SELECTED
- ✅ E. Light theme — every card border, inner toggle box, scope pill and the Maintenance link-row hover are visible
- ✅ F. Save scope — each Save still writes only to its own endpoint (network tab: `/store`, `/support`, `/not-serviceable`, `/force-update`)
- ✅ G. Keyboard — Tab order runs card by card, top to bottom; every focused control shows the 2px accent ring
- ✅ H. Mobile ≤768px — card padding tightens, save footers stack with a full-width button, no horizontal scroll
- ❌ I. No permission (`store_config.edit` absent) — gift editing stays disabled, layout unchanged

**Also update:**
- **`test-free-gift.md` § "I. Admin FE walkthrough"** — the gift panel now sits inside the **STORE SETTINGS**
  group with a `THIS STORE` scope pill; the "no store selected" notice is now a full empty state.
- **`test-maintenance-mode.md`** — add one line to the entry-point step: from `/config`, Maintenance is now a
  **single link row at the bottom of the PLATFORM SETTINGS group**, not a card.
- **`test-force-update.md`** — the admin-side screenshot/step description changes (versions left, message
  right); the customer-facing force-update screen is untouched.

---

## 10. Accessibility

- **Contrast (both themes).** All body/label text uses `--text-primary` or `--text-secondary`, both of which
  already clear 4.5:1 on their surfaces. Two things to verify by eye after implementation: (a) the amber
  `#d97706` unsaved text on `--bg-panel` — it is 12px **bold**, which puts it in the ≥3:1 large-text-ish band
  and it is never the only signal (the `●` dot and the enabled Save button carry it too); (b) the `.cfg-scope`
  pill at 11px on `--text-secondary` — if it measures below 4.5:1 in light theme, darken it to
  `--text-primary` rather than enlarging it.
- **Never colour-only.** Unsaved state = amber **+** `●` **+** the Save button becoming enabled. Switch state =
  colour **+** thumb position **+** `aria-checked`. Gift status pills = colour **+** dot **+** text label
  (already correct).
- **Focus.** 2px `var(--accent-primary)` outline with 2px offset on every interactive element (§3.1). Remove
  the inline `outline: 'none'` (§9.4). The Maintenance link row must show the ring on its whole row.
- **Focus order** follows DOM order, which follows visual order: h1 → Store Controls (3 price fields → picking
  switch → incentive switch → [revealed fields] → Save) → Free Gift → Support → Not Serviceable → Force Update
  → Maintenance link. No `tabindex` values above 0 anywhere.
- **Labels.** Every input keeps its wrapping `<label>` (the existing `Field` helper does this correctly).
  Switches get `ariaLabel` (`Enable picking`, `Enable delivery incentive`, `Enable Free Gift on Order`).
  Every Save button gets the `aria-label` from the §4.2 table — five visible "Save" buttons need distinct
  accessible names.
- **Groups.** Each group is a `<section aria-labelledby="cfg-group-store">` (and `…-platform`) with the group
  heading carrying that id, so screen readers announce "Store settings, region". Each card is a `<section>` with
  `aria-label` matching its title.
- **Touch targets.** Switches are 42×24 visually — pad the hit area to ≥44×44 with `padding: 10px; margin: -10px`
  on the button. Save buttons are 40px tall at 10px vertical padding — go to 44px on ≤768px (the full-width
  mobile footer rule already helps). Gift row icon buttons are 15px icons in a 0.35rem pad — bump to 8px pad
  (≈32px) and rely on the row spacing; they are already `aria-label`led.
- **Motion.** Everything animated is ≤150ms `ease` (border colour, chevron slide, switch thumb). The
  `prefers-reduced-motion` block in §3.1 kills all of it — same approach as `MaintenancePage.tsx:867`.
- **Live regions.** Toasts announce via the existing global `Toaster`. The unsaved-changes line should be
  `aria-live="polite"` so a screen-reader user hears that they have pending edits.
