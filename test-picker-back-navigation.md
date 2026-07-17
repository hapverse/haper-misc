# Test: Back navigation on the picker app

**Area:** Android picker app → the system Back gesture / button on every pushed screen
**App:** haper-picker (Android only)

## What changed / why

On Android 13+ with **gesture navigation**, an edge back-swipe on a pushed screen used to
**minimise the whole app** instead of going back one screen. Example of the bug: you open a
task, tap a line's scan button, then swipe from the edge to go back — the app dropped to the
home screen instead of closing the scanner.

Root cause: the picker uses pure Compose state-based navigation — a `when` block over
remembered flags in `PickerApp.kt` — with **no back-event handling**. The system back gesture
was never consumed, so Android backgrounded the app.

**Fix:** each pushed screen now has an Android `BackHandler`. The back gesture (edge swipe) and
the on-screen device Back button now **pop to the previous screen**, running the *exact same*
transition as that screen's on-screen close/back button (same side effects — refresh, clear
pending scan, etc.). The manifest also sets `android:enableOnBackInvokedCallback="true"` to turn
on the **predictive-back** peek animation (Android 13+).

> This is a **client-only** change in `PickerApp.kt` + `AndroidManifest.xml`. No backend, no API,
> no server deploy. See **Deploy / rollout** at the bottom.

---

## Prerequisites (read once)

1. **A real Android 13+ device** (or emulator, API 33+) with **Gesture navigation** ON:
   **Settings → System → Gestures → System navigation → Gesture navigation**. The bug is
   specific to the **edge back-swipe**, so this mode is the primary thing to test.
2. Also test the **3-button navigation** back button (same Settings screen → 3-button
   navigation) — the on-screen back arrow must behave identically.
3. Also test the **predictive-back peek**: **press-and-hold** an edge swipe (don't release) — you
   should see a preview animation of the screen you're about to return to before you let go. This
   only shows because `enableOnBackInvokedCallback` is on.
4. **Picker app** — a new build with this change installed (debug build pointing at dev, or an
   internal Play release). Build: `cd haper-picker && ./gradlew assembleDebug` →
   `app/build/outputs/apk/debug/`. An **old build will still minimise** — confirm you're on the
   new one.
5. A picker **logged in** with at least one claimable/open task, so you can reach the pushed
   screens (task detail, scanners). On dev: `raunakbbs@gmail.com` → Haper Mart.

---

## Back behaviour after the fix (quick reference)

| Screen (state) | Back gesture / button does… | Same as on-screen… |
|---|---|---|
| **Task list** (home / start) | **Exits the app** (unchanged, correct) | — |
| **Login** (logged out) | **Exits the app** (unchanged, correct) | — |
| **Task detail** | Returns to the task list | the ✕ / close button |
| **Single-item scanner** (line scan button) | Closes scanner → back to task detail | the Back arrow / Cancel |
| **Scan-order scanner** ("scan any item") | Closes scanner → task detail **+ refreshes** | the **Done** button |
| **Settings** | Returns to the task list (**does NOT log out**) | the back arrow |
| **Unscanned-products report** | Returns to the task list | the close button |

---

## The walkthrough

### A. Task list — back exits (unchanged)
1. Open the app and land on the **task list** (Available / My Pickings / Picking History tabs).
2. Do an edge back-swipe.
3. ✅ The app **exits** to the launcher — this is the correct, unchanged behaviour (the task list
   is the start screen; there is nowhere in-app to go back to).

### B. Login — back exits (unchanged)
1. Log out, so you're on the **Login** screen.
2. Do an edge back-swipe.
3. ✅ The app **exits** — correct and unchanged (nothing behind login).

### C. Task detail — back returns to the list
1. From the task list, open any task → the **task detail** screen.
2. Do an edge back-swipe (then repeat with the 3-button back).
3. ✅ You land back on the **task list** — exactly as if you'd tapped the on-screen **✕ / close**.
   Any half-started scan on a line is cleared, same as the close button.
4. ❌ The app must **NOT** minimise / drop to the home screen.

### D. Single-item barcode scanner — back closes the scanner
1. In task detail, tap a line's **Scan to verify / register** button → the full-screen scanner
   opens.
2. Do an edge back-swipe (don't scan anything).
3. ✅ The scanner **closes** and you're back on **task detail** — same as the scanner's on-screen
   **Back arrow / Cancel**. The line is unchanged (nothing verified).
4. ❌ Back must **NOT** minimise the app and must **NOT** jump all the way to the task list.

### E. Scan-order ("scan any item") scanner — back closes + refreshes
1. In task detail, tap the top-bar **scan icon** ("Scan order items") → the continuous scanner
   opens.
2. Do an edge back-swipe.
3. ✅ The scanner **closes**, you return to **task detail**, **and the task refreshes** — this is
   identical to tapping the on-screen **Done** button. Any lines you scanned while it was open
   now show as verified once the refresh lands.
4. ❌ Back must **NOT** minimise the app.

### F. Settings — back returns to the list and must NOT log out
1. From the task list, open **Settings**.
2. Do an edge back-swipe (then repeat with 3-button back).
3. ✅ You return to the **task list** — same as the on-screen back arrow.
4. ❌ **CRITICAL:** back must **NOT log the user out**. You should still be logged in and land on
   the task list, not on the Login screen. Only the explicit **Logout** button logs out.
5. Sanity check: open Settings again, tap **Logout** → ✅ *now* you go to Login. (Confirms only the
   button logs out, back does not.)

### G. Unscanned-products report — back returns to the list
1. From the task-list top bar, open **Products without scan** (the report/audit icon).
2. Do an edge back-swipe.
3. ✅ You return to the **task list** — same as the on-screen close.
4. ❌ Back must **NOT** minimise the app.

---

## Multi-level back (order matters — verify both steps)

This is the scenario the bug hit hardest. Test it explicitly.

1. From the task list, **open a task** (→ task detail).
2. In task detail, **open a scanner** — either a line's single-item scanner **or** the scan-order
   scanner (test both, one at a time).
3. **First** edge back-swipe → ✅ the **scanner closes** and you land on **task detail** (NOT the
   task list, NOT minimised). If it was the scan-order scanner, the task refreshes here.
4. **Second** edge back-swipe → ✅ **task detail closes** and you land on the **task list**.
5. **Third** edge back-swipe (from the task list) → ✅ the app **exits** (expected — you're back at
   the start screen).
6. ❌ At no point during steps 3–4 may the app minimise. The order must be scanner → detail →
   list, one screen per back press — never skipping a level or jumping straight out.

---

## Edge cases

- **Back while an action is loading.** Start a pick / verify / out-of-stock on a line, and while
  the spinner is showing, do an edge back-swipe. ✅ Back closes the current screen the same as the
  on-screen close; the in-flight action still completes and updates the list. It must not crash or
  double-fire the action, and it must not minimise the app.
- **Scan-order back triggers a task refresh.** Confirm the scan-order scanner's back (scenario E)
  actually **reloads** the task — scan a line, back out, and check that line now shows verified on
  detail. This matters because scan-order's on-screen Done refreshes; the back gesture must do the
  same refresh, not skip it.
- **Rapid double-back.** On task detail, quickly swipe back **twice** in a row. ✅ You should end on
  the task list (first back → list, second back → app exits *only if* the second landed on the
  list). The point: two fast presses must not skip a screen or leave the UI in a stuck/blank state.
- **3-button nav parity.** Repeat scenarios C–G with **3-button navigation** — the hardware/on-
  screen back button must behave exactly like the gesture swipe on every screen.
- **Predictive-back peek.** On any pushed screen, press-and-hold the edge swipe. ✅ A preview of the
  destination screen animates in before you release. Releasing completes the back; sliding back
  cancels it (stays on the current screen).

---

## Deploy / rollout

- **Client-side Android change in `haper-picker` only** (`PickerApp.kt` + a manifest flag). It needs
  a **new picker app build installed on the device** — a debug APK (`./gradlew assembleDebug`) for
  testing, or an **internal Play Store release** for the pickers.
- **No backend / API / server change**, no dev deploy — the same backend serves old and new builds.
- An **old build still minimises** on back, so verify the tester is on the new build before filing a
  bug (see Prerequisites #4).
</content>
</invoke>
