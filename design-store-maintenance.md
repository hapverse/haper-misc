# Design Spec — Store-wise Maintenance Mode

Author: Chanchal (product design) · Date: 2026-07-22
Scope: (A) haper-admin control panel [PRIORITY] · (B) customer maintenance screen (web + Android + iOS)
Status: spec for implementation. I produce look + flow only — data-shape/endpoint notes are for
arijit-frontend-arch + backend to finalise; I flag them so the UI has something concrete to bind to.

---

## 0. What exists today (investigated, cite-by-path)

**Backend data model**
- Global config: `packages/shared/models/configs.schema.js` → `maintenance: { isActive, message, endTime }`. One
  global document. There is **no per-store maintenance field yet.**
- Store config: `packages/shared/models/stores.schema.js` → `config: { minimumOrderValue, deliveryCharges,
  pickingEnabled, warehouseEnabled, … }`. **No `maintenance` sub-object.**
- Admin write: `packages/admin/src/routes/config/controller.js` → `updateMaintenance` **explicitly rejects a store
  context** (`if (req.store) return 403 "Maintenance mode is only available for global app config."`) and is
  `SUPER_ADMIN`-only (`router.js` line 55). Blank/stale `endTime` on ON defaults to **now + 6h**
  (`MAINTENANCE_DEFAULT_DURATION_MS`).
- Customer read: `packages/user/src/routes/config/controller.js` → `GET /user/config`. Computes **effective**
  `isActive` (auto-lifts once `endTime` passes, even without a cron; lazy write-back flips the DB flag). Endpoint is
  **unauthenticated and store-agnostic today** (geo middleware bypasses `/config`, see
  `packages/user/src/middleware/geo.js`).
- Clients already send `x-store-id` on every request (Android `data/api/NetworkModule.kt` L101-102) — so the store
  id is *already on the wire* for `/user/config`; the backend just ignores it for that route today.

**Admin design system (all inline-style + CSS vars, no Tailwind in admin)**
- Tokens: `src/index.css` `:root` (dark) + `[data-theme]` (light). Dark/light both supported.
- Existing maintenance UI lives as a panel inside `src/pages/Config/ConfigSettings.tsx` (super-admin-only block,
  lines 431-485). Reusable local pieces there: `panelStyle`, `titleStyle`, `contentStyle`, `iconWrapStyle`,
  `footerBarStyle`, `Field`, and a `Switch` (L687-720), `toggleRowStyle`, `saveButtonStyle`, `toastStyle`.
- Time helpers: `src/pages/Config/configTime.ts` → `utcIsoToISTInput`, `istInputToUtcIso`, `IST_OFFSET_MS`.
- Table/list + empty/loading pattern: `src/pages/Stores/StoresList.tsx` (status pill L171-182, toolbar search,
  pagination). Modal pattern: `src/pages/Stores/StoreModal.tsx` (overlay + X + footer save).
- Toast: `src/stores/toastStore.ts` (`toast.success/error/warning`) rendered by `src/components/Toaster.tsx`.
- Tooltip: `src/components/common/InfoTooltip.tsx`. Store switcher (top bar): `components/layout/AdminLayout.tsx`.
- Route + gate: `App.tsx` → `/config` behind `PERMISSIONS.STORE_CONFIG.VIEW`; the maintenance block additionally
  gates on `isSuperAdmin`.

**Customer maintenance screens (already built for GLOBAL)**
- Android: `ui/screens/maintenance/MaintenanceScreen.kt` (gated in `MainActivity.kt` L317
  `configVM.isMaintenanceModeActive -> MaintenanceScreen(configVM)`). Live countdown from `endTime`.
- iOS: `Views/MaintenanceOverlayView.swift` (SF Symbol `wrench.and.screwdriver.fill`, live countdown).
- Web: **NOT IMPLEMENTED.** `types.ts` L434 declares the `maintenance` shape but `context/ConfigContext.tsx` only
  reads `support`/`notServiceable` — there is **no web maintenance screen and no gate.** This is a gap (see §B.4).
- Web brand tokens (`haper-web/index.html`): primary orange `#f97316` (500) / `#ea580c` (600), secondary green
  `#22c55e`. (Admin uses indigo `--accent-primary #6366f1` — the two products are intentionally different skins.)

---

## 1. Product decisions to confirm before build (flagged)

These change the data contract; UI is designed to degrade gracefully whichever way they land.

1. **Per-store maintenance storage.** Recommend `stores.config.maintenance = { isActive, message, endTime }`
   mirroring global (new, nullable → backward-compatible; Android Gson-safe). Confirm with arijit/backend.
2. **Effective precedence (customer read).** Recommend `/user/config` reads `x-store-id` and returns a single
   already-merged `maintenance` = **global if global effective-active, else the store's own effective-active.** This
   keeps every client's existing gate (`isMaintenanceModeActive`) unchanged — clients need **zero new logic**, only
   a new `scope`/`storeName` field for copy. Preferred over making clients merge two objects.
3. **"Scheduled" (future start) — needed or not?** Current model has **no start time**; ON is immediate. A true
   "Scheduled" badge needs a new `startTime`. **Recommend Phase 1 = immediate ON + auto-lift `endTime` only** (matches
   today's backend, zero migration). Ship badges `Off` / `Live`; reserve `Scheduled` (amber) for a Phase 2
   `startTime`. Spec below includes the Scheduled visual so Phase 2 drops in without a redesign.
4. **Overview fetch.** Recommend one dedicated super-admin endpoint `GET /admin/maintenance/overview` →
   `{ global: {…}, stores: [{ storeId, name, maintenance, effectiveDown }], serverNow }` so the screen loads global
   + all store states + a server clock (countdown skew guard) in a single call. Alternative: extend
   `GET /admin/store` to include `config.maintenance`. Either is fine for the UI; the dedicated one is cleaner and
   avoids paginating an operational kill-switch list.
5. **Write endpoint for a store.** `PUT /admin/config/maintenance` with `x-store-id` present should update **that
   store's** maintenance (super-admin only) instead of the current 403. Global write stays `skipStoreHeader`.
6. **Can store admins toggle?** No. Super-admin only (unchanged). Store admins get **read-only** visibility (§A.7).

---

# SURFACE A — Admin control panel (PRIORITY)

## A.1 Information architecture / placement

**Promote maintenance out of the Config page into its own route `/maintenance`** ("Maintenance" sidebar item,
super-admin-only), because it is now a full management screen and an incident-response tool that must be findable in
2 seconds, not buried under commercial settings. Remove the inline panel from `ConfigSettings.tsx` (or leave a
one-line "Maintenance moved →" link). Keep the same `SUPER_ADMIN` gate; add a new permission
`PERMISSIONS.MAINTENANCE.VIEW`/`.MANAGE` if the team prefers permission- over role-gating (mirror FE+BE — see the
known "permission mirror drift" gotcha).

## A.2 User flow

1. Super-admin opens **Maintenance** from the sidebar.
2. Screen loads: **Global master card** on top, **per-store list** below. Countdowns tick live.
3. **Global path:** flips the global switch → **confirm modal** ("Take the ENTIRE app down?") with message + duration
   → confirm → global card turns red "LIVE — all stores down, auto-lifts 4:30 PM"; every store row greys out with
   "Paused — global maintenance active".
4. **Per-store path (global OFF):** clicks a store row's **Manage** → **store editor modal** (message + duration +
   danger confirm) → "Take {store} down" → row badge → red "LIVE · auto-lifts 4:30 PM".
5. **Turn OFF (either):** click switch/▸ Restore → lightweight confirm → badge returns to grey "Off", toast
   "Service restored for {store}", **undo** available ~6s.
6. Exits: success toast on save; error toast + inline retry on failure; auto-lift happens server-side (countdown
   hits 0 → row refetches → badge returns to Off with a subtle "auto-lifted" flash).

## A.3 Layout & wireframes

Mobile-first. Page is a single column `display:grid; gap:1.5rem` (matches ConfigSettings root). At ≥900px the
per-store list becomes a real table; below that each store is a stacked card (same data, no horizontal scroll).

### Desktop (≥900px)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Maintenance                                          [ ● Live: 1 store ]   │  h1 + summary chip
│  Take the app — or a single store — offline for customers.                  │
├───────────────────────────────────────────────────────────────────────────┤
│ ╔═══════════════════════════════════════════════════════════════════════╗ │  GLOBAL master card
│ ║ ⚠  GLOBAL MAINTENANCE  ·  master kill-switch          [  ●○ OFF  ]     ║ │  red-tinted border/header
│ ║ Blocks Haper for EVERY store and EVERY customer, ignoring the per-      ║ │
│ ║ store settings below.                                                   ║ │
│ ║ ───────────────────────────────────────────────────────────────────── ║ │
│ ║ Status:  ● Off — customers can shop normally.                          ║ │  (when ON: red "LIVE" + countdown)
│ ╚═══════════════════════════════════════════════════════════════════════╝ │
│                                                                             │
│  STORES (3)                                     [ 🔍 Search stores…      ]  │  section header + search
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │ Store            Status                 Auto-lifts        Action        │ │  table head (var(--bg-secondary))
│ ├───────────────────────────────────────────────────────────────────────┤ │
│ │ 🏬 Chapra Main   ● LIVE (down now)      4:30 PM · 2h 14m  [ Manage ]    │ │  red pill + mono countdown
│ │    Bazaar Rd, …                          "Restocking today"             │ │  message preview (muted)
│ ├───────────────────────────────────────────────────────────────────────┤ │
│ │ 🏬 Siwan         ● Off                   —                [ Manage ]    │ │  grey pill
│ │    Station Rd, …                                                        │ │
│ ├───────────────────────────────────────────────────────────────────────┤ │
│ │ 🏬 Gopalganj     ● Off                   —                [ Manage ]    │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

### When GLOBAL is ON — per-store list is visibly moot (precedence)

```
│ ╔═══════════════════════════════════════════════════════════════════════╗ │
│ ║ ⚠  GLOBAL MAINTENANCE  ·  master kill-switch          [  ●● ON  ]  🔴  ║ │  header + border = --danger
│ ║ ───────────────────────────────────────────────────────────────────── ║ │
│ ║ ● LIVE — all stores down.  Auto-lifts 4:30 PM  ·  ⏱ 02:14:57          ║ │  red, mono live countdown
│ ║ "We're upgrading Haper, back shortly."               [ Edit ] [ Restore ]║ │
│ ╚═══════════════════════════════════════════════════════════════════════╝ │
│  ┌── Global maintenance is active — every store is down. ────────────────┐ │  amber info banner over list
│  │    Per-store settings are paused and resume when you lift it.          │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │ 🏬 Chapra Main   ⛔ Down (global)   —          [ Manage ]  ← disabled   │ │  row @ opacity .5, greyed
│ │ 🏬 Siwan         ⛔ Down (global)   —          [ Manage ]  ← disabled   │ │  its stored badge shown faint:
│ │ 🏬 Gopalganj     ⛔ Down (global)   —          [ Manage ]  ← disabled   │ │  "Store setting: Off" (preserved)
│ └───────────────────────────────────────────────────────────────────────┘ │
```

### Mobile (<900px) — store rows become stacked cards

```
┌─────────────────────────────────┐
│ ⚠ GLOBAL MAINTENANCE            │
│ master kill-switch  [ ●○ OFF ]  │
│ Blocks EVERY store & customer.  │
│ ● Off — shopping normal.        │
└─────────────────────────────────┘
  STORES (3)   [ 🔍 Search… ]
┌─────────────────────────────────┐
│ 🏬 Chapra Main Bazaar           │
│ ● LIVE · auto-lifts 4:30 PM     │
│ ⏱ 2h 14m  "Restocking today"    │
│ [        Manage        ]        │  full-width, thumb-reachable
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ 🏬 Siwan Station Rd             │
│ ● Off                           │
│ [        Manage        ]        │
└─────────────────────────────────┘
```

### Editor modal (per-store AND global reuse the same body; global adds the loud confirm)

```
        ┌──────────────────────────────────────────────┐
        │  Manage maintenance · Chapra Main        [X] │  StoreModal overlay pattern
        ├──────────────────────────────────────────────┤
        │  Turn on maintenance for this store   [ ●○ ] │  Switch (reused)
        │  Customers of THIS store see a "briefly       │
        │  down" screen. Other stores keep working.     │
        │                                               │
        │  Message to customers                         │
        │  ┌──────────────────────────────────────────┐ │  textarea (inputStyle)
        │  │ Restocking today — back by evening.      │ │  120-char soft limit + counter
        │  └──────────────────────────────────────────┘ │
        │                                               │
        │  Back online by                               │
        │  [ +2h ] [ +6h ✓] [ +12h ] [ +24h ] [Custom] │  duration chips → sets endTime
        │  End time (IST): [ 2026-07-22  16:30    📅 ]  │  datetime-local, IST via configTime
        │  Blank = defaults to 6 hours.                 │
        │  ┌────────────────────────────────────────┐   │
        │  │ ⚠ This blocks ordering for Chapra Main │   │  danger summary (only when turning ON)
        │  │   customers until 4:30 PM.             │   │
        │  └────────────────────────────────────────┘   │
        ├──────────────────────────────────────────────┤
        │                 [ Cancel ]  [ Take store down ]│  danger btn when ON; "Save" when editing
        └──────────────────────────────────────────────┘
```

## A.4 Editor: inline-expand vs modal — **recommendation: MODAL**

Use a **modal** (reuse `StoreModal.tsx` overlay shell), not inline row-expand. Reasons:
- Message + duration + a destructive confirm is a *focused* task; a modal centres attention and naturally hosts the
  "you're about to take a store down" confirmation in the same step (no separate `window.confirm`).
- The store list grows (Chapra + Siwan + Gopalganj + more coming); inline expanders shove rows around and break the
  scan-down-the-status-column reading pattern.
- It matches the product's own established pattern (StoresList row → StoreModal). Consistency beats novelty.
- The **switch inside the modal** is the safe toggle; the **row-level control is "Manage"** (opens modal) plus, for
  a store already Live, a quick **"Restore"** inline (turning OFF is low-risk, so it stays one-click + undo).

Exception: turning a store **OFF** does not need the full modal — inline **Restore** with a light confirm + undo
toast is enough (restoring service is the safe direction).

## A.5 Component inventory

| Component | Reuse / New | Notes |
|---|---|---|
| Page shell `grid; gap:1.5rem`, `h1` 1.875rem/700 | Reuse | Copy from `ConfigSettings.tsx` root + `StoresList` header. |
| `panelStyle` / `titleStyle` / `contentStyle` / `iconWrapStyle` / `footerBarStyle` | Reuse | Currently **local** to ConfigSettings — **lift to `src/components/common/Panel.tsx`** (shared by this page + Config). |
| `Switch` (ConfigSettings L687-720) | Reuse → **extract** | Move to `src/components/common/Switch.tsx`; already `role="switch"`, `aria-checked`, 42×24, 150ms. |
| `Field` (label+hint+icon) | Reuse → extract | Same file; lift alongside Switch. |
| Store list table + empty/loading | Reuse pattern | Base on `StoresList.tsx` (thead `var(--bg-secondary)`, `1rem 1.5rem` cells, row border, `overflowX:auto`). |
| Status pill | Reuse pattern → **new `MaintenanceBadge`** | Base on StoresList pill (L171-182). Variants below. Put in `src/components/common/StatusBadge.tsx`. |
| Editor modal shell | Reuse | `StoreModal.tsx` overlay/X/footer. New body `MaintenanceEditor`. |
| **ConfirmDialog** (global loud confirm) | **New** | Replace `window.confirm`. Overlay from StoreModal; red header, warning body, red primary. |
| Duration chips (+2/6/12/24h/Custom) | **New** small | Segmented buttons that set `endTime = now + N h`; "Custom" reveals the datetime-local. |
| Live countdown | **New tiny hook** `useCountdown(endTime, serverNow)` | mono font, `HH:MM:SS`; on 0 → refetch overview. Mirror Android/iOS logic. |
| Time inputs | Reuse | `utcIsoToISTInput` / `istInputToUtcIso` from `configTime.ts`. |
| Toast + undo | Reuse | `toast.*` + `<Toaster/>`; undo = a toast with an action button (extend Toaster to accept an action, or a bespoke undo snackbar). |
| InfoTooltip ("what does precedence mean?") | Reuse | `components/common/InfoTooltip.tsx`. |

Align this inventory with arijit-frontend-arch before extracting the shared `Switch`/`Panel`/`Field` — that
refactor touches `ConfigSettings.tsx`.

## A.6 States (every one specified)

- **Loading**: skeleton, not a spinner. Global card = a grey shimmer block at its real height; store list = 3
  shimmer rows. (Match the calm, alive bar; ConfigSettings currently shows a plain "Loading…" — upgrade to skeleton.)
- **Empty (no stores)**: keep the global card (still usable); store section shows StoresList-style empty
  (`StoreIcon` 48px @ .5 opacity, "No stores yet — add one in Stores"). Never hide the global switch.
- **Error (overview fetch failed)**: full-width inline error card in the store section: "Couldn't load store
  statuses. [ Retry ]" — global card still renders from any cached value; toast on write failures.
- **Off (per row / global)**: grey pill `● Off`, muted; action = "Manage". Restores calm baseline.
- **Live (down now)**: red pill `● LIVE`, `--danger`; countdown "auto-lifts 4:30 PM · ⏱ 2h 14m"; message preview.
- **Scheduled (Phase 2, future start)**: amber pill `● Scheduled`, `#d97706`; "starts 9:00 PM". (Reserved; hidden
  until `startTime` ships.)
- **Down (global) — per store**: row `opacity:.5`, disabled Manage, pill `⛔ Down (global)`, faint "Store setting:
  {Off/Live}" so the preserved per-store value is visible and reassuring.
- **Disabled (write in flight)**: switch + buttons `opacity:.6; cursor:not-allowed`, button label "Saving…"
  (matches ConfigSettings save pattern).
- **Optimistic**: on toggle, badge flips immediately + spinner-dot on the pill; revert + error toast on failure.

## A.7 Store admin (non-super) view — read-only

Store admins **cannot toggle**. On the Config page (or a slim card if they reach `/maintenance`), show a
**read-only status card for their own store only**:
- If their store is Off and global Off: hide entirely (no noise).
- If their store OR global is down: show
  `⚠ Your store is in maintenance until 4:30 PM. Set by head office — customers can't order right now.`
  No switch, no message editor, no other stores, no global control. This is kindness-at-the-edges: the store admin
  will field "app not working" calls and deserves to know it's intentional and when it ends.

## A.8 Interaction, motion, confirmation

- **Feedback ≤100ms**: switch thumb slides 150ms ease (existing); pill colour cross-fades 150ms; row greys 200ms.
- **Turning a store ON (destructive)**: modal danger button `Take {store} down`, `--danger` fill; the modal *is*
  the confirmation (summary line spells out impact + end time). No double dialog.
- **Turning GLOBAL ON (most destructive)**: dedicated **ConfirmDialog** — red header ⚠, body "This takes the entire
  Haper app offline for **all {N} stores** and every customer until {time}. Per-store settings are ignored while
  this is on.", a required checkbox **"I understand this blocks all customers"**, primary red **"Take entire app
  down"**. Checkbox (not type-to-confirm) keeps it fast enough for a real incident while preventing a one-click
  accident. Cancel is the default-focused button.
- **Turning OFF (safe)**: light confirm ("Restore service for {store}?") → toast "Service restored · [Undo]"
  (~6s undo re-applies the prior maintenance).
- **Auto-lift**: countdown reaching 0 refetches; badge Off with a one-shot green "auto-lifted" flash (700ms), no
  modal, no toast spam.
- **Reduced motion**: `prefers-reduced-motion` → cross-fades/slides collapse to instant; countdown still ticks
  (it's information, not decoration).

## A.9 Accessibility

- Contrast: red `--danger #ef4444` on white text ≥4.5:1 for the LIVE pill *text on tinted bg* — use the
  StoresList approach (`--danger` text on `rgba(239,68,68,0.1)` bg) which passes; do **not** put white text on the
  10%-tint. Amber `Scheduled` text `#b45309` on light tint for AA in light theme (`#d97706` on dark is fine).
- Never rely on colour alone: every badge has an **icon + word** (`● LIVE`, `● Off`, `⛔ Down (global)`).
- Switch: keep `role="switch"` + `aria-checked` (existing). Disabled store rows get `aria-disabled` +
  `title="Global maintenance is active"`.
- Focus order in modal: heading → switch → message → duration chips → end time → Cancel → primary. Trap focus;
  Esc = Cancel; return focus to the triggering "Manage" button on close.
- Touch targets ≥44×44 on mobile (the switch is 42×24 visually — expand its hit-area padding to 44px min on the
  card layout).
- Countdown announced politely: wrap in `aria-live="off"` (it changes every second — do **not** spam SR); expose a
  static `aria-label="Auto-lifts at 4:30 PM"` on the cell instead.
- Live region for state changes: toast container `aria-live="polite"`.

## A.10 Design tokens (all existing — no new tokens needed)

Spacing `0.25 / 0.5 / 1 / 1.5rem` (page gap `1.5rem`, panel pad `1.5rem`, cell `1rem 1.5rem`). Radius
`--radius-md 8px` (inputs/pills-not) / `--radius-lg 12px` (panels); pills `9999px`. Type: h1 `1.875rem/700`, panel
title `1.15rem`, body `0.9rem`, hint `0.75rem`, section label `0.7rem/600/uppercase/0.08em`. Colours: accent
`--accent-primary #6366f1`; danger `--danger #ef4444` (LIVE/global); success `--success` (restored flash); amber
`#d97706` (unsaved/scheduled — already used as `unsavedHintStyle`). Countdown = `FontFamily.Monospace` equivalent
(`font-family: ui-monospace, monospace`). Both dark + light inherit automatically via the CSS vars.

---

# SURFACE B — Customer maintenance screen (web + Android + iOS)

Keep it minimal: **reuse the existing global maintenance screen; only the copy + one data field change** for the
store-scoped variant. The precedence merge happens server-side (§1.2), so each client still gates on one boolean
`isMaintenanceModeActive` and renders one screen — it just needs to know *scope* + *store name* to pick copy.

## B.1 Data the screen needs (contract ask)

`GET /user/config` (with the `x-store-id` the clients already send) returns, in the existing `maintenance` object,
two additive fields:
```
maintenance: {
  isActive: true,              // effective (global OR this store), unchanged gate
  message:  "…",               // whichever scope is active supplies it
  endTime:  "2026-07-22T11:00:00.000Z",
  scope:    "store" | "global",   // NEW, nullable → safe for old clients
  storeName:"Chapra Main Bazaar"  // NEW, nullable; present when scope=store
}
```
Old app builds ignore the two new fields and still show the generic screen (backward-compatible; Gson-safe).

## B.2 Content — store-scoped vs global copy

| | GLOBAL | STORE-SCOPED |
|---|---|---|
| Heading | **We'll be back soon!** | **{Store} is briefly down** (e.g. "Chapra Main is briefly down") |
| Sub / message | server `message` (e.g. "We're upgrading Haper.") | server `message` (e.g. "Restocking today — back by evening.") |
| Reassurance line | "The whole app is under quick maintenance." | "Just your store is paused — we'll be back shortly." |
| Countdown | "Estimated time remaining · ⏱ 2h 14m" (existing) | same countdown component, from `endTime` |
| When back | "Back online by 4:30 PM" | "Back online by 4:30 PM" |
| Action | **Retry** (refetch config) + **Contact support** (uses `support.phone`/`email` already in config) | same |
| Illustration | wrench/build glyph (existing) | same glyph — do not invent a new asset; keep tone friendly, not alarming |

Tone: friendly, concrete, one real number. Never "error" language — this is planned, calm, temporary.

## B.3 Per-platform adaptation (reuse first)

- **Android (Material 3)** — `ui/screens/maintenance/MaintenanceScreen.kt`. Reuse as-is; add a `scope`/`storeName`
  to `MaintenanceConfig` (`data/model/AppConfigModels.kt`, nullable) + `AppConfigViewModel`. Swap the hard-coded
  `"We'll be back soon!"` for scope-based heading; add the reassurance line. Countdown logic already correct
  (`LaunchedEffect` on `maintenanceEndTime`). Add a **Retry** `OutlinedButton` (calls `configVM.fetchConfig()`) and
  a **Contact support** text button (Android already has support contact in the VM). Keep `Icons.Default.Build`.
- **iOS (HIG)** — `Views/MaintenanceOverlayView.swift`. Reuse; add `scope`/`storeName` to `AppConfigViewModel`.
  Scope-based `Text` heading; keep `wrench.and.screwdriver.fill`, `.monospaced` countdown. Add a `.bordered`
  **Retry** button (`configVM.fetchConfig()`) + a **Contact support** link. `Color(.systemBackground)` keeps
  dark/light automatic.
- **Web (design system: Tailwind, primary orange `#f97316`)** — **NEW, this is a gap.** `ConfigContext.tsx` must
  read `maintenance` (today it drops it) and expose `isMaintenanceModeActive`; `App.tsx` must gate: if active,
  render a new `components/MaintenanceScreen.tsx` full-screen instead of the app. Match web conventions: centered
  `min-h-screen flex`, `text-primary-500` wrench/`Wrench` (lucide) glyph, `text-2xl font-bold` heading, muted
  message, a `bg-secondary/…` rounded countdown chip mirroring iOS/Android, `bg-primary-500` **Retry** button.
  Reuse `useConfig()` for the support phone/email link. Keep it a single minimal screen — parity with the apps.

## B.4 Customer-side states

- **Active + endTime future**: full screen, live countdown, "Back online by {time}", Retry + Support.
- **Active + no/blank endTime**: hide countdown (as clients already do when `endTime` null/past); show only message
  + Retry + Support. (Backend defaults ON to +6h, so blank is rare but must degrade cleanly.)
- **endTime passes while screen open**: existing behaviour — timer hits 0 → auto `fetchConfig()`; if lifted, screen
  dismisses to the app; if still down (endTime extended), countdown re-arms.
- **Retry tapped, still down**: stay on screen; brief inline "Still under maintenance" toast/snackbar; no error red.
- **Config fetch fails (offline)**: keep last-known screen; Retry shows "Check your connection". Never white-screen.
- **Global + store both down**: global wins (server merge); customer sees the GLOBAL copy. No stacking.

---

## C. Handoff checklist

- **Backend/arijit**: confirm §1 decisions (store `config.maintenance`; `/user/config` store-aware merge with new
  `scope`/`storeName`; `PUT /admin/config/maintenance` per-store; `GET /admin/maintenance/overview`). New fields
  nullable/defaulted (Gson-safe, backward-compatible — grep existing `/user/config` consumers first).
- **tanmoy-web (admin)**: build `/maintenance` page per §A; extract shared `Switch`/`Panel`/`Field`; new
  `MaintenanceBadge`, `ConfirmDialog`, `useCountdown`. Also build the **web customer** `MaintenanceScreen` + gate
  in `App.tsx`/`ConfigContext.tsx` (§B.3) — this is a genuine gap today.
- **siddhart-android / setu-ios**: copy + `scope`/`storeName` + Retry/Support additions to the existing
  maintenance screen only (§B.3). No structural change.
- **Test docs**: add/update a `haper-misc/test-maintenance.md` walkthrough (global on/off, per-store on/off,
  precedence greys the list, auto-lift, store-admin read-only, customer store-vs-global copy) in the same PR.
