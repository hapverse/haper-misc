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
