# Test: haper-credit — customer statement link, PDF, reminders and UPI payment

**Area:** haper-credit Android + web (customer screen), plus the **public statement page** a
customer opens in any browser with no app installed.
**Backend:** `haper-credit/apps/backend/src/{statement,reminder,merchant}`.
**Apps:** Android, iOS, Web (share + remind). The statement page itself is served by the backend.
**Needs:** `dev` backend. **No** Meta/WhatsApp approval and **no** PSP onboarding needed for any
step here — that is the point of how this was built.

## What this covers

The feature that makes the app worth switching to: the shopkeeper sends a link, and the customer
sees their own khata **without installing anything**. Plus getting paid, and nudging a customer.

### How payment works here (read this before testing)

The customer **pushes** the payment from their own UPI app. The money goes **straight to the
shopkeeper's own UPI id** — it never passes through Haper.

Why it is built that way: NPCI switched off the old "shop requests, customer approves" flow
(UPI Collect) for merchant payments on **28 Feb 2026**. And holding other people's money would
make Haper a regulated payment aggregator. So: the shopkeeper enters their own UPI id, the
customer taps a link or scans a QR, and the shopkeeper confirms receipt by hand.

**Consequence you must test for:** nothing marks the entry paid automatically. The shopkeeper
records "You got ₹X" themselves.

---

## Manual test steps

### ✅ Set up the shop profile

1. On web or Android → shop settings.
2. Set shop name to "Ramesh Kirana" and UPI id to a **valid** one (`something@okaxis`).
   - **Expect:** saved confirmation.
3. Try an invalid UPI id: `not a vpa`, `ramesh`, `@okaxis`.
   - **Expect:** rejected with "That is not a valid UPI id."
   - **Why this is strict:** a typo here sends a customer's money to a stranger and nothing
     downstream would catch it.

### ✅ Changing the UPI id stays instant, and is recorded

Changing the shop's payment id asks for **no OTP and no password**. That is deliberate — the
shopkeeper changes it rarely and should not be locked out of their own money. The safety net is
that they get told it happened.

1. Change the UPI id to another valid one.
   - **Expect:** it saves straight away — **no OTP screen, no extra confirmation**.
   - Behind the scenes the server also stores *when* it changed and *which device* did it, so a
     surprise change can be explained afterwards. Nothing shows this in the app yet.
2. Save the **same** UPI id again, or change only the shop name.
   - **Expect:** saves normally, and no alert is triggered (nothing changed).

**Alert SMS — not live yet.** An SMS telling the shopkeeper "your UPI id was changed" is built
but **switched off**, because India's DLT rules need the exact message text registered with the
telecom operators first, and that registration does not exist yet. Until it does, no SMS is sent
and there is nothing to test here. Once registered it is an environment change only
(`UPI_CHANGE_ALERT_ENABLED=true` plus the two template values) — no app update.

### ✅ Share a statement — the customer sees it with no app

1. Open a customer who owes money (e.g. Ramesh, ₹350). Tap **Share statement**.
   - **Expect:** a share sheet (Android) or a copied link (web).
2. Open that link in a browser — ideally a **different device**, signed out, or a private window.
   - **Expect:** the page loads with the customer's name, the shop name, and **₹350.00**.
   - **Expect:** the amount **matches the shopkeeper's app exactly**. If the two ever differ,
     stop and report it — this feature exists to prevent that argument.
   - **Expect:** the **amount due is the first big thing** on the page, in red, with an
     "As on <date/time>" line under it, then the **Pay now · ₹350.00** button and the QR.
   - **Expect:** the entries are folded under **See all entries (N)**. Tap it — the list opens
     with a running balance. This works with no JavaScript (it is a plain HTML fold).
   - **On a customer with a long history (more than 25 entries):** the count in
     **See all entries (N)** is still the **full** number, but the list shows only the **latest
     25**, with a line saying "Showing the latest 25 entries. Download the PDF below for the full
     history." The **balance stays the full one** — only the list is shortened, so the page still
     arrives on 2G. If the balance ever changes because entries are hidden, stop and report it.
3. Check it works on a **cheap/old phone or a slow connection** (throttle to 2G in dev tools).
   - **Expect:** it loads. The page is deliberately plain HTML with no app inside it, because
     Opera Mini / UC Browser in data-saver mode cannot run one.

### ✅ Download the statement PDF

1. On the statement page, tap **Download PDF**.
   - **Expect:** a PDF downloads and opens, showing the same name, balance and entries.
2. Open the statement with `?lang=hi` on the end of the URL, then download the PDF.
   - **Expect:** the PDF is in **Hindi**, and the Hindi text is **readable**.
   - **Expect: NO empty boxes (□□□) anywhere.** If you see boxes where Hindi should be, stop and
     report it — the app is built to refuse rather than print blank amounts on a debt document.

### ✅ Pay by UPI

1. With a balance owing and a valid shop UPI id set, open the statement on a **phone**.
   - **Expect:** a **Pay now** button and a **QR code**.
   - **Expect:** a line saying the money goes straight to the shop.
2. Tap **Pay now**.
   - **Expect:** your UPI app opens with the shop's UPI id and the **exact amount** pre-filled.
   - **Expect:** the amount is in rupees (e.g. `350.00`), never paise.
   - **Do not complete the payment on dev unless using a test VPA.**
3. Scan the QR with any UPI app.
   - **Expect:** the same shop id and amount.

### ✅ Payment setup — owner's QR image (app)

The shopkeeper can add the QR from their own UPI app (a screenshot from PhonePe, GPay, Paytm or
their bank app). It is printed on the **balance card** they share. The web statement page keeps
its own QR, made from the UPI id with the amount already filled in.

1. Profile → **Payment setup** → choose a QR screenshot from the gallery.
   - **Expect:** a preview of the image, and the note "Test it: scan this QR from another phone".
   - **Expect:** a large photo is shrunk automatically and still uploads.
2. Scan the preview from another phone.
   - **Expect:** it opens *your* UPI account. **We cannot check this for you** — a wrong
     screenshot sends customers' money to someone else. That is why the screen tells you to test.
3. On a second device logged in to the same shop, open Payment setup.
   - **Expect:** the same QR image appears there too.
4. Remove the image (or never add one) and open a customer's **Share balance card**.
   - **Expect:** the card has no QR and says "Add your QR in Payment setup" — never a broken image.
5. Type the UPI id and a different spelling in **Type it again**.
   - **Expect:** "Does not match — check the spelling", and Save stays disabled.

### ✅ Share a balance card

1. Customer screen → the **QR** button (or Remind → **Share balance card**).
   - **Expect:** a card with the shop name, "<name> ji, your balance is", the amount, the "as on"
     time and your QR image.
   - **Expect:** Share opens the phone's share sheet with the card as a **picture**.
2. Send it to yourself on WhatsApp and scan the QR from another phone.
   - **Expect:** your UPI app opens to your own account.
3. Turn on Airplane Mode before ever syncing (fresh install/login), then open **Share balance
   card**.
   - **Expect:** the "as on" time is shown with "· not synced yet" — never a time that quietly
     implies the balance is confirmed.
4. Record an entry for this party while still offline, then open **Share balance card** again.
   - **Expect:** "as on" now shows the last successful sync time with "· includes entries not yet
     synced".

### ✅ The shopkeeper records the payment by hand

1. After a customer pays, the shopkeeper records `350` **You got**.
   - **Expect:** balance goes to ₹0.00.
2. Reload the statement link.
   - **Expect:** it now shows **Settled**, and the **Pay now button and QR are gone**.

### ✅ Send a reminder

**Note:** each reminder mints a fresh statement link and **retires the link the previous reminder
made** — the link inside an older reminder message stops working on purpose, so one customer only
ever has one live reminder link. A link you shared with **Share statement** is separate and is not
touched by a reminder.

1. On the customer screen, tap **Send reminder**.
   - **Expect:** WhatsApp (or a share sheet) opens with a message already written.
   - **Expect:** the message names the shop, states the amount, and contains the statement link.
   - **Expect:** it is in the shop's chosen language.
   - **Expect:** you still have to press send yourself — the app must never send it silently.
2. Send it to yourself and tap the link.
   - **Expect:** the statement opens and shows the right balance.
3. Send a **second** reminder to the same customer, then open the link from the **first** one.
   - **Expect:** "This link is no longer valid". The newest reminder's link still works.

### ✅ Revoking a shared link

1. Share a statement, confirm the link works.
2. Revoke that link from the app.
3. Reload the link.
   - **Expect:** "This link is no longer valid", not the customer's balance.

---

## Edge cases

### ✅ No UPI id set

1. Clear the shop's UPI id. Open a statement for a customer who owes money.
   - **Expect:** the statement still loads with the balance and entries.
   - **Expect:** **no** Pay now button and **no** QR — not a broken or dead button.

### ✅ Nothing owed

1. Open a statement for a settled customer.
   - **Expect:** balance ₹0.00 / Settled, and **no** pay option.

### ✅ A customer who has paid more than they owe

1. Record more "You got" than "You gave" for a customer.
   - **Expect:** the statement shows the shop owes **them**, and there is **no** Pay now button.

### ✅ Statement with no entries

1. Add a brand-new customer and share their statement immediately.
   - **Expect:** the page loads and says there are no entries yet. No crash, no blank page.

### ✅ A tampered or guessed link

1. Change a few characters in the middle of a statement URL and open it.
   - **Expect:** "This link is no longer valid". Never someone else's data.

### ✅ A statement link for a customer who is not in this shop's book

Only testable with a tool that can call the API directly (not through the app, which always
picks a customer from the list).

1. `POST /api/v1/parties/party-does-not-exist/statement-link` with a valid login.
   - **Expect:** refused with `NOT_FOUND`. It used to succeed and produce a real-looking page
     reading "Customer ₹0.00", which a customer could easily read as "I owe nothing".
2. Same call for a customer id belonging to a **different** shop.
   - **Expect:** also refused with `NOT_FOUND`.
3. Same for `POST /api/v1/parties/<unknown>/reminders`.
   - **Expect:** refused with `NOT_FOUND`; no reminder is recorded in the history list.

### ✅ Odd characters in a customer name

1. Name a customer `<b>Ramesh</b>` or `Ramesh & Sons`, then open their statement.
   - **Expect:** the name shows **literally**, as typed.
   - **Expect:** no bold text, no broken layout, nothing executing.

### ✅ The statement is a live view, not a snapshot

1. Open a statement link. Leave it open.
2. On the app, add another `100` **You gave**.
3. Reload the statement page.
   - **Expect:** the new entry and the new balance appear.
   - **Expect:** the "As on" time updates.

### ✅ Edited and deleted entries match the app exactly

The statement now reads only this customer's entries (plus their edits and deletes) instead of
the whole shop's book, so a busy shop's link stays fast. The numbers must not change because of it.

1. For customer A: add `1000` **You gave**, edit it to `1100`, edit it again to `1200`, then
   delete it. Add `2000` **You gave** and edit it twice (to `2100`, then `2200`). Add `50`.
2. Add a few entries for customer B too, including one edit and one delete.
3. Share A's statement, download the PDF, and send A a reminder.
   - **Expect:** A's balance is ₹2,250 everywhere — app, page, PDF and reminder text. The
     deleted entry is absent; the twice-edited one shows only its latest amount (₹2,200).
   - **Expect:** nothing of customer B's appears on A's statement, and B's own statement
     matches B's balance in the app.

---

## Known limitations (not bugs)

- **Reminders are manual.** The shopkeeper presses send. Automatic scheduled reminders are v1.1
  and need Meta business verification plus template approval, which take weeks.
- **No automatic payment confirmation.** The shopkeeper records the payment themselves. Real
  reconciliation needs a payment-provider relationship and is a separate v2 decision.
- **PDF is available in English and Hindi only.** Other languages deliberately refuse rather than
  printing blank boxes; their fonts are v1.1.
- **No monthly summary report** yet — per-customer statements only.

## What this needs to ship

`dev` backend deploy with `PUBLIC_BASE_URL` set (this deploy also carries the QR image upload and
the owner name/address fields), plus the Mint Fresh app builds for the Payment setup and balance
card checks. For production the statement **domain must be
chosen and DLT-whitelisted before** it can appear inside an SMS, so that decision gates the
DLT paperwork in `test-credit-auth.md`.
