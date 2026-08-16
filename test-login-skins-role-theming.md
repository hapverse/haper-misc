# Test: Login skins + role-based theming (admin panel)

**Area:** Admin panel (`damin.haper.in`, dev). Login page, per-role accent colour across every
screen, POS (`/new-sale`), Shelf Labels preview.
**Repo:** `haper-admin` only — **no backend change, no API change, no database change, no
migration.** `POST /admin/auth/login` and `GET /admin/me` are called exactly as before.
**Roles involved:** `super_admin`, `store_admin`, `manager`, `support`, `warehouse_manager`,
`warehouse_staff`.
**Status:** Uncommitted on `dev` (12 modified files + 8 new files). Nothing is committed,
nothing is deployed. Needs your explicit go-ahead.
**Plan doc:** `haper-admin/docs/plans/login-skins-role-theming.md` (source of truth).

---

## What changed and why it matters

1. **Three login skins, one login.** `/login` (store), `/login/w` (warehouse), `/login/sa`
   (super admin). Same form, same server, same account — only the look differs (a coloured
   "portal" pill, a sub-headline, the browser tab title). Any account can sign in from any of
   the three. Example: a warehouse manager can bookmark `/login/w` and always see a red
   warehouse page, but if they open plain `/login` they'll see the green store page and their
   login still works exactly the same.
2. **A colour per role once you're signed in.** Store roles = green, warehouse roles = red,
   super admin = orange, anything else = the default indigo. It's only the accent colour
   (buttons, links, highlights, the role pill). Backgrounds and light/dark are unchanged.
3. **Two real bugs fixed on the way:**
   - The old default indigo `#6366f1` was 4.47:1 white-on-button — just under the 4.5:1
     accessibility minimum. It is now `#5b57e8` (5.29:1).
   - The login form's labels were not attached to their inputs, so a screen reader announced
     nothing. They are now, plus autofill hints, a show/hide password button, and three
     separate error messages instead of one catch-all.
4. **The login page now follows light mode.** Before, a light-theme user still got a dark login
   card.
5. **Two screens deliberately opt out** of role colour — see "Deliberate exceptions" below.

**Nothing about permissions changed.** Colour is decoration only: no button, page, menu item or
API call behaves differently because of it.

---

## Quick reference — which colour each role sees

| Role | Accent family | Colour |
|---|---|---|
| `store_admin`, `manager`, `support` | store | green |
| `warehouse_manager`, `warehouse_staff` | warehouse | red |
| `super_admin` | super | orange |
| signed out / unknown | neutral | indigo |

---

## A. Login skins

1. ✅ Open `/login` → pill reads **STORE PORTAL** (green), sub-headline "Sign in to your store
   dashboard", browser tab reads "Store portal — Haper Admin".
2. ✅ Open `/login/w` → **WAREHOUSE PORTAL**, red pill, tab "Warehouse portal — Haper Admin".
3. ✅ Open `/login/sa` → **SUPER ADMIN**, orange pill, tab "Super admin — Haper Admin".
4. ✅ Below the card there are two links to the other two portals. Clicking one switches the
   look immediately. Hovering shows a tooltip saying the links only change the look.
5. ✅ Sign in as a **store** account from `/login/sa` (the "wrong" portal) → login succeeds
   normally. The portal is cosmetic; it is not a role selector.
6. ✅ Open a nonsense path like `/login/zzz` → you land on a working login page, not a broken
   one.
7. ✅ Switch the app to light mode, sign out, look at the login page → the card is light
   (white), not the old dark card.

## B. Login form accessibility & errors

8. ✅ Click the word "Email" → the cursor jumps into the email box (labels are now attached).
   Same for "Password".
9. ✅ The eye icon next to the password shows/hides it, and is at least 44×44px (usable on a
   phone).
10. ✅ Wrong password → "Email or password is incorrect." The password box empties, the email
    stays filled, and the cursor returns to the email box.
11. ✅ Sign in with an email the browser accepts but the server rejects (e.g. `admin@localhost`
    — no dot in the domain) → should show "Email or password is incorrect.", NOT "Can't reach
    the server."
12. ✅ Try wrong passwords enough times to hit the rate limit (429) → a distinct message, and
    the Sign in button **stays clickable** so you can retry once the wait is over.
13. ✅ Turn Wi-Fi off and submit → "Can't reach the server. Check your connection and try
    again." (not the "incorrect password" message).
14. ✅ While signing in, the boxes stay readable (greyed-out-and-unreadable is the old
    behaviour; they are now read-only instead of disabled).
15. ❌ Not expected: a success tick after login. Being taken to the dashboard IS the
    confirmation.

## C. Role colour after signing in

15. ✅ Sign in as `store_admin` → the role pill at the top, primary buttons and links are
    green on every page.
16. ✅ Sign in as `warehouse_manager` → red. As `super_admin` → orange.
17. ✅ Toggle light/dark with the sun/moon button → the role colour survives the toggle; only
    the background changes.
18. ✅ Refresh the page → the colour is correct from the very first paint (no indigo flash).
19. ✅ Sign out → the colour returns to indigo, and you land back on the portal you signed in
    through (sign in at `/login/w`, sign out, you're back at `/login/w`).
20. ✅ Two tabs open, sign out in one → the other tab also returns to the login page, as
    before. (Cross-tab behaviour is unchanged by this work.)

## D. Deliberate exceptions

21. ✅ **POS (`/new-sale`) stays indigo for every role** — green for the rest of the app, but
    indigo at the till. This is on purpose: whoever is standing at the counter must see the
    identical screen, because staff hit "Charge" from muscle memory. Cash handling is not the
    place for a colour surprise.
22. ✅ **Shelf Labels preview pane renders in light mode even in dark mode** — the preview
    panel (heading, background, card borders) goes white, like the paper the labels print on.
    The toolbar, scope selector and Print/Export buttons above it stay in your chosen theme.
23. ❌ Not expected: `/recall`, `/stock-alerts`, `/transfer-discrepancies` losing their red
    warnings; `/orders`, `/transfers`, `/warehouses` going neutral; `/config`, `/team`,
    `/audit-log` going neutral. These stay role-coloured on purpose — the reasons are written
    in `haper-admin/src/constants/themeOverrides.ts`.

## E. Nothing else moved

24. ✅ Every screen keeps its layout — the colour wrapper adds no box (`display: contents`).
    Check the sidebar, the orders board and POS specifically.
25. ✅ Red "danger" buttons (delete/cancel) stay red for every role, including for the
    warehouse (red accent) roles — the warehouse accent was deliberately darkened to
    `#be123c` so a primary button and a destructive button never read as the same colour.

---

## Edge cases worth a look

- Bare `/login` shows the **store** skin even for a super admin who bookmarked it. Intentional.
- Private-mode browsers that block localStorage: the remembered portal silently falls back to
  `/login`, and the role colour falls back to indigo. Nothing breaks.
- An admin with no roles at all: indigo, label "ADMIN".

---

## What this needs

- **No backend deploy. No migration. No app-store release.** Frontend only.
- Admin deploy to `damin.haper.in` after commit — manual, as always.
