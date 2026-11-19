# Test: Wallet-only payment that doesn't cover the bill is refused

**Area:** Checkout (user app) → `POST /user/order/place`, "Deliver now" path.
**Backend:** `packages/user/src/routes/order/controller.js` (`assertWalletCoversOrder`, shared with the scheduled path).
**Apps:** none. No Android / iOS / Web change, no app release. Ships on its own (not tied to the retailer online-payment switch).

---

## The problem this fixes

`paymentMethod: "WALLET"` means "the wallet already paid everything". Rider app, admin and cash
reconciliation all treat a WALLET order as fully paid, so nobody collects money for it.

The "Deliver now" path never checked that the wallet really covered the bill. A request like
`{ paymentMethod: "WALLET", redeemWallet: false }` was saved as an OPEN order with a real price
still owed — and that money was never collected.

Example: the cart is Rs 400. The customer has Rs 50 in the wallet (or sends `redeemWallet: false`).
Before: order placed, rider hands over Rs 400 of goods, collects Rs 0.
Now: refused with *"Your wallet balance doesn't fully cover this order. Please choose a payment method for the remaining amount."*

The scheduled path and print checkout already refused this; now the instant path does too.
The apps only send WALLET when their computed payable is 0, so a normal customer never sees this.

## Steps (dev, API client such as Postman)

1. Log in as a test customer, set `x-store-id`, add 2 items (about Rs 400) to the cart.
2. Wallet at 0. `POST /user/order/place` with `{ cartId, addressId, paymentMethod: "WALLET", redeemWallet: false }`.
   - ✅ 400 with the message above.
   - ✅ No new order in My Orders / admin. Item stock unchanged.
3. Give the wallet Rs 50 (less than the bill). Same call with `redeemWallet: true`.
   - ✅ 400, same message. Wallet still Rs 50 (not debited). No "Wallet redeemed" history row.
4. Give the wallet more than the bill. Same call with `redeemWallet: false`.
   - ✅ 400 (the wallet was not used, so the bill is not covered).
5. Same wallet, `redeemWallet: true`.
   - ✅ 200. Order is OPEN, payment method Wallet, price Rs 0. Wallet reduced by the bill. Stock reduced.
6. Regression: COD and Razorpay checkouts, with and without wallet → ❌ no change in behaviour.

## Edge cases / notes

- ❌ A refused request never debits the wallet, never takes stock and releases any coupon hold
  (the check throws inside the checkout transaction, before the wallet debit).
- The server only counts whole coins (`Math.floor`). If a wallet ever holds paise and the app thinks
  it covers the bill (e.g. Rs 399.50 wallet vs Rs 399.50 bill → server counts 399), the customer now
  gets the refusal message instead of an uncollectable order, and picks COD/online for the remainder.

## Automated tests

`packages/user/__tests__/order-wallet-remainder.test.js` (empty wallet, unredeemed wallet,
partial wallet → 400 with nothing written; full wallet → placed). Scheduled path stays covered by
`scheduled-booking.test.js`.
