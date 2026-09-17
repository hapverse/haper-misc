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

### ✅ Share a statement — the customer sees it with no app

1. Open a customer who owes money (e.g. Ramesh, ₹350). Tap **Share statement**.
   - **Expect:** a share sheet (Android) or a copied link (web).
2. Open that link in a browser — ideally a **different device**, signed out, or a private window.
   - **Expect:** the page loads with the customer's name, the shop name, and **₹350.00**.
   - **Expect:** the amount **matches the shopkeeper's app exactly**. If the two ever differ,
     stop and report it — this feature exists to prevent that argument.
   - **Expect:** a list of entries with a running balance.
   - **Expect:** an "As on <date/time>" line.
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

### ✅ The shopkeeper records the payment by hand

1. After a customer pays, the shopkeeper records `350` **You got**.
   - **Expect:** balance goes to ₹0.00.
2. Reload the statement link.
   - **Expect:** it now shows **Settled**, and the **Pay now button and QR are gone**.

### ✅ Send a reminder

1. On the customer screen, tap **Send reminder**.
   - **Expect:** WhatsApp (or a share sheet) opens with a message already written.
   - **Expect:** the message names the shop, states the amount, and contains the statement link.
   - **Expect:** it is in the shop's chosen language.
   - **Expect:** you still have to press send yourself — the app must never send it silently.
2. Send it to yourself and tap the link.
   - **Expect:** the statement opens and shows the right balance.

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

`dev` backend deploy with `PUBLIC_BASE_URL` set. For production the statement **domain must be
chosen and DLT-whitelisted before** it can appear inside an SMS, so that decision gates the
DLT paperwork in `test-credit-auth.md`.
