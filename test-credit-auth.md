# Test: haper-credit — phone + OTP login, sessions and devices

**Area:** haper-credit Android + iOS + web (login screen, and every authenticated screen).
**Backend:** `haper-credit/apps/backend/src/auth`.
**Apps:** Android, iOS, Web.
**Needs:** `dev` backend with the SMS gateway configured. **DLT is done** — haper-credit reuses
the Haper fleet's existing registration (sender `iHaper`, same entity and OTP template), so a real
SMS is sent. If the gateway is not configured on that environment **and** the server has the "show OTP"
switch (`OTP_ECHO=true`) turned on, the OTP appears on screen instead. That switch is off unless
someone deliberately turns it on, and is never on in production.

## Running against a local backend (no dev deploy needed)

For testing on a laptop with the Android emulator:

1. `cd haper-credit/apps/backend && pnpm dev:local` — starts the API on port **4010** with a
   throwaway in-memory database. Everything is wiped when you stop it.
2. Install a **debug** build on the emulator. It talks to your laptop at `http://10.0.2.2:4010`
   automatically (`10.0.2.2` is how the emulator says "the laptop I'm running on").
   - On a **real phone**, a debug build cannot reach that address. Build with
     `./gradlew assembleDebug -PlocalApi=https://dapi.haper.in` to use the dev server instead.
3. Sanity check: open `http://localhost:4010/api/v1/health`.
   - **Expect:** `"database": { "name": "haper-credit-dev", "readOnly": false, ... }`.
   - If `readOnly` is `true`, `readOnlyReason` says why (`forced` = someone set `DB_READONLY`,
     `foreign-database` = pointed at another service's database). Logins will fail in that state.

Unless your local `.env` sets the SMS gateway key, no SMS is sent and the code appears on screen
as "dev code" instead (`pnpm dev:local` turns the `OTP_ECHO` switch on for you).

## What this covers

Signing in with nothing but a mobile number. No forms, no documents, no password. The first
login for a number **creates that shopkeeper's book**; every later login opens the same one.

---

## Manual test steps

### ✅ First login creates the book

1. Open the app. Enter a number that has never been used, in the form `+919876543210`.
2. Tap **Continue**.
   - **Expect:** the screen moves to the code step.
   - **Expect:** a real SMS arrives from sender **iHaper** within a few seconds.
   - **Expect:** the text reads "Your OTP for logging into your **HAPER** account is …". It says
     HAPER, not Haper Credit, because it reuses the fleet's registered DLT template — see
     "Known limitations".
   - **If the gateway is unconfigured on this environment:** a "dev code: …" line appears on
     screen instead (only if `OTP_ECHO=true` on that server). Use that. No SMS and no dev code
     means the switch is off — ask for it to be turned on.
3. Enter the 6-digit code → **Verify**.
   - **Expect:** you land on the home screen.
   - **Expect:** the book is empty — *You will get* ₹0.00, no customers.
   - **Expect:** you were never asked for a name, shop name, email or document.

### ✅ Logging in again returns the SAME book

1. Add a customer and an entry. Note the balance.
2. Log out (or reinstall) and log in with the **same number**.
   - **Expect:** the same customer and the same balance come back.
   - **Expect:** no duplicate book, no empty book.

### ✅ A different number gets a different book

1. Log in with a second, unused number.
   - **Expect:** an empty book — none of the first shopkeeper's customers are visible.
   - **This is the most important isolation check in the app.** If you can see another
     shopkeeper's customers, stop and report it immediately.

### ✅ Wrong code is refused

1. Request an OTP, then enter `000000`.
   - **Expect:** a clear message in your app language ("That code is not right. Try again.").
   - **Expect:** you stay on the code screen; you are NOT logged in.
   - **Expect:** the message is in plain language, never a technical error or English-only string
     when the app is in Hindi.

### ✅ Too many wrong tries burns the code

1. Request an OTP. Enter a wrong code **5 times**.
2. Now enter the **correct** code.
   - **Expect:** it is **rejected** — "Too many tries. Ask for a new code."
   - **Expect:** requesting a fresh OTP works normally.

### ✅ Fast repeated guesses also lock the code

1. Request an OTP. Enter 5 wrong codes as quickly as you can, one after another without waiting (or tap **Verify** on the code screen from two browser tabs at the same time).
   - **Expect:** after 5 attempts, the code locks — "Too many tries. Ask for a new code."
   - **Expect:** it is not possible to slip in a 6th guess by going very fast.

### ✅ A code can only be used once

1. Request an OTP and log in successfully on device A.
2. On device B, try to log in using the **same** code.
   - **Expect:** rejected. Device B must request its own code.

### ✅ Two devices on one shop

1. Log in on Android and on web with the **same number**.
   - **Expect:** both work at the same time. Logging in on the second does **not** sign the first out.
   - **Expect:** both show the same customers and balances.
2. Add an entry on one.
   - **Expect:** it appears on the other (see `test-credit-offline-sync.md`).

### ✅ Signing out on one device does not affect the other

1. With two devices logged in, sign out of device A.
   - **Expect:** device A returns to the login screen.
   - **Expect:** device B **keeps working** — it can still add entries and sync.
2. On device A, log in again.
   - **Expect:** the book and balances are intact.

### ✅ Logging out wipes this device — and warns first if anything is unsent

Logging out removes this shop's data **from this device only** (it stays safe on the server), so
the next person to log in on the same phone or browser never sees it.

1. Online, with everything synced ("All saved"): Profile → **Log out**.
   - **Expect:** a plain "are you sure" question, then the login screen.
   - Log back in with the **same** number. **Expect:** all customers and balances come back.
2. Go offline, add an entry, then Profile → **Log out**.
   - **Expect:** "1 entries are not synced yet and will be lost", with **Sync now** and
     **Log out anyway**.
   - Tap **Sync now** while still offline. **Expect:** you stay logged in; the entry is kept.
   - Go online, **Sync now** again. **Expect:** it syncs, then logs out normally.
3. Web with **two tabs** open: log out in one.
   - **Expect:** the other tab also goes to the login screen within a moment.

### ✅ A different shop logs in on the same device

1. On phone 1 logged in as shop A, go offline and add an entry. From phone 2 (also shop A),
   Profile → Devices → remove phone 1. Bring phone 1 online — it shows the login screen, with
   shop A's data still on it. Now log in on phone 1 with **shop B's** number.
   - **Expect:** "1 unsynced entries from the previous shop will be deleted" before anything
     is shown. **Cancel** leaves shop A's data untouched and you are not logged in.
   - **Continue** → you see **only shop B's** customers. **Never** shop A's.
2. **This is a money-safety check.** If shop B ever sees shop A's customers, or shop A's
   entry appears in shop B's book on another device, stop and report it immediately.

### ✅ "Please sign in again. Your entries are safe."

If the server stops accepting this device (e.g. it was removed from **Devices** on another
phone), the app must not lose anything.

1. On phone 1, go offline and add an entry. On phone 2 (same shop), Profile → Devices → remove
   phone 1.
2. Bring phone 1 online.
   - **Expect:** the login screen with "Please sign in again. Your entries are safe."
   - **Expect:** nothing was deleted.
3. Log in on phone 1 with the **same** number.
   - **Expect:** the entry from step 1 syncs and appears on phone 2.
4. Turning Wi-Fi off and on, or a slow network, must **never** cause this message — only a
   real rejection from the server does.

### ✅ Local entries survive a signed-out state

1. On a logged-in device, go offline and add two entries.
2. Sign out while still offline (if the UI allows), or let the session expire.
   - **Expect:** the app shows "Please sign in again. Your entries are safe."
   - **Expect:** the entries are **not** deleted.
3. Sign back in with the same number.
   - **Expect:** the queued entries sync up and appear on the other device.

### ✅ Android: login actually completes (regression)

Earlier Android builds rejected **every** login with a "validation failed" error, because one
field the server needs (which platform the phone is) was silently left out of the request.

1. On Android, request an OTP and enter the correct code.
   - **Expect:** you land on the home screen. No "validation failed" or generic error.
2. On a local backend, check that the **dev code** line appears on screen right after
   **Continue** — earlier builds received it but never showed it.

### ✅ Android: a failed OTP request stays on the number step (regression)

1. On Android, go offline (or stop the local backend) and tap **Continue**.
   - **Expect:** an error message, and you **stay on the phone-number step**.
   - **Expect:** you are **not** moved to the code step. Earlier builds moved you there anyway,
     leaving you typing a code that could never work.

### ✅ Android: screen fits below the status bar

1. Open the login, home and customer screens.
   - **Expect:** titles sit below the clock/battery bar, never underneath or overlapping it.

### ✅ New login look (Mint Fresh)

1. Open the app signed out.
   - **Expect:** a green panel at the top with three short benefits (works without internet,
     share bills, data stays private), and the mobile-number field below it with **Continue**.
2. Tap **Continue** with a valid number.
   - **Expect:** the code screen says "Reading the code for you…".
   - **Expect (Android / iPhone):** when the SMS arrives the keyboard offers the code — tap it
     and all six boxes fill. On web in Chrome/Safari the browser may offer it the same way.
   - **Expect:** a resend timer, and **Use a different number** goes back to the first screen.

### ✅ Profile shows your number, devices and language

1. Open **Profile** (bottom bar).
   - **Expect:** a green card with your shop name and **your login number**.
   - **Expect:** on a second phone logged in to the same shop, the same number shows (it comes
     from the server, not from what that phone remembers).
2. Profile → **Devices**.
   - **Expect:** every logged-in phone/browser with a "last seen" like "2 min ago".
   - Remove one. **Expect:** that device is logged out the next time it syncs; this one is not.
3. Profile → **Language** → हिन्दी.
   - **Expect:** the app switches to Hindi, including the home list lines ("₹650 दिए · आज").

### ✅ Phone number format

1. Try `9876543210` (no country code).
   - **Expect:** rejected with a clear message; no OTP is sent.
2. Try `+919876543210`.
   - **Expect:** accepted.

---

## Edge cases

### ✅ Request several OTPs in a row — the throttle

Every SMS is billed, so the request endpoint is throttled. Limits match the rest of the fleet.

1. Request an OTP, then immediately tap **Continue** again.
   - **Expect:** refused, with a message asking you to wait (about 2 minutes).
   - **Expect:** no second SMS arrives.
2. Wait 2 minutes and request again.
   - **Expect:** a new SMS arrives and the newest code works.
3. Request a third time within the same 15 minutes.
   - **Expect:** refused until the window passes.
4. On a **different** number, request an OTP immediately.
   - **Expect:** it works. The throttle is per number, never global — one shopkeeper must not
     be able to lock out another.

**Known UX cost:** a shopkeeper signing in on a second device within 2 minutes of the first is
asked to wait. That is deliberate (each SMS costs money) but it is a real tradeoff, and worth
raising if testers find it painful in practice.

### ✅ Let the code expire

1. Request an OTP and wait **more than 5 minutes**, then enter it.
   - **Expect:** "That code has expired. Ask for a new one." — not a generic failure.

### ✅ Airplane mode at the login screen

1. Go offline and tap **Continue**.
   - **Expect:** a clear "no internet" message, not a spinner that hangs forever.
   - **Expect:** no crash.

### ✅ Long-running session

1. Stay logged in and use the app over several days (or have the backend shorten the token TTL on dev).
   - **Expect:** the app keeps working without asking you to log in again.
   - **Expect:** you are never shown a raw "401" or "token expired" string.

---

## Known limitations (not bugs)

- **The SMS says "HAPER account", not "Haper Credit".** DLT only delivers a message whose text
  matches the registered template exactly, and haper-credit reuses the fleet's existing OTP
  template rather than waiting days for its own. Rewording it needs a **new template
  registration**, not a code change. Raise it if the wording confuses shopkeepers.
- **No "change my number"** flow yet.
- **No staff / multi-user per shop** — one phone number is one shop, and anyone logging in with
  that number has full access.

## What this needs to ship

`dev` backend deploy with the SMS gateway env set (same API key as haper-backend; sender, entity
and template ids are in `.env.example`). **No new DLT registration needed** — the fleet's existing
one is reused.

Note the statement link does **not** need DLT clearance in v1: reminders are sent by the
shopkeeper from their own phone via WhatsApp or their SMS app, which is person-to-person, not
bulk A2P messaging. A domain whitelist and a new template are only needed if server-sent
reminders ship in v1.1.
