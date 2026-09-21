# Test: haper-credit — offline entries, multi-device sync, edits and deletes

**Area:** haper-credit Android + web + iOS (home, customer ledger). No effect on any other Haper app.
**Backend:** `haper-credit/apps/backend/src/{ledger,sync,notify}`, `packages/shared/src/fold.ts`.
**Apps:** Android, iOS, Web (all three implement the same sync engine).
**Needs:** `dev` deploy of haper-credit backend + a debug APK / local web build. No DLT, no Meta, no PSP.

## What this covers

The core of the product: a shopkeeper records *udhar* (credit) with **no internet**, and it is
still correct when they reconnect — including when a second phone was writing at the same time.

Plain terms: a shopkeeper gives goods worth ₹500 on credit. They tap **You gave ₹500**. Later the
customer pays ₹300 — **You got ₹300**. Balance ₹200. That is the whole product; everything else
protects those two numbers.

## How it works (needed to test it properly)

**The ledger is append-only.** Nothing is ever edited or deleted in place. Correcting ₹500 to ₹450
writes a *new* correction record pointing at the original. Deleting writes a *cancel* record. The
balance is recomputed by adding up the surviving records.

**Why that matters to you as a tester:** two phones that were both offline can never "conflict".
Their records simply combine. So the expected result of any offline test is *both devices agree*,
never *one device wins*.

**The realtime channel is a doorbell, not a delivery.** The server only tells a device "your book
moved", and the device then fetches. So if you kill the network mid-test, entries arrive **late**,
never wrong, and never lost.

---

## Manual test steps

### ✅ Record credit and a repayment (the two-button core)

1. Log in (see `test-credit-auth.md`). Add a customer "Ramesh".
2. Open Ramesh → enter `500` → tap **You gave**.
   - **Expect:** balance shows **₹500.00**, labelled *Owes you*.
   - **Expect:** home screen *You will get* is **₹500.00**.
3. Enter `300` → tap **You got**.
   - **Expect:** balance **₹200.00**, still *Owes you*.
4. Enter `200` → **You got**.
   - **Expect:** balance **₹0.00**, labelled **Settled** (not blank, not missing from the list).

### ✅ A supplier you owe (negative balance)

1. Add "Wholesaler" → enter `700` → **You got**.
   - **Expect:** balance **₹700.00** labelled *You owe*.
   - **Expect:** home *You will give* is **₹700.00**, and *You will get* is unchanged.
   - **Expect:** the two totals never cancel each other out.

### ✅ Record entries in airplane mode (THE test)

1. Put the phone in **airplane mode**. Confirm no signal.
2. Add a new customer "Sunita" and three entries: `100` gave, `250` gave, `150` got.
   - **Expect:** every tap is **instant** — no spinner, no "no internet" error, no blocked button.
   - **Expect:** balance updates immediately to **₹200.00**.
   - **Expect:** the home banner says *Saved on this phone. Will sync when you are online.*
   - **Expect:** a pending count appears (e.g. "4 waiting to sync" — 3 entries + the customer).
3. Force-close the app and reopen it, still in airplane mode.
   - **Expect:** Sunita and all three entries are **still there** with the same balance.
4. Turn airplane mode off.
   - **Expect:** within a few seconds the pending count drops to zero and the banner says *All saved*.
   - **Expect:** the balance does **not** change during the sync. It was already correct.

### ✅ The web app **opens** with no internet (web only)

On a phone the app is installed, so it obviously opens offline. In a browser it used to need the
internet just to load the page itself — so with no signal the tester got the browser's "no
internet" page and never even reached their khata. It should now open from the browser's own
saved copy.

1. Open the web app in the browser **once, while online**, and log in. Add a customer and one
   entry so there is something to see.
2. Wait about 5 seconds (the browser is saving its copy of the app), then **reload once** so the
   saved copy is the one in use.
3. Turn on **airplane mode** (on a desktop: browser developer tools → Network tab → tick
   *Offline*).
4. **Reload the page.**
   - **Expect:** the app opens normally — the customer and the entry are there, with the right
     balance.
   - **Expect:** *not* a browser error page ("No internet", "This site can't be reached").
   - **Expect:** the text looks the same as when online, in English **and** in Hindi (the app now
     carries its own fonts instead of fetching them from Google).
   - **Expect:** the offline banner appears and entries can still be added, exactly as in the
     airplane-mode test above.
5. Turn the internet back on and reload.
   - **Expect:** everything syncs as normal; nothing was lost.

Note for whoever deploys a new web build: a browser that already has the old copy picks up the new
one on the **next** reload after the one that fetched it — so reload twice before reporting "the
fix isn't there".

### ✅ Offline, the web app shows the real shop name and QR — not a placeholder

Until now the shop name and the payment QR were only ever fetched from the internet, so opening
the web app with no signal showed "HaperCredit" and an empty QR box for a shop that had been set
up for weeks.

1. Online, in the web app, go to **Profile → Payment setup** and upload your UPI QR screenshot.
   Make sure **Profile → Edit** shows your real shop name.
2. Go back to the home screen and wait a few seconds.
3. Turn on **airplane mode** and **reload the page**.
   - **Expect:** the top of the home screen shows your real shop name, not "HaperCredit".
   - **Expect:** open any customer who owes you → the QR icon → the balance card shows **your QR
     picture**, with a small line saying the app could not check for a newer one.
   - **Expect:** it does *not* say "Add your QR in Payment setup" — that line is only for a shop
     that has genuinely never uploaded one.
4. Turn the internet back on and reload.
   - **Expect:** same shop name and same QR, and that small "couldn't check" line is gone.

### ✅ An entry the server refused is called out, never counted silently

Very rarely the server permanently refuses an entry (for example it was already deleted
elsewhere). That entry stays in this device's total, so this device would otherwise show a
different amount from the shopkeeper's other phone with nothing on screen saying why.

This one needs a developer to force a refusal — ask them to make one queued entry come back
rejected. Then, in the web app:

1. Look at the **home screen**.
   - **Expect:** an orange strip near the top: "1 entry couldn't be sent. It is counted in the
     totals below, but your other devices don't have it."
   - **Expect:** the customer's row ends with "couldn't be sent" instead of "waiting to sync".
2. Open that customer.
   - **Expect:** the same strip above their balance, and the refused entry's bubble is marked
     "couldn't be sent" in red.
3. Open the same shop on a second device.
   - **Expect:** that device's total is different — and step 1's strip is what explains the gap.
     A total that differs with **nothing** on screen explaining it is the bug.
4. **Android** shows the same disclosure, in the same words: the strip on the home screen above
   the two totals, the strip again above the customer's balance, and the refused entry's bubble
   carries a red **"couldn't be sent"** tag instead of the orange "Waiting to sync".
   - **Expect:** the "N waiting to sync" pill does **not** count it — it is not waiting for
     anything — which is exactly why the strip has to be there.
5. Repeat the same three steps on **iOS** — same strip, same "couldn't be sent" on the customer
   row and on the entry itself.

### ✅ iOS: a save that fails keeps you on the entry screen

A saved entry is money. If saving to the phone itself fails, the screen used to close as though it
had worked, and the entry was simply gone. (Needs a developer to force the phone's own save to
fail — an entry that saved fine but has not reached the server yet is **not** this case.)

1. On iOS, open a customer → `100` → **You gave** → **Save**.
   - **Expect:** a red strip on the same screen: "Couldn't save on this phone. Nothing was
     recorded — please try again." The screen **stays open** with the ₹100 still typed in.
   - **Expect:** the balance does **not** change, and no "waiting to sync" entry appears.
2. Same for editing and deleting an entry, and for adding a customer.
3. Shop details and Payment setup behave the same way: if the save does not reach the server,
   the screen stays open with an error instead of closing silently.

### ✅ iOS: reopening the app fetches straight away

1. On iOS, leave the app (home button / app switcher) and add an entry on a second device.
2. Wait about a minute, then reopen the iOS app.
   - **Expect:** the other device's entry is already there, or appears within a second — not up
     to 30 seconds later. (Nothing fetches while the app is asleep, so the reopen itself is what
     triggers the fetch.)

### ✅ Queued entries leave on their own — no extra tap (regression, Android)

Earlier Android builds only sent queued entries when the shopkeeper added **another** entry. If
they reconnected and just looked at the screen, entries sat on the phone forever and the other
device never saw them.

1. In airplane mode, add `100` **You gave** for any customer. Note the pending count ("1 waiting").
2. Turn airplane mode off and **do not touch the app**.
   - **Expect:** the pending count reaches zero within a few seconds, with no tap.
   - **Expect:** the entry appears on the second device.
3. Repeat, but turn the network back on while the app is in the **background**, then open it.
   - **Expect:** the entry syncs **as soon as you open the app** — reopening now triggers a sync
     immediately rather than waiting for a timer tick.
   - **Expect (battery):** while the app is in the background it no longer checks every 30
     seconds. The 30s timer runs only while the app is on screen, so a phone left with the app
     backgrounded overnight must not show repeated network activity for HaperCredit.

### ✅ Web: an entry made online leaves at once, not on the next timer tick

1. With the web app **online** and a second device open on the same customer, add `150`
   **You gave** on web.
   - **Expect:** it shows on the second device within a couple of seconds — not up to
     30 seconds later. (Web used to wait for its timer; Android and iOS always sent
     straight away.)
2. Put the web tab in airplane mode, add another entry, then turn the network back on
   without touching the tab.
   - **Expect:** the pending count drops to zero within a few seconds.

### ✅ Two devices, both offline, then both reconnect

1. Log in on **two** devices with the **same phone number** (e.g. Android + web).
   - **Expect:** both show the same customers and balances.
2. Put **both** offline.
3. On device A: Ramesh → `500` **You gave**.
4. On device B: Ramesh → `200` **You got**.
5. Bring **B** online first, then **A**.
   - **Expect:** after both sync, **both devices show the identical balance** (₹300 more than before).
   - **Expect:** both entries survive. Neither device's work is discarded.
6. Repeat with **A** online first.
   - **Expect:** the same final balance. Order of reconnection must not matter.

### ✅ Realtime: an entry on one device appears on the other

1. Both devices online, both open on the same customer.
2. On device A, add `75` **You gave**.
   - **Expect:** device B updates within about 1–2 seconds **without any refresh or pull-down**.

### ✅ Realtime is only a convenience — killing it must not lose data

1. Both devices online. On device B, turn Wi-Fi off and mobile data off (kill its connection only).
2. On device A, add `60` **You gave**.
3. Wait 10 seconds. On device B, restore the connection.
   - **Expect:** device B shows the ₹60 entry **within ~30 seconds** (it arrives on the next fetch).
   - **Expect:** it is never lost, and the balance is right when it appears.

### ✅ Web: a tab left open all afternoon still gets live updates

1. On the web app, open a customer and leave the tab open, untouched, for **20+ minutes**
   (sign-ins go stale after about 15 minutes, so this is the case that used to break).
2. On another device, add `40` **You gave** for that same customer.
   - **Expect:** it still arrives on the web tab within a second or two — the app quietly signs
     itself back in and reconnects in the background. You should never have to reload the page.
3. Now turn the computer's Wi-Fi off for a moment, then back on, and add `40` on the other device.
   - **Expect:** the web tab shows the status honestly while it is cut off, and the entry still
     arrives **within ~30 seconds** once the connection is back — instant delivery is a bonus,
     the regular fetch is what guarantees it.
   - **Expect:** saving entries on the web tab keeps working throughout.

### ✅ New customer screen (Mint Fresh)

1. Open a customer with a few entries.
   - **Expect:** entries look like a chat. **You gave** bubbles sit on the **right** in light red;
     **You got** bubbles on the **left** in light green. Each shows amount, note, time and the
     balance after it ("Bal ₹2,300"). Dates appear as small separators.
   - **Expect:** an entry saved offline shows a small "waiting to sync" mark until it syncs.
2. Tap **You gave** at the bottom.
   - **Expect:** the entry form opens with **You gave** already selected (switchable to You got).
   - Type `650`. **Expect:** "New balance: …" updates as you type, before saving.
   - Tap **Yesterday**, then **Pick date** and choose a date. **Expect:** future dates cannot be
     picked, and the entry appears under the chosen date after saving.

### ✅ Correct an entry (edit)

Tap the entry's bubble to open **Edit entry**. It shows "Was ₹X on <date>" and a **History** list
(the original amount plus every change) — corrections are never silent.

1. Ramesh has an entry of `500`. Edit it to `450`.
   - **Expect:** balance drops by ₹50.
   - **Expect:** on the other device, the same correction appears and the balance matches.

### ✅ Delete an entry

1. Tap a `500` entry → **Delete entry**.
   - **Expect:** the app asks you to confirm first.
   - **Expect:** it disappears from the list and the balance drops by ₹500.
   - **Expect:** the other device agrees after syncing.

### ✅ Delete on one device while the other edits it offline (the nasty one)

1. Both devices online and showing an entry of `500`.
2. Take device B **offline**.
3. On device A (online): **delete** that entry.
4. On device B (offline): **edit** the same entry to `9999`.
5. Bring B online.
   - **Expect:** the entry stays **deleted** on **both** devices.
   - **Expect:** the balance does **NOT** include ₹9999 anywhere, on either device, ever —
     not even briefly.
   - **This is the single most important assertion in this guide.** If ₹9999 appears, stop and
     report it: a deleted entry has come back to life.

### ✅ Typing an entry is quick, and a half-typed one is never lost silently

Run on Android, iOS and web.

1. Open a customer → **You gave**.
   - **Expect:** the cursor is already in the amount box and the number keyboard is up. You can
     type `350` straight away without tapping first. (On web this only applies on a phone.)
2. Type `350`, then press **Back** or the ✕.
   - **Expect:** "Discard this entry?" with **Keep editing** / **Discard**.
   - **Keep editing** → you are back with `350` still typed.
   - **Discard** → the screen closes, no ₹350 entry exists, and the balance is unchanged.
3. Open the entry screen again and press Back without typing anything.
   - **Expect:** it closes straight away, with no question.
4. Open an existing entry to edit it and change its amount, then press Back.
   - **Expect:** the same question. With nothing changed, Back closes without asking.
5. iOS only: with an amount typed, try swiping the screen down.
   - **Expect:** it does not close. Use ✕ to get the question.
6. Web only: with an amount typed, try to close or refresh the tab.
   - **Expect:** the browser asks "Leave site?".

### ✅ Small screen details

1. Open a customer who has **no phone number**.
   - **Expect:** the header under their name reads just "Customer", not "Customer ·". With a phone,
     it reads "Customer · +91…".
2. Tap **Add customer** and look at the sheet that slides up.
   - **Expect:** a white or light-mint sheet (Mint Fresh), never pale lavender or grey.
3. Type a name, then tap **Save**. Next time, swipe the sheet away instead.
   - **Expect:** both times the keyboard goes away with the sheet and does not stay over the list.

---

## Edge cases

### ✅ The same payment recorded on two phones (duplicate, not conflict)

1. Both devices offline. Both record `500` **You got** for the same customer, same day.
2. Reconnect both.
   - **Expect:** **both** entries are kept and the balance reflects ₹1000.
   - **Correct behaviour:** the app must **not** silently merge them. A customer really might pay
     ₹500 twice, and silently dropping one erases a real payment. Two identical entries the
     shopkeeper can see and delete is the safe outcome.

### ✅ Amounts with paise

1. Enter `450.50` **You gave**.
   - **Expect:** exactly **₹450.50**. Not ₹450, not ₹451.
2. Enter `12.345`.
   - **Expect:** **₹12.35** (rounded, never truncated).
3. Try `0`, `-5`, `abc`, `.`
   - **Expect:** rejected. No entry created, no crash.

### ✅ Large amounts and Indian formatting

1. Enter `1234567.89`.
   - **Expect:** **₹12,34,567.89** (lakh grouping, not ₹1,234,567.89).
2. Add an entry of `10000000` (one crore), then tap it to **edit** it.
   - **Expect:** the amount box opens on **10000000**. It used to read **1.0E7**, which is not a
     number anyone can check, let alone correct.

### ✅ An entry with no "gave/got" or a silly amount is refused

Only testable with a tool that can call the API directly; the apps always send both.

1. Push an entry through `POST /api/v1/sync/mutations` with `direction` missing, or set to
   something other than `gave`/`got`.
   - **Expect:** refused with `VALIDATION_FAILED`, naming that entry's id. Previously it was
     accepted and counted as money **received**, which quietly changed the balance.
2. Push an entry with `amountPaise` larger than 9007199254740991.
   - **Expect:** refused with `VALIDATION_FAILED`. Above that, the arithmetic loses precision.
3. Push an entry carrying a `deviceId` that is not the device you logged in with.
   - **Expect:** accepted, but the stored entry is filed under **your** device — the entry
     history on the other phones must never show a device that did not write it.

### ✅ Wrong device clock

1. Set the phone's date **one year in the past**. Add an entry offline. Reconnect.
   - **Expect:** the entry appears in the correct position relative to other entries
     (the server assigns ordering; the device clock is only a display date).
   - **Expect:** the balance is correct on every device.

### ✅ Offline for a long time

1. Go offline, add 20+ entries across several customers over a few app sessions.
2. Reconnect.
   - **Expect:** all entries sync, the pending count reaches zero, balances match on the other device.
   - **Expect:** no "please re-download" or data-loss prompt.

### ✅ Airplane mode during the sync itself

1. Queue several offline entries. Turn the network on, and turn it **off again after ~1 second**.
   - **Expect:** no duplicates when it finally syncs. Balances are correct, not doubled.
   - **Expect:** the pending count does not get stuck forever — it retries and clears.
2. **Android, with the server returning an error** (ask a developer to point the app at a broken
   server): open a customer's **Share balance card**.
   - **Expect:** the "as on" line does **not** move forward. A failed check must never be
     recorded as a successful one — the app used to treat a server error as a finished sync.

### ✅ Fresh install, same phone number

1. Uninstall and reinstall (or clear web site data). Log in with the same number.
   - **Expect:** all customers and balances come back from the server.
   - **Expect:** the totals match the other device exactly.

---

### ✅ A new customer and their first entry, added offline together

The server refuses an entry for a customer it has not seen yet, and the app simply retries — so
the two must still arrive safely even when the network is flaky.

1. In airplane mode, add a **new** customer "Kavita" and an entry `200` **You gave** for her.
2. Turn the network on and off a few times, then leave it on.
   - **Expect:** within a minute both sync; the other device shows Kavita with ₹200.
   - **Expect:** nothing stays stuck on "waiting to sync".

(Developer note: an entry naming another shop's customer is refused with `FACT_TARGET_MISSING`
and kept in the outbox; it is never filed into this shop's book.)

### ✅ A big offline batch across several new customers syncs in one go

1. In airplane mode, add **three new** customers ("Suresh", "Geeta", "Imran") and 2–3 entries for
   each (about 8 entries in total).
2. Turn the network on.
   - **Expect:** within a few seconds the pending count reaches zero and the banner says
     *All saved*.
   - **Expect:** the second device shows all three customers with the right balances.
   - **Expect:** nothing stays on "waiting to sync".

(Developer note: if the server refuses particular entries, it names them in `error.factIds`.
The app sets those aside, marking a malformed entry as rejected or retrying an entry that is
waiting for its customer, and sends the rest in the same run, so one bad entry can no longer
hold up the others. A tester can't trigger this from the screens; the automated tests
`PushSplitTest` (Android), `PushSplitTests` (iOS) and `engine-push-split.spec.ts` (web) cover it.)

(Developer note, the other direction: the web app now checks every entry it *downloads* before
saving it. An entry that arrives damaged — e.g. with no amount — is refused instead of stored, so
it can never show up inside a balance; the rest of the batch saves normally. The shopkeeper sees a
warning on Home and on that customer's ledger — *"Can't read some entries — update the app.
Balances here may be incomplete."* — which stays for the rest of the session, because the skipped
entries do not come back on a later sync. Details also go to the browser console. Covered by
`engine-kick.spec.ts` (web).)

(Developer note, iOS sync status: iOS has no live doorbell connection yet — it fetches on a
30-second timer, on every write and on reopening the app. It therefore reports its state as
*degraded* ("HTTP works, no push channel"), never *live*, which is what the shared state machine
means by those words. Nothing on screen changes; the pill still says "All saved". Covered by
`SyncHonestyTests` (iOS).)

(Developer note, Android sync status: Android has no live doorbell connection either, so
*degraded* is its honest best case too — but it now only reports that after a fetch has really
landed. A fetch that came back empty because the server errored used to finish the cycle as if it
had worked, so a dead connection was relabelled healthy every 30 seconds. It reports *offline*
now, and the "as on" time stays put. Covered by `PullHealthTest` (Android).)

## Known limitations (not bugs)

- **Attachments/photos on an entry** are not built — v1.1.
- **Only English and Hindi** ship; the other 9 languages are v1.1.
- A **deleted customer** is not implemented yet — only entries can be deleted.
- **Web: the browser's own Back button** does not ask before dropping a half-typed entry; only the
  app's ✕/back button and closing the tab do.
- **iOS has no instant (push) updates** — it fetches every 30 seconds, on each write and when the
  app is reopened. Entries arrive late at worst, never wrong.

## What this needs to ship

Backend deploy of haper-credit to `dev` + an updated debug APK / web build. The "leave on their
own" check needs an APK built from `c0ec757` or later. **No** DLT, Meta or
PSP dependency for anything in this guide.
