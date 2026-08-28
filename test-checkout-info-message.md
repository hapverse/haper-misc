# Test: Checkout info message — admin-configurable banner on checkout

**Area:** Store configuration (admin) and checkout funnel (web, Android, iOS)  
**Backend:** `stores.config.checkoutMessage` (string, nullable, max 200 chars, trimmed)  
**Admin UI:** "Checkout message" textarea on the Store Controls card at `/config`  
**Platform coverage:** web, Android, iOS (all ship with banner rendering)  
**Permission (admin):** `STORE_CONFIG.EDIT` (same permission that already guards store config)

---

## 🚨 CRITICAL DEPLOY ORDERING

**Backend MUST be deployed BEFORE haper-admin.** Do not skip or reorder.

**Why:** The admin frontend now always sends `checkoutMessage` in its Store Controls save payload — even when unchanged. If the admin frontend deploys before the backend's Joi validator accepts the field, every single Store Controls save (including unrelated operations like updating minimum order value or delivery fee) will fail with HTTP 400 "unknown field", because the backend rejects unknown keys.

**Correct order:**
1. Deploy **haper-backend** first (adds `checkoutMessage` to the store config schema).
2. Deploy **haper-admin** second (starts sending `checkoutMessage` in all config saves).
3. Deploy **haper-web, haper-android, haper-ios** (in any order — these only read the field from checkout).

**If deployed in wrong order:** the admin will be unable to save any store settings; users will see a persistent 400 error toast. To recover: revert the admin deploy and re-deploy backend first.

---

## What this is (the real flow)

A store admin (or super admin with `STORE_CONFIG.EDIT`) can set a free-text **checkout info message** for their store — for example, *"Any order placed after 8:30 pm will be delivered by tomorrow"* or *"Minimum order value includes delivery fee."* The message is **optional and per-store**.

When a customer reaches checkout on web, Android, or iOS for that store, a **blue informational banner** appears at the top of the payment/address summary with the exact text. The banner:
- Wraps fully (never truncates or overflows).
- Only appears if a message is set (no empty space or placeholder when unset).
- Stacks cleanly below other banners (e.g., gift-with-purchase nudge on web, minimum-order banner on mobile).
- Never overlaps the "Place Order" button or other interactive elements.
- Is rendered as **plain text only** — no HTML, Markdown, or rich formatting (e.g., `<b>bold</b>` shows literally as that text, not as bold).

---

## Prerequisites

1. **Access to admin panel** for the store you'll test (`/config` page).
2. **`STORE_CONFIG.EDIT` permission** for that store (store admin or super admin).
3. **Test store in dev environment** where you can configure checkout messages and place test orders.
4. **Builds of web/Android/iOS** that include the checkout banner rendering code.

---

## ✅ Happy path — admin panel

### ✅ A. Store admin sets a checkout message

1. **Log in to admin panel** as a store admin or super admin with `STORE_CONFIG.EDIT`.
2. **Navigate to `/config`** (Store Controls page).
3. **Locate the "Checkout message" section:**
   - You should see a **textarea** field labeled "Checkout message" or similar (may be under a "Store Settings" card).
   - Below the textarea is a **character counter** showing "X / 200" (e.g., "0 / 200" when empty).
4. **Type a message:** enter text like *"Orders placed after 8:30 pm deliver tomorrow"* (30 characters).
   - ✅ **Expect:** the counter updates to show "30 / 200".
   - ✅ **Expect:** the character counter is **blue/normal** (not highlighted).
5. **Click "Save" (or similar)** on the Store Controls card.
   - ✅ **Expect:** a success toast appears (e.g., "Store settings updated").
   - ✅ **Expect:** the page remains on `/config`.
6. **Reload the page** (Cmd+R or F5).
   - ✅ **Expect:** the textarea still shows your message exactly as you typed it.
   - ✅ **Expect:** the counter still shows "30 / 200".

### ✅ B. Character counter turns amber at 120+ characters (visual warning)

1. **Start on `/config` with the Checkout message textarea visible.**
2. **Type text until you reach 120 characters** (or paste text 120+ chars).
   - ✅ **Expect:** the character counter turns **amber/orange** at 120+ (visual hint: "you're using a lot of space").
3. **Type a few more characters to reach 145 characters.**
   - ✅ **Expect:** counter still shows "145 / 200" in amber.
4. **Add text to reach 200 characters (the hard limit).**
   - ✅ **Expect:** counter shows "200 / 200" in amber.
   - ✅ **Expect:** you can **no longer type** — the textarea **does not accept more characters**.
5. **Delete a few characters to go back to 150 characters.**
   - ✅ **Expect:** counter shows "150 / 200", still amber (since 150 > 120).

### ✅ C. Character limit prevents typing past 200

1. **Start with the textarea empty or with existing text.**
2. **Paste or type text longer than 200 characters** (e.g., copy a 300-character Lorem Ipsum block and paste).
   - ✅ **Expect:** the textarea **silently truncates** or **refuses to accept characters past 200**. The final text is exactly 200 characters, and the counter shows "200 / 200".
   - ✅ **Expect:** **no error message** (this is client-side enforcement only; backend validates on save).

---

## ✅ Happy path — each client (web, Android, iOS)

### ✅ D. Web: banner renders on Checkout page

1. **In the admin panel, set a checkout message** for a test store (e.g., *"Free delivery on orders over 500"*).
2. **On web, navigate to a checkout page** for that store (after adding items to cart).
3. **Locate the checkout summary** (address, payment, order summary).
   - ✅ **Expect:** a **blue informational banner** appears **above** the payment section or address, containing the exact text: *"Free delivery on orders over 500"*.
   - ✅ **Expect:** the banner has an **info icon** (i-in-circle) or similar visual indicator of informational content.
   - ✅ **Expect:** the text **wraps fully** — if the message is long (e.g., 150+ characters), it breaks into multiple lines and does **not truncate** or show ellipsis.
   - ✅ **Expect:** the banner **does not overlap** the "Place Order" button or other interactive elements.
4. **Place an order** (complete checkout).
   - ✅ **Expect:** checkout succeeds without the banner interfering.

### ✅ E. Android: banner renders on CheckoutScreen

1. **In the admin panel, set a checkout message** for a test store.
2. **On Android, navigate to CheckoutScreen** (tap checkout or similar in the app).
3. **Locate the checkout summary** (address, payment info, order summary).
   - ✅ **Expect:** a **blue informational banner** appears **below** the address section (or below any existing minimum-order banner if present).
   - ✅ **Expect:** the banner uses the **Info-icon style** (same visual family as the minimum-order banner).
   - ✅ **Expect:** the text **wraps fully** — long messages break into multiple lines.
   - ✅ **Expect:** the banner **does not overlap** the "Place Order" button or other controls.
4. **Tap "Place Order"** to complete checkout.
   - ✅ **Expect:** order succeeds; the banner is informational only and does not block the flow.

### ✅ F. iOS: banner renders on checkout screen

1. **In the admin panel, set a checkout message** for a test store.
2. **On iOS, navigate to the checkout flow** (tap checkout or similar in the app).
3. **Locate the checkout summary** (address, payment info, order summary).
   - ✅ **Expect:** a **blue informational banner** appears (same positioning and style as Android).
   - ✅ **Expect:** the text **wraps fully** — no truncation or ellipsis on long messages.
   - ✅ **Expect:** the banner **does not overlap** the "Place Order" button.
4. **Tap "Place Order"** to complete checkout.
   - ✅ **Expect:** order succeeds.

---

## ✅ Clearing the message

### ✅ G. Admin clears the message; banner disappears on all clients

1. **In the admin panel, navigate to `/config`** for the store where you set a message in step A.
2. **Select all text in the "Checkout message" textarea** (Cmd+A or Ctrl+A) and delete it.
   - ✅ **Expect:** the textarea is now empty.
   - ✅ **Expect:** the character counter shows "0 / 200" and turns **blue** (no longer amber).
3. **Click "Save"** on the Store Controls card.
   - ✅ **Expect:** a success toast appears.
4. **Reload the admin page.**
   - ✅ **Expect:** the textarea is still empty.
5. **On web/Android/iOS, navigate back to checkout for the same store** (add items to cart if needed).
   - ✅ **Expect:** the checkout info banner is **completely gone** — no empty box, no whitespace, no placeholder.
   - ✅ **Expect:** checkout renders exactly as it did before the message was set.

---

## ✅ Unset / never-configured store

### ✅ H. Store with no message set shows no banner anywhere

1. **Create or select a test store that has never had a checkout message configured.**
2. **Verify in the admin panel** (`/config` for that store): the Checkout message textarea is **empty**.
3. **On web/Android/iOS, place an order for that store.**
   - ✅ **Expect:** **no checkout info banner appears** anywhere on the checkout flow.
   - ✅ **Expect:** **no error, no crash, no blank space** — the checkout page looks exactly as it would with no message configured.
4. **In the admin panel, visit the store's `/config` page again.**
   - ✅ **Expect:** the Checkout message field is **empty** (not set to a default, not showing null or undefined).

---

## ✅ Stacking with other banners

### ✅ I. Android/iOS: checkout message stacks below minimum-order banner

1. **In the admin panel, configure a test store with:**
   - A **low minimum order value** (e.g., 50 Rs) — so a typical cart will fall below it.
   - A **checkout message** (e.g., *"Orders over 500 Rs get free delivery"*).
2. **On Android or iOS, add items to cart with a subtotal below the minimum** (e.g., 30 Rs subtotal).
3. **Navigate to checkout.**
   - ✅ **Expect:** two banners appear, stacked vertically:
     - **First (top):** the existing **minimum-order banner** (blue, showing the threshold, e.g., "Minimum order 50 Rs").
     - **Second (below):** the **checkout message banner** (blue, showing your message).
   - ✅ **Expect:** a **small gap** (padding/spacing) between the two banners — they don't touch.
   - ✅ **Expect:** both banners **wrap fully** if text is long.
   - ✅ **Expect:** neither overlaps the other or the "Place Order" button.
4. **Repeat for a cart above the minimum order value.**
   - ✅ **Expect:** the minimum-order banner **disappears** (minimum is met), but the checkout message banner **remains**.

### ✅ J. Web: checkout message stacks below gift-with-purchase nudge (if present)

1. **In the admin panel, configure a test store with:**
   - **Free gift with purchase** enabled (with a tier at 100 Rs).
   - A **checkout message** (e.g., *"Gifts available on orders over 100 Rs"*).
2. **On web, add items to cart with a subtotal of at least 100 Rs** (so the gift offer unlocks).
3. **Navigate to checkout.**
   - ✅ **Expect:** two banners appear, stacked:
     - **First (top):** the existing **gift-with-purchase nudge** (e.g., "You've unlocked a free gift!").
     - **Second (below):** the **checkout message banner**.
   - ✅ **Expect:** clean spacing between both, **no overlap**.
   - ✅ **Expect:** both wrap fully if text is long.
4. **Reload checkout with items below 100 Rs.**
   - ✅ **Expect:** the gift nudge disappears (cart below threshold), but the checkout message banner **remains**.

---

## ❌ Edge cases and negative scenarios

### ❌ K. Text longer than 200 characters cannot be typed in admin textarea

1. **On `/config`, click in the Checkout message textarea.**
2. **Try to paste or type text longer than 200 characters** (e.g., a Lorem Ipsum paragraph with 300+ chars).
   - ✅ **Expect:** the textarea **silently caps at 200 characters** — no additional characters are accepted.
   - ✅ **Expect:** **no error message or alert** (client-side limit is silent).
3. **Verify the character counter shows "200 / 200".**
   - ✅ **Expect:** counter confirms the 200-character limit is active.

### ❌ L. HTML/rich-text is rendered literally, never as formatted content

1. **On `/config`, type or paste HTML in the Checkout message textarea:**
   - Example: `<b>Special Offer!</b>` or `<script>alert("test")</script>`.
2. **Click "Save".**
   - ✅ **Expect:** save succeeds (text is accepted as-is).
3. **On web/Android/iOS, navigate to checkout.**
   - ✅ **Expect:** the banner displays the text **literally** — you see the exact string `<b>Special Offer!</b>`, not bold text.
   - ✅ **Expect:** **no HTML rendering, no script execution** — the text is plain-text only.
   - ✅ **Expect:** angle brackets `<` and `>` are visible in the banner, proving literal rendering.

### ❌ M. Whitespace-only message (spaces, tabs, newlines) behaves as if empty

1. **On `/config`, click in the Checkout message textarea.**
2. **Type or paste only whitespace:**
   - Example: `"   "` (three spaces) or `"\n\n"` (two newlines) or a mix of tabs and spaces.
3. **Click "Save".**
   - ✅ **Expect:** save succeeds (whitespace is accepted).
4. **Reload the admin page.**
   - **Possible behavior A (trimmed on save):** the textarea is now **empty** after reload (backend or admin FE trimmed it).
   - **Possible behavior B (trimmed on read):** the textarea shows whitespace, but on clients it is not displayed.
5. **On web/Android/iOS, navigate to checkout for that store.**
   - ✅ **Expect:** **no banner appears** (the whitespace-only message is treated as absent/empty).
   - ✅ **Expect:** **no error, no empty box** — checkout looks the same as if no message is set.

> **Rationale:** whitespace-only is treated as "no message" to prevent accidental empty-looking banners.

### ❌ N. Multi-line messages with actual content render cleanly

1. **On `/config`, type a message with newlines:**
   - Example: `"Line 1 of message\nLine 2 of message"` (simulating a multi-line paste).
2. **Click "Save".**
3. **On web/Android/iOS, navigate to checkout.**
   - ✅ **Expect:** the banner displays the text with newlines preserved (or as a wrapped single block, depending on implementation).
   - ✅ **Expect:** text is **readable and wraps cleanly** — no overlap or truncation.

---

## Deploy and rollout

### Current status (uncommitted)

This feature is **completely built** across all five repos but **not yet committed**:

| Repo | Component | Status |
|---|---|---|
| haper-backend | Store config schema + `GET /user/cart` response | Reviewed, APPROVED |
| haper-admin | Checkout message textarea + character counter + save payload | Reviewed, APPROVED |
| haper-web | Blue info banner on Checkout page | Reviewed, APPROVED |
| haper-android | Blue info banner on CheckoutScreen | Reviewed, APPROVED |
| haper-ios | Blue info banner on checkout screen | Reviewed, APPROVED |

### Deploy procedure (once committed)

**Step 1: Deploy haper-backend** (MUST be first)
- Ensure the Joi schema in the store config validator includes `checkoutMessage` (string, max 200, nullable).
- Deploy to dev as usual (`git push origin dev` triggers CI → deploy).
- Verify the `PUT /admin/config/store` endpoint accepts the field and `GET /user/cart` returns it.

**Step 2: Deploy haper-admin**
- Verify the Store Controls form sends `checkoutMessage` in every save.
- Deploy to dev.
- Test on `/config` — store settings saves should now work (after backend is live).

**Step 3: Deploy haper-web, haper-android, haper-ios** (in any order)
- Each repo's CI/CD deploys automatically on `git push origin dev`.
- Verify checkout pages render the banner.

### Rollback

If a deploy causes issues:
- **Admin can't save settings → Backend wasn't deployed first.** Revert admin, deploy backend, re-deploy admin.
- **Banner not showing on clients → check that each client was deployed and built.** Redeploy clients.
- **Banner showing empty → check for whitespace-only messages; admin should trim or backend should validate.** Clear the message in admin.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Admin page shows 400 error every time I save store settings (including unrelated fields) | Backend not deployed yet. The admin is sending `checkoutMessage` but backend Joi schema doesn't accept it. | Deploy backend first, then re-deploy admin. |
| Checkout message textarea is not visible on `/config` | Admin FE not deployed or the code is not in the current build. | Redeploy haper-admin. |
| Character counter does not limit at 200; I can type more | Client-side limit not in place or outdated build. | Clear browser cache, rebuild admin, redeploy. |
| Checkout message banner never appears on web/Android/iOS even though I set it in admin | Clients not deployed yet, or the build is stale. | Verify each client was deployed; rebuild and redeploy if needed. For iOS, the user must manually trigger build/TestFlight as per project convention. |
| Banner renders with HTML tags visible (e.g., `<b>text</b>` shows as-is) | Working as designed. Plain-text rendering is intentional. | No action needed; this is the expected behavior. |
| Whitespace-only message shows as an empty box on checkout | Implementation detail — whitespace should be trimmed. Check if admin FE or backend is trimming; if not, clear the message. | In admin, select the field and delete it entirely; save. Verify banner disappears on clients. |
| "Place Order" button is hidden or overlapped by the banner | Layout issue in a specific client. | Check that the banner uses `position: relative` (not `absolute`), has appropriate margin/padding, and doesn't break the flexbox/grid layout. Redeploy with a layout fix. |

---

## Notes for dev/QA

- **All five repos must be deployed in the correct order** — backend before admin. This ordering is critical and not forgiving.
- **Character limit is 200** — visual warning (amber) at 120+, hard stop at 200. Both are implemented client-side on admin; backend also validates on save.
- **Plain text only** — no HTML, Markdown, or rich formatting. This is intentional and secure.
- **Whitespace-only messages are treated as empty** — no error, no blank box, no placeholder. This is safe UX design.
- **Stacking:** the banner is positioned to stack cleanly below other informational banners on mobile (minimum-order) and web (gift nudge). Test both stacking scenarios (section ✅ I–J) to ensure no overlap.
- **iOS manual build:** iOS builds must be manually triggered by the user per the project convention (no CI auto-build to TestFlight). Ensure the build is issued once haper-ios is committed and pushed to dev.
