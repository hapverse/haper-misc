# Admin push notifications — Test Guide

Covers the **admin app/panel FCM push** (channel `admin_alerts`, data type `ADMIN_ALERT`) that
tells store staff about events on their store. Against **dev** (`damin.haper.in` / `dapi.haper.in`).
Each step says **what to do** and **what to expect** (✅ good / ❌ should NOT happen).

> Companion to `test-order-status.md` (which is about the **customer's** delivered/status push).
> This one is about the push that goes to **admins**, not customers.

---

## What sends an admin push

Every admin push goes through one function — `sendAdminStoreNotification(storeId, …)` in
`packages/shared/utils/notification.utils.js`. Callers:

- **New order placed** → `user/src/routes/order/controller.js`
- **Payment success** → `user/src/routes/razorpay/controller.js`
- **Pick-task / short-count events** → `picking/src/routes/task/controller.js`
- **Rider rejects an order** → `delivery/src/routes/order/controller.js`
- **Inventory red-stock alert / resolved / daily digest** → `shared/utils/inventory-notification.utils.js`

Recipients are resolved by the query inside that one function, so the rule below applies to **all**
of these at once.

## The rule (current)

**Super admin should NOT receive any admin push, for now.** New order, order-status change,
pick/short events, rider rejection, inventory alerts — none of them go to a super admin.

- Implemented at the recipient query: only **active, store-scoped** admins of that store are
  matched, and `roles: { $ne: super_admin }` drops anyone whose roles include `super_admin`.
- Store admins / managers / support of the store still get the push as before.
- To restore super-admin push later: add `{ roles: super_admin, status: 1 }` back as an `$or`
  branch in `sendAdminStoreNotification` (a comment in the file marks the exact spot).

---

## 0. Prerequisites

- Backend on **dev**, deployed with this change (shared package).
- One **store admin** account for the test store, logged into the admin panel with a browser/app
  that has **push enabled** → an FCM token registered (Sidebar shows it after allowing
  notifications). Registration endpoint: `POST /admin/me/fcm-token`.
- One **super admin** account, also logged in with **push enabled** (FCM token registered).
- A test customer who can place a COD order on that store.

---

## 1. Store admin still gets the new-order push  (happy path)

1. As the **store admin**, make sure notifications are allowed (FCM token registered).
2. Customer places a new COD order on that store.
   ✅ The **store admin** receives a "new order" push (channel `admin_alerts`).

## 2. Super admin gets NO push  (the fix)

1. As the **super admin**, allow notifications (FCM token registered) — same as step 1.
2. Customer places a new COD order (or change an order's status / trigger a pick-short / rider
   rejection / inventory red-stock alert).
   ❌ The **super admin** receives **no** push for any of these.
   ✅ Store-scoped admins of that store still receive theirs (unchanged).

## 3. Edge — super admin who also has a storeId

Even if a super_admin document somehow also has a `storeId`, the `roles: { $ne: super_admin }`
guard still excludes them.
   ❌ Still no push to the super admin.

---

## Notes / what to deploy

- **Deploy:** backend **dev** (shared package). No app/admin-frontend change needed — this is a
  backend recipient-list change only.
- **Not affected by this change:** the customer "Delivered / status" push (`test-order-status.md`),
  the admin **email** recipients for inventory alerts, and the admin web **live order feed** (SSE) —
  those are separate channels. Only the FCM push audience changed.
