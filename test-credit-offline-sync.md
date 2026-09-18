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

### ✅ Queued entries leave on their own — no extra tap (regression, Android)

Earlier Android builds only sent queued entries when the shopkeeper added **another** entry. If
they reconnected and just looked at the screen, entries sat on the phone forever and the other
device never saw them.

1. In airplane mode, add `100` **You gave** for any customer. Note the pending count ("1 waiting").
2. Turn airplane mode off and **do not touch the app**.
   - **Expect:** the pending count reaches zero within a few seconds, with no tap.
   - **Expect:** the entry appears on the second device.
3. Repeat, but turn the network back on while the app is in the **background**, then open it.
   - **Expect:** the entry syncs within **~30 seconds** at the latest (the app also checks on
     a timer, in case it missed the "network is back" signal).

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

### ✅ Correct an entry (edit)

1. Ramesh has an entry of `500`. Edit it to `450`.
   - **Expect:** balance drops by ₹50.
   - **Expect:** on the other device, the same correction appears and the balance matches.

### ✅ Delete an entry

1. Delete a `500` entry.
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

### ✅ Fresh install, same phone number

1. Uninstall and reinstall (or clear web site data). Log in with the same number.
   - **Expect:** all customers and balances come back from the server.
   - **Expect:** the totals match the other device exactly.

---

## Known limitations (not bugs)

- **Attachments/photos on an entry** are not built — v1.1.
- **Only English and Hindi** ship; the other 9 languages are v1.1.
- A **deleted customer** is not implemented yet — only entries can be deleted.

## What this needs to ship

Backend deploy of haper-credit to `dev` + an updated debug APK / web build. The "leave on their
own" check needs an APK built from `c0ec757` or later. **No** DLT, Meta or
PSP dependency for anything in this guide.
