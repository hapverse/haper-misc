# Test: Address nickname / label (Home / Work / custom)

**Area:** User app → Add/Edit Address → "Save as" chips; Address list card shows the label.
**Backend:** `addresses.schema` `label`; `POST/PATCH /user/address` validators (packages/user).
**Apps:** Android + web + iOS (done).

## What it does
Each address can carry an optional nickname: **Home**, **Work**, or **Other** (typed custom
text). It's **nullable** — legacy addresses have none and are untouched. It's **not unique**,
so a user can keep several "Home"/"Work" addresses. It can be **added when editing** an old
address. The stored value is just the string ("Home", "Work", or the custom text).

## Backend — DONE & TESTED (in-memory jest), pushed to dev `dea70bd`
- `packages/shared/models/addresses.schema.js`: `label: { type: String, default: null }`.
  No index (multiple Home/Work allowed). Backward-compatible.
- `packages/user/src/routes/address/validator.js`: add + update accept
  `label: Joi.string().max(30).allow("", null).optional()`. Controllers already pass
  validated fields through `...addData`, so no controller change.
- Tests (`packages/user/__tests__/address.test.js`): save label on add; defaults to null when
  omitted; add a label to a legacy address on edit. User suite **285 green**.

⚠️ **Deploy order:** the app omits `label` when null (Gson drops nulls), so unlabeled saves
work against any backend. But once a user PICKS a label, the app sends it — and a backend
without this validator change **rejects it with 403**. So **deploy the backend (dea70bd)
before shipping/using the labelled app build.**

## Android — DONE (compiled, assembleDebug SUCCESSFUL; NOT device-verified; UNCOMMITTED)
- `AddressModels.kt`: `label` on `AddressModel` + `AddressUpsertRequest` (nullable).
- `AddressViewModel.addAddress/updateAddress`: new `label: String? = null` param.
- `AddEditAddressScreen`: "Save as (optional)" FilterChips **Home / Work / Other**; picking
  **Other** reveals a custom text field (max 30). Tapping the selected chip again clears it.
  Initialised from `address.label` (a custom value maps to the Other chip). `performSave`
  computes the final string and passes `label`.
- `AddressListScreen`: shows the label as a small bold primary line above the name; the
  card's leading icon reflects the label (Home → house, Work → briefcase, else → location
  pin). The per-address action was renamed **"Set Default" → "Deliver Here"**, and on success
  (the address becomes default) it **navigates to Home** to shop that address's store
  (`onDelivered` → Home tab).

### ✅ Deliver Here (address list)
1. On an address that isn't the default, tap **Deliver Here**.
2. **Expect:** the app goes to **Home** and the header resolves that address's store
   ("Delivering to <label> · …"), or the not-serviceable screen if nothing serves it.

## Web — DONE (haper-web, dev `ce0a28a`; tsc clean, vite build OK; NOT browser-verified)
- `types.ts`: `label` on `AddressModel` + `AddressUpsertRequest` (nullable); `Address` gains a
  `label` field (the raw nickname) alongside the existing `type` chip category.
- `services/mappers.ts`: `mapAddressModelToAddress` derives the `type` chip from `label`
  (custom → "Other", unlabeled → "Home") and carries the raw `label`; `mapAddressToRequest`
  sends `label` (trimmed, or null).
- `pages/AddressBook.tsx`: **PIN code is now the first field**; a "Save as (Optional)"
  **Home / Work / Other** chip row (Other reveals a max-30 text input); tapping the selected
  chip again clears it; edit re-derives the chip from the saved label (custom → Other). Cards
  show the label text as the heading and a label-based leading icon (Home → house, Work →
  briefcase, else → pin). The non-default action is now **"Deliver Here"** and navigates to
  **/home** on success (store re-homes). Default card badge is **"Delivering here"** with
  **"Your order will be delivered here"**.
- `pages/Checkout.tsx`: address-select cards use the label-based icon + label text.

## iOS — DONE (haper-ios, dev `8359260`; xcodebuild iphonesimulator BUILD SUCCEEDED; NOT device-verified)
- `Models/AddressModels.swift`: `label` on `AddressModel` (nullable, CodingKey `label`).
- `ViewModels/AddressViewModel.addAddress/updateAddress`: new `label: String? = nil` param;
  sent in the body only when non-empty (so unlabeled saves work against any backend, like
  Android's Gson-drops-null behaviour).
- `Views/AddEditAddressView.swift`: **PIN code is now the first section**; a "Save as
  (optional)" **Home / Work / Other** chip row (`LabelChip`); Other reveals a max-30 text
  field; tapping the selected chip again clears it; edit re-derives the chip from the saved
  label (custom → Other) in `setupForm`; `saveAddress` passes the resolved label.
- `Views/AddressListView.swift`: label shown as a small bold primary line above the name;
  leading icon reflects the label (Home → `house.fill`, Work → `briefcase.fill`, else →
  `mappin.circle.fill`). Non-default action renamed **"Set Default" → "Deliver Here"** and on
  success jumps to the **Home tab** (`homeVM.selectedTab = 0` + dismiss). Default row shows a
  **"Delivering here"** check badge + **"Your order will be delivered here"**.
- `Components/HomeComponents.swift` (`LocationHeaderView`): state-aware header shows
  "Delivering to <label> · <area>" from the default address.

### iOS manual steps (after backend deploy, on a simulator/device)
1. Add Address → PIN field appears first → tap **Work** → fill → Save → **Expect:** card shows
   "Work" with a briefcase icon.
2. Add Address → **Other** → type "Parents" (capped at 30) → Save → **Expect:** card shows
   "Parents" with a pin icon.
3. Edit a legacy (unlabeled) address → tap **Home** → Save → **Expect:** shows "Home".
4. Deselect a chip on a labelled address → Save → **Expect:** label omitted (unchanged/legacy).
5. On a non-default address tap **Deliver Here** → **Expect:** jumps to Home; header shows
   "Delivering to <label> · <area>" (or not-serviceable if nothing serves it); default card
   shows the "Delivering here" badge.

### Web manual steps (after backend deploy)
1. Add Address → PIN code appears first → tap **Work** → fill → Save → **Expect:** card shows
   "Work" with a briefcase icon.
2. Add Address → **Other** → type "Parents" (max 30) → Save → **Expect:** card shows "Parents"
   with a pin icon.
3. Edit a legacy (unlabeled) address → tap **Home** → Save → **Expect:** shows "Home".
4. Deselect a chip on a labelled address → Save → **Expect:** label cleared.
5. On a non-default address tap **Deliver Here** → **Expect:** navigates to Home; header shows
   "Delivering to <label> · <area>" (or not-serviceable if nothing serves it). Default card
   shows the "Delivering here" badge.

## Manual test steps (after backend deploy + new APK)
### ✅ Add with a label
1. Add Address → tap **Work** → fill the form → Save.
2. **Expect:** saves OK; the address list shows "Work" above the name.

### ✅ Custom label
1. Add Address → tap **Other** → type e.g. "Parents" → Save.
2. **Expect:** list shows "Parents".

### ✅ Add a label to a legacy (unlabeled) address on edit
1. Open an existing address with no label → tap **Home** → Save.
2. **Expect:** now shows "Home". (Confirms editable on legacy rows.)

### ✅ Multiple Home / no uniqueness
1. Label two different addresses both **Home** → Save each.
2. **Expect:** both save fine; both show "Home".

### ✅ Clear a label
1. Edit a labelled address → tap its selected chip again (deselect) → Save.
2. **Expect:** label removed (null).

### ✅ Legacy-compatible / unlabeled
- Saving without picking any chip → `label` omitted → works on any backend; card shows no
  label line.

## Rollout
- Backend: safe (nullable field, additive validator) — deploy `dea70bd` to dev (`dapi.haper.in`).
- Android: ship the new debug APK after the backend is live.
- Web: done on dev (`ce0a28a`) — the form sends `label` only when a chip is picked, so it is
  safe against a backend without the validator, but deploy the backend first before users pick
  a label (else 403).
- iOS: done on dev (`8359260`) — like the app builds, it sends `label` only when a chip is
  picked (safe against a backend without the validator; deploy the backend first before users
  pick a label). Build-verified only; not device-verified.
