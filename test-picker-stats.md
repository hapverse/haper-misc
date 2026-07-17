# Test: per-picker performance metrics — admin Pickers page

A single walkthrough for the tester on the **admin panel** (`damin.haper.in` on dev),
route **`/pickers`**. You open the Pickers page, exercise the new **performance** section
(date filter + summary cards + leaderboard), then open a picker's **drawer** and scroll it.
Each step says **what to do** and **what to expect** (✅ good / ❌ should be blocked).

> Companion to `test-picking.md` (the Android **picker app** — how a pick actually happens).
> That guide covers making the picks; **this** guide covers the admin-side numbers those
> picks roll up into. Every metric here is computed from **completed** pick tasks — so run a
> few pickings from `test-picking.md` first if the store has none.

**What this is (real example):** the Pickers page used to show only the roster (who exists)
plus status counts (Available / Busy / Offline). It now also shows **how well each picker
works**. Example: you can see that **Ramesh picked 12 orders this week, averaging 5m 0s per
order, with 92% scan accuracy** — then click his row and a right-side drawer lists **every
one of those 12 orders** (id, when, how long, units, out-of-stock lines) newest-first.

---

## What deploy this needs

- **Backend** (the two performance endpoints) → deploys to **`dapi.haper.in`** (dev API).
- **Admin FE** (the performance section + drawer) → deploys to **`damin.haper.in`** (dev admin).
- This session **did not deploy** — deploy is user-driven. If the performance section is
  missing or the leaderboard errors, the box is a build behind (see Troubleshooting).

Source (for reference):
- Backend: `packages/admin/src/routes/picker/{router,controller,validator}.js`,
  `packages/shared/repositories/pick-task.repository.js`
  (`getPerformanceByStore`, `getCompletedTasksByPicker`).
- Admin FE: `haper-admin/src/pages/Pickers/PickersList.tsx` + `PickerStatsDrawer.tsx`.
- Tests: `packages/admin/__tests__/picker-performance.test.js`.

---

## 0. Prerequisites (read once)

1. **Log in to `damin.haper.in`** as an admin or super-admin who has the **Pickers view**
   permission (`pickers.view`). Without it the whole performance section is **hidden** — you
   still see the roster, but no cards/leaderboard.
2. **A store that has some completed pick tasks.** The numbers come only from tasks a picker
   **finished** (tapped Complete). A store where nobody has completed a picking will show
   empty states — that's correct, but you can't test the happy path there. Use `test-picking.md`
   to complete a few orders first (on dev, **Haper Mart** already has picking on).
3. **Store context.** A **store admin** sees only their store's numbers. A **super-admin**
   with **no store selected** sees **all stores** combined; switch into one store to scope
   the numbers to it.

> Quick backend check (optional): as a logged-in admin, hit
> `GET /admin/picker/performance?startDate=2026-07-10T00:00:00.000Z&endDate=2026-07-17T23:59:59.999Z`
> → `200` with `{ data: { stats: [...], summary: {...} } }`. A `403` means your account
> lacks `pickers.view`; a `400 "Date range cannot be more than 31 days"` means the window
> was too wide.

---

## The metrics (what each number means)

All six are shown two ways: as an **overall summary** (across every picker) and **per picker**
(each leaderboard row + the drawer). Everything is for the **selected window**, based on when
each pick was **completed**, in **India time (Asia/Kolkata)**.

| Metric | Meaning |
|---|---|
| **Orders picked** | How many pick tasks the picker **completed** in the window. |
| **Avg pick time** | Average of (finish − start) per completed pick, shown as **"Xm Ys"** (e.g. `5m 0s`). Shows **"—"** when there's nothing to measure. |
| **Items picked** | Total **units** actually picked off shelves (sum of picked quantity across picked lines). |
| **Partial picks** | Count of completed orders where **some** items were picked **but** at least one line went **out of stock**. |
| **Out-of-stock lines** | How many order lines were marked out of stock. |
| **Scan accuracy** | Of the lines the picker picked, the **%** confirmed by scanning the barcode (vs a manual override). Shows **"—"** when there were no picked lines. |

Two rules worth remembering (they drive the edge cases below):
- **Partial** needs BOTH: at least one picked line AND at least one OOS line. An order where
  **everything** went OOS is **not** partial (nothing was picked). A **fully-picked** order is
  **not** partial (nothing went OOS).
- **Avg pick time** only averages tasks that have **both** a start (`claimedAt`) and a finish
  (`completedAt`). A task missing either is skipped (never counted as 0), so it can't drag the
  average down.

---

## The walkthrough

### A. Open the page + find the performance section
1. Go to **Pickers** in the sidebar (or `damin.haper.in/pickers`).
2. ✅ Under the page title you still see the roster status cards (**Total pickers / Available /
   Busy / Offline / Left**) — unchanged.
3. ✅ **Below those**, a new **"Picking performance"** panel appears: a dark hero strip titled
   **"How your pickers are performing"**, then a row of **six summary cards**, then a
   **"Picker leaderboard"** table.
4. ❌ If your account lacks `pickers.view`, the whole performance panel is **absent** (roster
   still shows). This is expected — it's permission-gated.

### B. Default window = 7 days
1. On load, ✅ the **"7 days"** chip is highlighted (the default). Chips read **Today · 7 days ·
   30 days · Custom**.
2. ✅ The six summary cards populate for the last 7 days: **Orders picked, Avg pick time, Items
   picked, Partial picks, Out-of-stock lines, Scan accuracy**.
3. ✅ Avg pick time reads like **"5m 0s"** (or **"—"** if no timed picks); Scan accuracy reads
   like **"92%"** (or **"—"** if no lines were picked).

### C. The leaderboard
1. Below the cards, ✅ the **"Picker leaderboard"** lists **every picker** with numbers side by
   side: **Name (+ phone), Orders picked, Avg pick time, Items picked, Partial, OOS lines,
   Scan accuracy**, and a **›** chevron on the right.
2. ✅ Rows are **ranked best-first** — most **orders picked** at the top (ties broken by most
   **items picked**). The subtitle reads *"Ranked best-first. Click a picker to see their
   recent picks."*
3. ✅ A row's **OOS lines** value turns **red** when it's above 0.
4. ✅ A picker with **zero** completed picks in the window is **not** in the leaderboard (only
   pickers who actually completed something appear here) — see §H for their zeroed drawer.

### D. Switch the window and watch the numbers move
1. Click **Today** → ✅ cards + leaderboard **reload** for just today; numbers shrink (or the
   list empties if nobody picked today).
2. Click **30 days** → ✅ numbers **grow** (a wider window catches more completed picks).
3. Click **Custom** → ✅ two date inputs appear (**From** / **To**) with a hint
   **"Range can be at most 31 days."**
4. Pick a valid From/To → ✅ the cards + leaderboard reload for exactly that window.
5. ✅ Flip between chips quickly (Today → 30 days → 7 days). The **final** window's numbers win
   — a slow earlier response never overwrites the newer selection (no flicker of stale data).

### E. Open a picker's drawer
1. Click any leaderboard **row** (or focus it and press **Enter** / **Space**).
2. ✅ A **right-side drawer** slides in. Header = the **picker's name** + **"Picker
   performance • <status>"** (e.g. *Available*).
3. ✅ The drawer shows the **same six metric cards** — but for **that one picker** over the
   **same window** the leaderboard is using.
4. ✅ Below the cards, a **"Recent picked orders"** list, **newest-first**. Each row shows:
   - the **order id** (e.g. `HP50999049`),
   - **when** it was completed,
   - **Duration** (Xm Ys),
   - **Units** (units picked),
   - **Picked** as `picked/total` line counts (e.g. `4/5`),
   - **OOS** count (red when > 0),
   - **Scan-verified** line count,
   - an amber **"⚠ Partial"** badge when that order was a partial pick.

### F. Scroll the drawer (infinite scroll)
1. Scroll the drawer's order list down.
2. ✅ More orders **load automatically** as you near the bottom (a "Loading..." line flashes;
   pages of 20).
3. ✅ At the very end, a footer reads **"End of list • N orders"** (N = the picker's total
   completed picks in the window).
4. Close the drawer (the **✕**, or click the dimmed backdrop) → ✅ it dismisses; the leaderboard
   is unchanged behind it.

---

## Edge cases to verify

- **Picker with zero completed picks in the window.**
  - ✅ They're **absent** from the leaderboard (only pickers with completed picks show there).
  - ✅ (If you reach their drawer another way / they had picks then you narrow the window) the
    drawer shows **all metrics zeroed** (Avg pick time & Scan accuracy = **"—"**) and the list
    reads **"No completed picks in this period"**.

- **All-out-of-stock order is NOT a partial pick.** Complete an order where **every** line was
  marked OOS (nothing picked). ✅ It does **not** add to **Partial picks** (needs at least one
  picked line). It **does** add to **Out-of-stock lines**. (Note: an order that loses its *last*
  item auto-cancels per `test-picking.md` §Q — so to test this cleanly, complete a multi-line
  order where all lines went OOS but the order still reached Complete.)

- **Some-in / some-out order IS a partial pick.** Complete an order where you picked one line
  and marked another OOS. ✅ **Partial picks** goes up by 1, and the drawer row shows the amber
  **"Partial"** badge.

- **A fully-picked order is NOT partial.** Pick every line, none OOS. ✅ **Partial picks** does
  **not** move (no badge on that row).

- **Manual override lowers scan accuracy.** Pick a line via **"Confirm without scan
  (override)"** (no barcode scan). ✅ That line counts toward the denominator but **not** the
  numerator, so the picker's **Scan accuracy** drops below 100%. A picker who scanned every
  line reads **100%**; a picker who picked nothing reads **"—"**.

- **Custom range > 31 days is blocked (no error loop).** In **Custom**, try to set From/To more
  than 31 days apart, or **To before From**. ✅ The date inputs **won't let you** pick an
  out-of-range or inverted range (min/max are clamped to a 31-day window ending today). Even if
  a value is typed straight into the field, the request is clamped before it's sent — so you
  **never** hit a `400 → Retry → same 400` loop. (Backend backstop: a >31-day request returns
  **HTTP 400 "Date range cannot be more than 31 days"**.)

- **Switching pickers/windows mid-scroll doesn't mix rows.** Open picker A's drawer, start
  scrolling (loading page 2+), then quickly switch to picker B (or change the window). ✅ B's
  drawer shows **only B's** orders — A's late-arriving page never appends onto B's list.

- **Empty window.** Select a window (e.g. **Today**) with no completed picks. ✅ The leaderboard
  area shows **"No picking activity in this period"** (and the summary cards read 0 / "—").

- **Super-admin store scope.** As super-admin with **no store selected**, ✅ the numbers combine
  **all stores**. Switch into one store → ✅ the numbers **drop** to just that store's picks.
  A **store admin** only ever sees their own store.

- **Only COMPLETED picks count.** In-progress, pending, and cancelled pick tasks are **ignored**
  — an order a picker has claimed but not finished does **not** appear in any number until it's
  completed.

---

## Backend verification (endpoints / DB) — spot checks

| After… | Check |
|---|---|
| **Leaderboard load** | `GET /admin/picker/performance?startDate=<ISO>&endDate=<ISO>` → `{ data: { stats: [per-picker rows], summary: {…} } }`. Admin-only, needs `pickers.view`, scoped to the admin's active store (super-admin, no store ⇒ all stores). Read-only. |
| **Drawer load** | `GET /admin/picker/:pickerId/performance?startDate=<ISO>&endDate=<ISO>&page=<n>&limit=<n>` → `{ data: { picker, metrics, tasks: { rows, total, page, limit, hasMore } } }`. Same auth/permission/scope; paginates the completed-task list (`limit` default 20, max 100). |
| **Range too wide** | Either endpoint with `endDate − startDate > 31 days` → **HTTP 400** `"Date range cannot be more than 31 days"`. |
| **Window / timezone** | Numbers are windowed on each task's **`completedAt`**, snapped to **IST** day boundaries. Only tasks with `status = COMPLETED` count; other stores' tasks are excluded (when scoped). |
| **Partial rule** | A task counts as partial only when it has **both** a picked line **and** an OOS line (`oosLines > 0 && pickedLines > 0`). All-OOS and fully-picked tasks are **not** partial. |
| **Avg pick time** | Averages only tasks that have **both** `claimedAt` and `completedAt`; a task missing either is skipped (not counted as 0). `null` ⇒ shown as **"—"**. |
| **Scan accuracy** | `round(scan-verified picked lines ÷ picked lines × 100)`; **null** (⇒ "—") when the picker picked **no** lines. |
| **Summary is exact** | The overall **Avg pick time** and **Scan accuracy** are true totals across all tasks — **not** an average of the per-picker averages. |
| **Data source** | Everything is derived from the **`pick-tasks`** collection. Raw line data never leaves the server — only the derived per-task counts reach the drawer. |

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No **Picking performance** panel at all | Your admin account lacks the **`pickers.view`** permission (the whole section is permission-gated), **or** the admin FE build on `damin.haper.in` is behind (component not deployed). |
| Leaderboard shows **"Loading performance..."** then an error + **Retry** | The backend performance endpoint isn't reachable/deployed on `dapi.haper.in`, or the request 400'd. Click **Retry**; if it persists, the API box is a build behind. |
| Leaderboard says **"No picking activity in this period"** | No pick tasks were **completed** in the selected window for this store. Widen the window (30 days) or complete a picking (`test-picking.md`). |
| A known picker is **missing** from the leaderboard | They completed **zero** picks in the window (only pickers with completed picks appear). Widen the window or check they finished a picking. |
| **Avg pick time** or **Scan accuracy** shows **"—"** | Nothing to measure — no timed picks (missing start/finish) for that picker, or no lines were picked. Expected, not a bug. |
| Numbers look **too big** for one store | You're a **super-admin with no store selected** (all stores are combined). Switch into a store to scope them. |
| **Custom** range won't extend past ~a month | Correct — the window is capped at **31 days**; the inputs clamp From/To to a 31-day span ending today. |
| Drawer list shows another picker's orders after switching fast | Should **not** happen — responses are matched to the current picker/window and stale ones are dropped. If you see mixed rows, the admin FE build is behind. |
