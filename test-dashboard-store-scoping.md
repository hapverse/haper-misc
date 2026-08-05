# Test: Dashboard "Store performance cockpit" — metrics must be store-scoped

**Area:** Admin panel → **Dashboard** (the "Store performance cockpit" / Live control tower),
`damin.haper.in`. Backend: `packages/shared/repositories/order.repository.js`.
**Who:** super-admin (can switch the active store) + store-admins.

## The bug (what went wrong)

On the cockpit, switching the **active store** (top-left store picker) updated **Revenue** and
**On-time Delivery** correctly, but the **Orders** tile showed the **same number for every store**.

**Real example seen:** Haper Mart (Yesterday) → Revenue ₹5,506, Orders **30**, On-time 93.55%.
Switch to Bhagwan Bazar (Yesterday) → Revenue **₹0**, Orders **still 30**, On-time **0%**. A store
with ₹0 revenue and 0% delivery can't have 30 real orders — the Orders count was **global**, not
per-store.

**Root cause:** in `getRevenueMetrics`, the order-count `countDocuments()` queries had **no
`storeId` filter**, while the revenue `$facet` pipes used `matchSuccess` (which *is* store-scoped).
So revenue was per-store but order counts were counted across ALL stores. Also fixed: the
`getAdvancedMetrics` repeat-customers `$lookup` wasn't store-scoped (over-counted repeats).

**Deploy:** backend only (`dapi.haper.in`). No client/admin-FE change needed.

## The walkthrough

Pick **two stores with clearly different order volumes** (e.g. an active store and a quiet/new one).

1. ✅ On the cockpit, select **Store A** → note **Revenue, Orders, On-time Delivery** for a period
   (e.g. Yesterday).
2. ✅ Switch the store picker to **Store B** (same period) → **all three tiles change**, and the
   **Orders count now reflects Store B only** (not the same number as Store A).
3. ✅ A store with **₹0 revenue / 0% on-time** for the period shows **0 (or its true low count)**
   orders — never a carried-over number from another store.
4. ✅ The Orders count is internally consistent: a store with real revenue has a matching non-zero
   order count; a store with ₹0 revenue does not report dozens of orders.
5. ✅ **Repeat customers** (advanced metrics) counts only customers who ordered **>1 time at the
   selected store** — not customers who ordered once here but more elsewhere.
6. ❌ Regression: the **super-admin all-stores view** (no store selected) still shows global totals;
   per-store selection must never leak another store's counts.

## Every period
Repeat step 2 for **Today / Yesterday / This Week / This Month** — the Orders count must track the
selected store in every period (the fix scopes all 18 count queries: completed/open/ongoing × the 5
periods + lifetime).

## Source (for reference)
- `haper-backend/packages/shared/repositories/order.repository.js` — `getRevenueMetrics`
  (`storeMatch` added to every order-count query) + `getAdvancedMetrics` repeat-customer `$lookup`.
- Regression test: `haper-backend/packages/admin/__tests__/analytics.test.js`
  ("order counts are store-scoped" — two stores report their own counts, never combined).
