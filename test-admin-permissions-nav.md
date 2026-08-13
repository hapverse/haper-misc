# Test: Admin panel — refresh, permissions, dashboard honesty & warehouse-access fixes (2026-08-08 batch)

**Area:** Admin panel (`damin.haper.in`, dev). Sidebar navigation, Team screen (permissions),
Dashboard, Warehouse pages, login/logout.
**Repo:** `haper-admin` only — no backend change, no database change, no migration.
**Roles involved:** `super_admin`, `store_admin`, `manager` and `support` (created from Team),
`warehouse_manager`, `warehouse_staff`.
**Status:** All of this is **uncommitted on `dev`** right now (18 modified files + 7 new test
files). Nothing is deployed. It needs your explicit go-ahead before it's committed; deploying to
`damin.haper.in` after that is manual, as always.
**Plan doc:** [`admin-nav-fix-plan.md`](./admin-nav-fix-plan.md) — this batch is "Pass 1: Bugs".

---

## What changed and why it matters

This is a bug-fix pass on the admin sidebar and permissions, found during a navigation review.
Five separate bugs, all in the frontend only:

1. Refreshing the page (or opening a bookmark, or a link in a new tab) used to throw
   managers/support/warehouse staff back to the Dashboard. Now it doesn't.
2. New managers were missing 5 features with no way to grant them by hand. Now the preset is
   complete and every permission is toggleable.
3. The Dashboard used to show made-up numbers when real data failed to load — including fake
   revenue to a `support` account that isn't allowed to see revenue at all. Now it never invents
   a number; it says so instead.
4. Store owners saw 3 warehouse buttons that always failed. Now they don't see them.
5. On a shared shop-floor computer, signing out used to leave the previous person's recent pages
   and an unfinished warehouse form behind for the next person. Now it doesn't.

None of this needs a backend deploy or a database change. Everything below can be tested entirely
on `damin.haper.in` (dev) once this branch is running.

---

## Quick reference — sidebar item counts after all fixes

This is the number of items each role sees in the left sidebar, pinned by an automated test
(`src/hooks/useMenu.test.ts`, "keeps the audited counts").

| Role | Sidebar items | Changed in this batch? |
|---|---|---|
| `super_admin` | **39** | No — always saw everything |
| `store_admin` | **25** | Yes — was 28, lost Receive Goods / Verify Bill / Batch Recall (Fix 4) |
| `warehouse_manager` | **14** | No — always had these |
| `warehouse_staff` | **11** | No — always had these |

`manager` and `support` are permission-driven, not role-driven, so their sidebar depends on what
they were granted — see Fix 2 for what a *newly created* one now sees (20 and 15 items).

---

## Getting test accounts

- **`manager` / `support`**: log in as a `store_admin` (or `super_admin`), open **Team**, click
  **+ Add Team Member**. This is also exactly what Fix 2 below walks through creating.
- **`warehouse_manager` / `warehouse_staff`**: log in as `super_admin`, open **Warehouse Staff**.
- Don't write real passwords into this file or into chat — set them when you create the account
  and keep them to yourself.

---

## Fix 1 — Refreshing the page no longer kicks you out

**What was broken:** a `manager`, `support`, `warehouse_manager` or `warehouse_staff` user who
pressed F5, opened a bookmark, or right-click-opened a link in a new tab was silently sent back to
the Dashboard, and the sidebar flashed with only "Dashboard" before the rest of the items filled
in. `super_admin` and `store_admin` were never affected — that's why nobody noticed for a while.
Separately, if your session expired while you were on some page, logging back in always dropped
you on the Dashboard instead of back where you were.

### ✅ Steps — hard refresh stays on the page
1. Log in as a **manager** (or support / warehouse_manager / warehouse_staff) test account.
2. Open any page that account can see — e.g. **Orders**.
3. Press **F5** (or Cmd+R).
4. **Expect:** a brief grey skeleton (loading placeholder bars in the shape of the real page) for
   under a second, then you land back on **Orders** — the same page, fully loaded. The sidebar
   paints once, complete — never a half-empty list that fills in afterward.
   ❌ Old behavior: bounced to the Dashboard; sidebar flashed with only "Dashboard" visible.
5. Right-click a sidebar link (e.g. **Items**) → **Open link in new tab**.
   **Expect:** the new tab opens directly on Items — no bounce to Dashboard.
6. Copy the current page's full URL, paste it into a new tab (simulating a bookmark).
   **Expect:** lands on that exact page.
7. **Regression check:** repeat steps 1–4 logged in as `store_admin`. **Expect:** no visible
   change at all — they were never affected, and still aren't.

### ✅ Steps — expired session returns you to where you were
1. Log in as a manager. Open a page other than the Dashboard, e.g. **Replenishment**.
2. Ask a developer to expire/revoke your token server-side (or wait for it to expire naturally),
   then do anything that calls the API — e.g. refresh a list on the page.
3. **Expect:** you're bounced to the **Login** screen. Log back in.
4. **Expect:** you land back on **Replenishment** — not the Dashboard.
   ❌ Old behavior: always landed on the Dashboard after logging back in.
5. **Edge case — stale destination:** if more than **5 minutes** pass between being bounced to
   Login and actually logging back in, you land on the **Dashboard** instead. This is deliberate:
   the remembered page is time-boxed so a stale URL (which could contain something private, like
   a customer's phone number in a search box) can't be handed to whoever logs in next on a shared
   terminal.

---

## Fix 2 — Managers and Support now get the right permissions

**What was broken:** a `manager` created from the Team screen never got **New Sale (POS)**,
**Pickers**, **Replenishment**, **Transfers** or **Transfer Discrepancies** — and there was no way
to grant them by hand, because the permission screen had no rows for them at all. A `support`
account was missing **Pickers** the same way.

**What changed:** the Manager preset grew from 30 to **35** permissions, the Support preset from
14 to **15**. The permission grid now shows **13 resource groups / 49 toggles** (was 10 / 38), so
every permission can be granted or revoked by hand. Also: switching the **Role** dropdown while
*creating* a new member now applies the matching preset (it used to always apply the bigger
Manager preset, so a support hire could silently end up able to ring up cash sales).

### ✅ Steps — a new manager gets everything the preset intends
1. Log in as `store_admin` (or `super_admin`) → open **Team** → **+ Add Team Member**.
2. Leave Role = **Manager**.
3. **Expect:** the Permissions panel reads **"35 granted"**, and the grid shows active
   (highlighted) chips for **New Sale (POS)** under Orders, all 4 **Pickers** actions, and
   **Request stock** / **Receive transfer** under **Replenishment**.
   ❌ Old behavior: 30 granted, and Pickers / Replenishment didn't even appear as rows in the
   grid — there was no way to turn them on, even by hand.
4. Fill in name / email / phone / a password, click **Create Team Member**.
5. **Expect:** HTTP success, member appears in the Team list. If you can check that account's own
   sidebar (log in as them), it now shows **20 items** (up from 7 before this fix) — including
   **New Sale**, **Pickers**, **Replenishment**, **Transfers**, **Transfer Discrepancies**.

### ✅ Steps — Support gets Pickers, and the role switch applies the right preset
1. Open **+ Add Team Member** again. Leave Role = Manager (default), note the grid says "35
   granted".
2. Switch the **Role** dropdown to **Support**.
3. **Expect:** permissions reset to **"15 granted"**, and a notice box appears: *"Switched to the
   Support preset for this role, replacing the 35 permissions selected before"* — with an
   **Undo** button.
   ❌ Old behavior: switching to Support silently kept applying the larger Manager preset, so a
   support hire could end up able to create POS cash sales, adjust stock, cancel orders — powers
   a support account should never have.
4. Click **Undo**. **Expect:** the 35 manager permissions come back exactly as they were, and the
   notice disappears.
5. Switch to **Support** again (notice reappears), then manually tick one extra checkbox in the
   grid (e.g. **Pickers → Edit**, which Support doesn't get by default).
   **Expect:** the Undo notice disappears immediately — once you hand-edit after a swap, that
   edit is deliberate and Undo would only throw it away.
6. Save this one as a Support account. **Expect:** their sidebar (15 items with the untouched
   preset) includes **Pickers**, and still does **not** include **New Sale** or **Product COGS**
   (support has no revenue access — see Fix 3).

### ✅ Steps — editing an existing member never re-applies a preset
1. Open **Team**, click **Edit** on an existing manager or support account.
2. **Expect:** the **Role** dropdown is disabled/greyed out, with the hint *"Role is set at
   creation and immutable."*
3. Toggle exactly one permission chip on or off in the grid, then **Save Changes**.
4. **Expect:** only that one permission changed on the account — nothing else shifted, no preset
   was silently re-applied.

### ✅ Edge case — Stock Alerts and Inventory Groups stay off by default
1. On a fresh **Manager** or **Support** preset (new member, before any hand-editing), look at the
   **Inventory** row in the permission grid (**Manage inventory groups** / **View stock alerts**).
2. **Expect:** both chips are **inactive** (not granted) by default in both presets — this is
   deliberate, not an oversight. You can still turn either on by hand if a specific manager needs
   it.

---

## Fix 3 — The Dashboard never shows made-up numbers again

**What was broken:** if any Dashboard data failed to load, the page quietly substituted
demo/sample numbers and displayed them as if they were real. A `support` user (who is not allowed
to see revenue) saw an invented revenue figure. Separately, a failed API call could make a card
read "0% on-time delivery" or "0 active customers" as if that were a fact.

**What changed:** every block on the Dashboard now independently shows one of three honest
states — its real number, **"No revenue access"** (you don't have the permission), or
**"Couldn't load"** with a **Retry** link (the call genuinely failed). Those two messages must
never be swapped for each other, and one block failing no longer blanks the rest of the page.

### ✅ Steps — real access shows real numbers
1. Log in as `store_admin` or `super_admin` (both have `analytics.view_revenue`) and open
   **Dashboard**.
2. **Expect:** Revenue, Orders, Active Customers and AOV tiles show a brief loading skeleton, then
   real figures.

### ✅ Steps — no permission shows "No revenue access", never a fake number
1. Log in as a **support** account (no `analytics.view_revenue` by preset).
2. Open **Dashboard**.
3. **Expect:** every revenue-driven tile (Revenue, AOV, the revenue target/progress card) shows
   the text **"No revenue access"** — never a rupee figure, and never a progress bar that looks
   real.
   ❌ Old behavior: a plausible-looking demo revenue number was shown as if it were this store's
   actual revenue.

### ✅ Steps — a genuine failure shows "Couldn't load" + Retry, and doesn't spread
1. As a role **with** revenue access, open Dashboard, then force one call to fail — e.g. turn off
   WiFi right after the page starts loading, or ask a developer to break one analytics endpoint
   for a moment.
2. **Expect:** only the affected block shows **"Couldn't load"** in red with an underlined
   **Retry** link — not "No revenue access" (that message means "you're not allowed to see this",
   never "it failed to load"), and not a silent 0.
3. Reconnect / let the endpoint recover, click **Retry**.
   **Expect:** the block reloads and shows the real number.
4. **Expect:** the rest of the Dashboard (blocks whose calls succeeded) still shows real data
   the whole time — one block failing does not blank or break the page.
5. Check the delivery-performance row specifically: if that data fails to load, **on-time
   delivery / assignment lag / failed deliveries** show **"Couldn't load"** text, never **"0%"**
   or **"0"** presented as a real result.

---

## Fix 4 — Store owners no longer see warehouse buttons that fail

**What was broken:** a `store_admin` saw **Receive Goods**, **Verify Bill** and **Batch Recall**
in the sidebar. The pages opened fine, but every action on them failed with an access-denied
error, because the backend only allows those actions for warehouse roles. Their sidebar had 28
items. Separately: a `warehouse_staff` user saw supplier "+ New supplier" / "Edit" / "Delete"
buttons they could click and get an error from, and a permanently-0 "Store requests waiting" tile
that bounced them back to the Dashboard when clicked.

**What changed:** those three items are gone from `store_admin`'s sidebar (25 items now), typing
the URL directly redirects them to the Dashboard, and the Suppliers/warehouse-dashboard buttons
now only appear for roles that can actually use them.

### ✅ Steps — store_admin no longer sees or can reach the three warehouse pages
1. Log in as `store_admin`. Look under the **Inventory & Warehouse** section of the sidebar.
2. **Expect:** **Receive Goods**, **Verify Bill**, **Batch Recall** are **not** there. Total
   sidebar count is **25**.
   ❌ Old: all three appeared, sidebar count was 28, and every action inside them 403'd.
3. Type the URL directly into the address bar while still logged in as `store_admin`:
   `damin.haper.in/receive-goods`, then `damin.haper.in/warehouse/verify-bill`, then
   `damin.haper.in/recall`.
   **Expect:** each one redirects you straight back to the **Dashboard** — no error page, no
   partially-loaded warehouse screen.

### ✅ Steps — warehouse roles and super_admin are unaffected
1. Log in as `warehouse_manager`. **Expect:** Receive Goods / Verify Bill / Batch Recall are all
   present and work normally. Sidebar count is **14**.
2. Log in as `warehouse_staff`. **Expect:** same three items present and working. Sidebar count
   is **11**.
3. Log in as `super_admin`. **Expect:** nothing changed — all three present, sidebar count is
   **39**.

### ✅ Steps — Suppliers page respects who can actually manage suppliers
1. Log in as `warehouse_staff`, open **Suppliers**.
2. **Expect:** the supplier list loads and is fully visible. There is **no** "+ New supplier"
   button, and **no** Edit/Delete column on any row.
   ❌ Old: those buttons were shown and clicking them failed with a permission error.
3. Log in as `warehouse_manager`, open **Suppliers**.
4. **Expect:** "+ New supplier", **Edit** and **Delete** are all present and work — this role
   holds the `manage_suppliers` permission that `warehouse_staff` doesn't.

### ✅ Steps — "Store requests waiting" tile only appears where it works
1. Log in as `warehouse_staff`, open the **Warehouses** home page.
2. **Expect:** the **"Store requests waiting"** tile and the **Replenishment** quick-link are
   both hidden.
   ❌ Old: the tile was shown, always read 0, and clicking it bounced back to the same page.
3. Log in as `warehouse_manager`, open the same page.
4. **Expect:** the **"Store requests waiting"** tile is visible, shows a real (non-zero-forced)
   count, and clicking it opens **Replenishment** correctly.

---

## Fix 5 — Shared-computer privacy

**What was broken:** on a shared shop-floor computer, if someone forgot to sign out and a second
person logged in, the second person could briefly see the first person's name, role and menu.
Signing out also left the previous person's recently-visited-page list and any half-finished
goods-receipt draft sitting in the browser for the next person to find.

**What changed:** logging in always shows only the new person's identity. Signing out clears the
recent-pages list and any goods-receipt draft. The light/dark theme choice is deliberately **kept**
— it's a device setting, not a personal one.

### ✅ Steps
1. On one browser, log in as **Admin A** (any role). Visit 2–3 different pages so they show up in
   the search "recent pages" list (open the search/command-palette box at the top of the screen
   and note what's listed).
2. As a **warehouse** role, also open **Receive Goods**, partially fill in an invoice number /
   supplier / a cost line, then navigate away **without** submitting (leaving a draft behind).
3. Click **Logout** (top-right, red icon).
4. Log in as **Admin B** (a different account, ideally a different role).
5. **Expect:** the name/role in the top-right corner, and the colored role-identity strip under
   the top bar, show **Admin B's** identity immediately — never a flash of Admin A's name or role.
6. **Expect:** the "recent pages" list in the search box is **empty** — not Admin A's history.
7. **Expect:** if Admin B opens Receive Goods for the same warehouse, they get a **blank** form —
   Admin A's draft invoice/supplier/cost lines are gone, not resumed.
8. **Theme check:** if Admin A had switched to dark mode (or light mode) before logging out,
   **Expect:** Admin B sees the **same** theme after logging in. This is deliberate — only
   per-person data (recent pages, goods-receipt drafts) is wiped; the device's theme choice stays.
9. **Regression:** with only Admin A logged in the whole session (no logout), refreshing or
   navigating around must **not** clear their own recent pages or in-progress draft — the wipe
   only happens on an explicit logout.
   ➜ **Updated by Fix 6 below:** a session that *expires* is no longer treated as a logout for the
   goods-receipt draft — the draft now survives an expiry. Everything in steps 1–8 (deliberate
   **Logout**) is unchanged.

---

## Fix 6 — "Sign out" vs "your session expired" are no longer the same thing

**What was broken:** the app had one exit door for both cases, so it did the wrong thing on each.

1. **Signing out still left your page behind for the next person.** You look up a customer at
   `/users?q=9876543210`, click **Logout**, walk away. Whoever signs in on that computer within
   the next 5 minutes lands on **your page — with the customer's phone number in the URL**. (The
   sign-out did try to clear it, but the app wrote it back one instant later while switching to
   the Login screen.)
2. **A session expiring destroyed a half-keyed goods receipt.** A warehouse clerk 40 lines into a
   supplier invoice whose token expired lost the whole grid — the autosave was wiped as if they
   had chosen to sign out.

**What changed:** the app now knows *why* the session ended.

| | You clicked **Logout** | Your session **expired** |
|---|---|---|
| Page you were on, after signing back in | Forgotten — next person starts on the Dashboard | Remembered (still only for 5 minutes) |
| Recent-pages list | Cleared | Cleared |
| Goods-receipt draft | Deleted | **Kept** — restored if *you* sign back in, deleted the moment a **different** admin signs in on that computer |

### ✅ Steps — signing out forgets your page (the important one)
1. Log in as **Admin A**. Open **Users** and search a customer's phone number, so the address bar
   reads something like `…/users?q=9876543210`.
2. Click **Logout** (top-right, red icon).
3. Log in as **Admin B** immediately (well within 5 minutes).
4. **Expect:** Admin B lands on the **Dashboard**.
   ❌ Old behavior: Admin B landed on Admin A's Users page, customer's phone number and all.
5. Repeat with the **command palette** version of the same action: search box at the top → type
   "logout" → Enter. **Expect:** identical — Dashboard, not the previous page.

### ✅ Steps — an expired session still brings you back
1. Log in as a **warehouse_manager**. Open **Receive Goods** and part-fill an invoice (invoice
   number, supplier, a few cost lines). Do **not** submit.
2. Ask a developer to expire/revoke your token, then click anything that calls the API.
3. **Expect:** you're bounced to Login. Sign back in **as the same person**.
4. **Expect:** you land back on the **Receive Goods / Warehouse** page you were on, and your
   part-filled invoice is **still there**.
   ❌ Old behavior: the draft was wiped, and you retyped 40 lines.
5. **Now the shared-computer half:** repeat steps 1–2, but sign in as a **different** admin.
   **Expect:** they get a **blank** goods-receipt form — they never inherit a colleague's
   half-keyed invoice (and so can't submit it by accident).

### ❌ Edge cases
- **Wrong password at the Login screen** (the server rejects you): nothing about the previous
  person is resurrected, and you simply stay on Login with the error message.
- **Expired while already on the Login screen:** you are not sent in a loop — the Login page is
  never remembered as a "page to return to".
- **Sign out, then press the browser Back button:** you stay signed out and get the Login screen;
  no page of the previous admin is remembered.
- **Mobile menu:** open the hamburger menu, then let a new-order notification jump you to an
  order. **Expect:** the menu closes with the jump — it never sits open over the new page.

---

## Edge cases (cross-cutting)

- ❌ **Private/incognito windows** where localStorage/sessionStorage may be blocked by the
  browser: logging out must still complete normally — it doesn't hang or error just because the
  housekeeping (Fix 5) couldn't write.
- ❌ **Late reply from an abandoned session**: if Admin A's session finally expires a few seconds
  *after* Admin B has already logged in on the same tab, that expiry must not log Admin B out or
  show an error toast — it belongs to a session that's already gone.
- ❌ **Switching the active store** (top-left store picker) reloads the page — confirm the sidebar
  still loads once, complete, after that reload (it reuses the same loading-skeleton mechanism as
  Fix 1, so it's worth a quick check even though this batch didn't touch the store switch itself).
- ❌ **Stale or unsafe post-login redirect**: a stashed destination older than 5 minutes, or one
  pointing off-site (e.g. something shaped like `//evil.com`), must never be followed — you always
  land on the Dashboard instead.
- ❌ **Manager/Support permission edits never drift silently**: hand-picking permissions on an
  existing account, then re-opening Edit later, must show exactly what was last saved — never a
  preset re-applied on top of it.

---

## For developers — two new commands

| Command | What it does |
|---|---|
| `npm run watch` | Starts the admin app with hot reload, same as `npm run dev`, but also reachable from another device (e.g. your phone) on the same WiFi network. |
| `npm run typecheck:watch` | Continuously re-checks TypeScript in the terminal as you edit — no need to keep re-running `tsc -b` by hand. |

Note: `npm run dev` already had hot reload. `watch` only adds network reachability (`vite --host`).

---

## Automated tests now run in CI

Pushing to `dev` (or opening a pull request into `dev` or the protected branch) now runs the
Vitest suite automatically in GitHub Actions — it did **not** before this batch. The workflow
(`.github/workflows/ci.yml`) has two jobs: `build` (unchanged — `tsc -b && vite build`) and a new
`test` job (`tsc -b`, then `npm test`).

**Open item — do not forget:** one file, `src/pages/Orders/OrderDetailsModal.test.tsx` (5 tests
about order cancellation), is temporarily excluded from the run
(`vitest.config.ts` → `exclude`). It's a pre-existing failure unrelated to this batch — the test's
render harness doesn't wrap the component in a Router, so `useContext(RouterContext)` is null. It
needs an owner and a fix (wrap the render in `MemoryRouter`/`BrowserRouter`) before it can be
un-quarantined. Every other spec file — including all 7 new files from this batch
(`PermissionGrid.test.tsx`, `ProtectedRoute.test.tsx`, `permissions.test.ts`, `Dashboard.test.tsx`,
`TeamMemberModal.test.tsx`, `SuppliersPage.test.tsx`, `WarehouseDashboard.test.tsx`) — runs and
must pass.

Lint (`npm run lint`) is intentionally **not** run in CI yet — the repo has an accepted baseline
of 114 problems; wiring a blocking lint gate is a separate, later decision.

---

## What this needs to ship

- **Frontend-only**, in `haper-admin`. No backend change, no database change, no migration.
- Currently **uncommitted on `dev`** — needs your explicit approval to commit.
- After commit, deploying `damin.haper.in` is manual, as always.
- No route paths were renamed and `/receive-goods` + `/warehouses` still point at the same
  component on purpose (see the plan doc) — bookmarks are untouched.

## Files touched (for reference)

```
.github/workflows/ci.yml
package.json
src/App.tsx
src/api/axios.ts                    (Fix 6 — the 401 interceptor now says "expired", not "signed out")
src/components/PermissionGrid.tsx
src/components/layout/AdminLayout.tsx
src/components/layout/MenuSearch.tsx
src/components/layout/ProtectedRoute.tsx
src/types/auth.ts                   (Fix 6 — the reason a session ended)
src/constants/permissions.ts
src/hooks/useMenu.test.ts
src/hooks/useMenu.ts
src/pages/Dashboard.tsx
src/pages/Login.tsx
src/pages/Team/TeamMemberModal.tsx
src/pages/Warehouse/SuppliersPage.tsx
src/pages/Warehouse/WarehousesPage.tsx
src/pages/WarehouseDashboard.tsx
src/stores/authStore.ts
vitest.config.ts
+ 7 new test files (Dashboard, PermissionGrid, ProtectedRoute, SuppliersPage,
  TeamMemberModal, WarehouseDashboard, constants/permissions)
+ src/constants/storageKeys.ts (new — declares the per-admin localStorage keys Fix 5 clears,
  plus the Fix 6 note recording which admin an expired session's drafts belong to)
+ src/components/layout/AdminLayout.test.tsx (new — Fix 6 proven through the real Sign out
  button, not by calling the store's logout() directly)
```

---

## Fix 8 (2026-08-13) — Product Master is super-admin only

**What changed (business decision, not a bug):** creating/editing products in the global
catalogue is now centralized at the company level. **Product Master** used to be open to
`super_admin` **and** `warehouse_manager`; it is now **`super_admin` only** — both the
sidebar item and the `/products` URL. The backend now matches: **every** route on
`/admin/product` (list, detail, create, assign, upload-image, set-barcode, generate-barcode,
generate-missing-barcodes, edit, status) is `requireRole(SUPER_ADMIN)` — done 2026-08-13 in
`haper-backend`, `packages/admin/src/routes/product/router.js`. The old "anyone with the
`CATEGORIES.VIEW` catalogue permission may browse the master" fallback is gone too, so a
`manager` / `support` / `store_admin` now gets 403 on the list as well.

**The thing most likely to break here:** in the admin code, `/products` and
`/warehouse-staff` used to sit behind **one shared role gate**. Restricting Product Master
by editing that shared gate would have *also* locked the warehouse manager out of
**Warehouse Staff**, which must NOT happen. The gate was split into two, so Warehouse
Staff is worth testing explicitly even though nothing about it was meant to change.

### ✅ Steps — warehouse_manager loses Product Master
1. Log in as `warehouse_manager`. Look under the **Catalog** section of the sidebar.
2. **Expect:** **Product Master** is **not** listed (one fewer sidebar item than before).
   ❌ Old: it was listed and opened normally.
3. Open the top search / command box and type `product master`, `catalogue`, `onboard`.
   **Expect:** no Product Master result.
4. Type the URL directly while still logged in as `warehouse_manager`:
   `damin.haper.in/products`.
   **Expect:** it redirects straight back to the **Dashboard** — no error page, no
   half-loaded product list.

### ✅ Steps — Warehouse Staff is UNCHANGED for warehouse_manager (regression guard)
1. Still logged in as `warehouse_manager`, look under **Inventory & Warehouse**.
2. **Expect:** **Warehouse Staff** is still listed.
3. Open it (or go to `damin.haper.in/warehouse-staff` directly).
   **Expect:** the page loads normally and the manager can still add/edit staff for their
   own warehouse — exactly as before this change.
   ❌ If this bounces to the Dashboard, the route split was done wrong — report it.

### ✅ Steps — super_admin is unaffected
1. Log in as `super_admin`. **Expect:** **Product Master** still in the **Catalog**
   section, opens normally, and create / edit / assign-to-store / discontinue all still
   work. **Warehouse Staff** also unchanged.

### Edge cases
- A `warehouse_manager` with an **old bookmark** to `/products`: lands on the Dashboard.
  That is the intended behaviour, not a bug.
- `warehouse_staff`, `store_admin`, `manager`, `support`: never had Product Master and
  still don't — nothing to re-test beyond confirming it is absent.
- Frontend hiding is **not** the security boundary: after the `haper-backend` deploy,
  `/admin/product` returns **403** for a warehouse manager (and for manager/support/store
  admin) even if the URL is reached some other way. Verify with a direct API call, not just
  the UI.
- **Receive Goods must still work for a warehouse manager.** They can no longer *create* a
  product, so if a delivery contains an item that is not in the master yet, a super admin
  has to add it first. Worth walking once end-to-end after the deploy — this is the most
  likely real-world friction from this change.

### ❌ Steps — API-level check (backend half)
1. With a `warehouse_manager` token, call `GET /admin/product`, `POST /admin/product`,
   `POST /admin/product/:id/assign`, `PATCH /admin/product/:id/barcode`.
   **Expect:** **403** on all of them. ❌ Old: 200.
2. Same calls with a `super_admin` token. **Expect:** unchanged, still work.

### What this needs to ship
- `haper-admin` frontend: `src/hooks/useMenu.ts` (menu gate) and `src/App.tsx` (route
  split) + tests (`src/hooks/useMenu.test.ts`, new `src/App.routes.test.tsx`).
- `haper-backend`: `packages/admin/src/routes/product/router.js` + tests
  (`__tests__/product-master-authorization.test.js`, `__tests__/product-barcode.test.js`).
  DONE 2026-08-13. Needs a `dapi.haper.in` deploy.
- Admin deploy of `damin.haper.in` is manual, as always.
