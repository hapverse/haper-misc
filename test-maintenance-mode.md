# Test — Global maintenance mode auto-lift (`endTime`)

**Area:** `configs` doc (`name: "APP_CONFIG"`), sub-doc `maintenance: { isActive, message, endTime }`
**Backend files:**
- `packages/user/src/routes/config/controller.js` — `getAppConfig` (what the apps read; Redis-cached)
- `packages/admin/src/routes/config/controller.js` — `updateMaintenance` (super-admin writer)
- `packages/shared/repositories/config.repository.js` — `getAppConfig` / `getAppConfigUnleaned`

**Deploy needed:** backend redeploy (dev → `dapi.haper.in`). No DB migration required for the fix itself.
**Follow-up (manual, prod, user-driven):** add a unique **partial** index on `configs.name` for `name: "APP_CONFIG"` so a duplicate `APP_CONFIG` doc can never be created. Prod currently has two `configs` docs (one legacy default read by `_id`, one real `APP_CONFIG`).

---

## Why this exists (the bug)

Maintenance mode never turned off at its scheduled time. `endTime` was stored but **nothing read it** — the app endpoint returned `isActive` verbatim and no cron flipped it, so maintenance stayed on until a super-admin manually toggled it off. Confirmed on prod: a config updated the same morning still carried an **11-day-stale** `endTime`.

## The fix (two sides)

- **Read side (`getAppConfig`):** returns an *effective* `isActive` = `storedIsActive && (endTime == null || endTime > now)`. Maintenance auto-lifts exactly at `endTime`, no cron. Response shape is unchanged — only the `isActive` value is corrected. Cache TTL is capped to `endTime` (so a cached "on" can't outlive the deadline by up to 12h). A best-effort lazy write-back flips the stored flag off once `endTime` passes so the admin panel reflects reality.
- **Write side (`updateMaintenance`):** ON + future `endTime` → honoured as-is; ON + missing/null/**stale** `endTime` → defaults to **now + 6h**; OFF → `endTime` cleared to `null`. Guarantees maintenance can never get stuck on indefinitely.

---

## Test steps

Super-admin token required for the admin PUT. `GET /config` (user app config) needs **no** `x-store-id` for global config. Admin maintenance PUT **403s** if `x-store-id` is sent (global-only).

### Write-side (`PUT /admin/config/maintenance`)
| # | Body | Expected stored `endTime` | Result |
|---|------|---------------------------|--------|
| 1 | `{ isActive: true }` (no endTime) | ~ now + 6h | ✅ / ❌ |
| 2 | `{ isActive: true, endTime: <past> }` | overwritten to ~ now + 6h | ✅ / ❌ |
| 3 | `{ isActive: true, endTime: <future> }` | equals the provided value | ✅ / ❌ |
| 4 | `{ isActive: false }` | `null` | ✅ / ❌ |

### Read-side (`GET /config` app config → `data.maintenance.isActive`)
| # | Stored state | Expected `isActive` in response | Result |
|---|--------------|--------------------------------|--------|
| 5 | isActive:true, endTime in **future** | `true` | ✅ / ❌ |
| 6 | isActive:true, endTime in **past** | `false` (auto-lifted) | ✅ / ❌ |
| 7 | isActive:true, endTime **null** | `true` (indefinite) | ✅ / ❌ |
| 8 | isActive:false | `false` | ✅ / ❌ |

### End-to-end (the real incident)
9. Super-admin turns maintenance ON with no endTime → app shows maintenance. ✅/❌
10. Wait past the 6h window (or set a near endTime) → app **auto-lifts** without anyone touching it. ✅/❌
11. Re-`GET /config` after lift → stored `maintenance.isActive` is now `false` (lazy write-back). ✅/❌

---

## Edge cases to watch

- **Cache lag:** the app config is Redis-cached (12h default, capped to `endTime` when active). Admin writes clear the cache immediately (`distributedCacheUtils.del`). A manual toggle is instant; an auto-lift at `endTime` is bounded by the capped TTL.
- **Timezone:** `endTime` is a UTC `Date`. The admin UI must send it in ISO/UTC. `06:00 IST` must be stored as `00:30 UTC` — verify the FE picker's timezone handling.
- **Two config docs:** reads use `.sort({ updatedAt: -1 })`, so user-read and admin-write always resolve to the same newest `APP_CONFIG`. Until the unique index lands, do not hand-create a second `APP_CONFIG` doc.
- **Legacy admin tests** send `{ enabled: ... }` (wrong key — real schema is `isActive`); they never exercised a real save. Test cases 1–8 above are the first to assert persisted/returned values.

## Clients
No client change required — response shape is identical, apps already gate their maintenance screen on `data.maintenance.isActive`. The fix is purely that this value is now correct.

## Automated coverage
- `packages/user/__tests__/config.test.js` — cases 5–8 (in-memory Mongo).
- `packages/admin/__tests__/config.test.js` — cases 1–4 (in-memory Mongo).

---

# Surface — Admin per-store maintenance page (`/maintenance`)

**Area:** haper-admin dedicated route `/maintenance` (super-admin only). Promotes maintenance out of the
`/config` page (Config now shows a "Maintenance Mode →" link card instead of the inline panel).

**Admin files (haper-admin):**
- `src/pages/Maintenance/MaintenancePage.tsx` — global master card + per-store list + precedence + states.
- `src/pages/Maintenance/MaintenanceStoreModal.tsx` — per-store editor (Switch + message + duration + end time).
- `src/pages/Maintenance/MaintenanceFields.tsx` — shared message + duration-chips + IST end-time editor.
- `src/pages/Maintenance/maintenanceHelpers.ts` — client `resolveEffective`, countdown + auto-lift formatters.
- `src/components/common/{Switch,MaintenanceBadge,ConfirmDialog}.tsx`, `src/hooks/useNow.ts` — reusable pieces.
- Router: `src/App.tsx` (`/maintenance`, super-admin group). Nav: `src/hooks/useMenu.ts` (Settings → Maintenance).

**API bound (backend already built):**
- `GET /admin/config` (no store header) → global stored `maintenance` for the master card.
- `GET /admin/config/maintenance/stores` (super-admin) → `[{ storeId, name, status, maintenance:{ isActive(effective), storedIsActive, message, endTime } }]`.
- `PUT /admin/config/maintenance` — GLOBAL (no store header) or PER-STORE (`x-store-id: <storeId>`). `endTime`: ON+future kept, ON+missing/past → now+6h, OFF → null.

**Deploy needed:** admin FE redeploy (dev → `damin.haper.in`). No backend/DB change (endpoints already live).

## Admin UI test steps (super-admin)
| # | Step | Expected | Result |
|---|------|----------|--------|
| A1 | Open sidebar → Settings → **Maintenance** | Dedicated page: global master card + store list, live countdowns tick | ✅ / ❌ |
| A2 | Config page (`/config`) | Old inline maintenance panel gone; a **Maintenance Mode →** link card is shown instead | ✅ / ❌ |
| A3 | Toggle **global** switch ON | ConfirmDialog "Take the ENTIRE app down?" with required **acknowledgement checkbox** (confirm disabled until ticked) | ✅ / ❌ |
| A4 | Confirm global ON | Master card turns red **LIVE**, mono countdown "auto-lifts H:MM · HH:MM:SS"; store list greys (opacity .5) + amber banner; Manage disabled | ✅ / ❌ |
| A5 | Global ON, leave `endTime` blank | Stored `endTime` ≈ now + 6h (backend default); hint "Blank = defaults to 6 hours" shown | ✅ / ❌ |
| A6 | Global card **Restore service** → confirm | Global off; toast + **Undo** snackbar (~6s) that re-applies the prior maintenance | ✅ / ❌ |
| A7 | Global OFF, a store's **Manage** → toggle on + message + `+6h` chip → **Take store down** | Only that store's row → red **LIVE** with countdown; other stores stay Off | ✅ / ❌ |
| A8 | Per-store PUT sends `x-store-id` of the edited store (not the top-bar store) | Correct store updated (verify in DB `stores.config.maintenance`) | ✅ / ❌ |
| A9 | Live store row **Restore** → confirm | Row → Off; toast + **Undo** snackbar | ✅ / ❌ |
| A10 | Let a live store's countdown reach 0 (short end time) | Badge auto-flips to **Off** live (client re-derives effective); no refresh needed | ✅ / ❌ |
| A11 | Global ON while a store is also down | Store row shows `⛔ Down (global)` + faint "Store setting: On" (per-store value preserved) | ✅ / ❌ |
| A12 | Keyboard: open a dialog → Tab cycles inside, Esc cancels, focus returns to trigger; Cancel is default-focused | ✅ / ❌ |
| A13 | States: slow network (loading skeleton rows), no stores (empty), store-list fetch fails (inline **Retry**) | Each renders correctly | ✅ / ❌ |

## Edge cases (admin page)
- **Precedence is visual only:** while global is ON the store PUTs still work server-side, but the page pauses/greys them and hides Restore — lifting global immediately restores each store's own stored setting.
- **Countdowns are derived in render** from one shared `useNow()` clock; end time is IST via `configTime` (same UTC↔IST rule as the old picker — verify `4:30 PM IST` round-trips).
- **Optimistic OFF:** the badge flips before the API returns; on failure it reverts + shows an error toast (input preserved on the store modal).
- **Non-super-admin** hitting `/maintenance` (route is super-gated, but defensive): read-only notice, no toggles.

## Ambiguities resolved (flag for reviewer)
- Store editor **toggle seeds from the EFFECTIVE state** (what the row badge shows), while message/end-time seed from the stored values — so the admin edits exactly what they see. (Spec left stored-vs-effective open.)
- **Scheduled** badge (future start) is coded but unused — reserved for a Phase-2 `startTime`; today ON is immediate (matches backend).
- Shared `Switch`/`Panel`/`Field` extraction was **not** applied to `ConfigSettings.tsx` (spec said align with arijit-frontend-arch first). New `Switch` is additive; ConfigSettings keeps its local one to avoid an unreviewed refactor.
- Auto-lift "green flash" (A.8) omitted — the badge simply flips to Off; no functional gap.

---

# Surface — Backend store-wise resolution + clients

**Area:** `stores.config.maintenance` (new, defaulted, no migration) + shared `maintenance.utils` (resolveEffective / resolveEndTimeForWrite / precedence). Global stays the master kill-switch.

**Backend files:** `packages/shared/utils/maintenance.utils.js` (new), `packages/shared/models/stores.schema.js`, `packages/shared/repositories/stores.repository.js` (`getMaintenance`), `packages/user/src/routes/config/controller.js` (store-aware read), `packages/user/src/routes/order/controller.js` (409 guard), `packages/admin/src/routes/config/controller.js` + `router.js` (per-store PUT + `GET /config/maintenance/stores`).

**Deploy needed:** backend redeploy (dev → `dapi.haper.in`) + client releases (Android/iOS store update; web deploy). Already-shipped Android honors store maintenance the moment the backend deploys (it already sends `x-store-id`) — safe (default OFF).

## API resolution — `GET /user/config` (send `x-store-id`)
Server resolves precedence and returns `data.maintenance { isActive, message, endTime, scope }` (the boolean clients gate on) + additive nullable `data.storeMaintenance`.

| # | Global | Store | `x-store-id` | Expected `data.maintenance` | Result |
|---|--------|-------|-------------|-----------------------------|--------|
| B1 | ON | OFF | store | `isActive:true, scope:"global"` (global message) | ✅ / ❌ |
| B2 | ON | ON | store | `isActive:true, scope:"global"` (global wins) | ✅ / ❌ |
| B3 | OFF | ON | store | `isActive:true, scope:"store"` (store message + endTime) | ✅ / ❌ |
| B4 | OFF | OFF | store | `isActive:false, scope:"none"` | ✅ / ❌ |
| B5 | OFF | ON (endTime past) | store | `isActive:false` (store auto-lifted) + lazy write-back flips stored store flag | ✅ / ❌ |
| B6 | OFF | ON | *(none)* | `isActive:false`, `storeMaintenance:null` (identical to pre-store behavior) | ✅ / ❌ |
| B7 | OFF | ON | *invalid id* | treated as no store → global-only | ✅ / ❌ |

## Order guard — `POST /user/order/place`
| # | Step | Expected | Result |
|---|------|----------|--------|
| B8 | Place order into a store that is effective-ON (or global ON) | Rejected **409** with the maintenance message; no inventory decrement (txn aborts) | ✅ / ❌ |
| B9 | Config/maintenance read throws a DB error during checkout | Order **proceeds** (fail-open — guard gates re-throw on `statusCode===409` only) | ✅ / ❌ |

## Clients (store-scoped)
| # | Platform | Step | Expected | Result |
|---|----------|------|----------|--------|
| B10 | Android | Enter a down store → switch to a healthy store | Maintenance screen ("This store is briefly down") shows, then clears on switch (re-fetch on store change) | ✅ / ❌ |
| B11 | iOS | Resolve a down store | Overlay appears — confirm `x-store-id` is actually sent on `/user/config` (was headerless before) | ✅ / ❌ |
| B12 | Web | Resolve a down store | Full-screen overlay with scope copy + countdown; checkout 409 → message + overlay | ✅ / ❌ |
| B13 | All | Global ON | Every customer sees the global message regardless of store | ✅ / ❌ |

## Edge cases (backend)
- **Cache keys:** global `CACHE_APP_CONFIG` vs per-store `CACHE_STORE_MAINTENANCE_<id>` are busted independently; a store response always recombines the current global master. Store key normalized to canonical lowercase ObjectId hex so an upper-case `x-store-id` can't strand a stale entry.
- **Guarded lazy write-back:** flips the stored flag off only if the observed `endTime` still matches, so a concurrent admin re-enable isn't clobbered (global + store).
- **`.lean()` reads** don't apply schema defaults → resolver treats an undefined `config.maintenance` as OFF (old stores unaffected).
- **Super-admin only:** `config.maintenance` can only be written via the super-admin `PUT /config/maintenance`; `updateStoreConfig` (store-admin reachable) whitelists fields and has no `maintenance` key.

## Automated coverage (store-wise)
- `packages/user/__tests__/config.test.js` — B1–B7 (in-memory).
- `packages/user/__tests__/order-serviceability.test.js` — B8–B9 incl. the fail-open DB-error test.
- `packages/admin/__tests__/config.test.js` — per-store PUT + `GET /config/maintenance/stores`.
- Design spec: `design-store-maintenance.md`.
