# Test: Address form validation — blank "Street or road" + human-readable errors

**Area:** User app → Add/Edit Address screen
**Backend:** `POST /user/address` (add) and `PATCH /user/address?addId=...` (update)
**Validator:** `packages/user/src/routes/address/validator.js`

## The bug that was fixed (2026-08-30)

`addressLine1` (labelled "Street or road" on Android) is intentionally optional and
free-text on the client, with NO star and no client-side validation — legacy addresses
have it blank and editing them must not become impossible. Android's request model
sends it as a non-nullable `String`, so it is ALWAYS sent in the JSON body, as `""`
when the user leaves it blank.

The backend Joi schema had `addressLine1: Joi.string().optional()`. `.optional()` only
allows the *key* to be absent — it does not allow an *empty string* when the key is
present. So Joi rejected `""` with `"addressLine1" is not allowed to be empty`, and
that raw Joi message was shown verbatim in the app's error dialog (backend has no
field-name-to-label mapping; `AddressViewModel.kt` just decodes the message as-is).

**Fix:**
1. `addressLine1` now uses `.allow("", null).optional()` (same pattern already used by
   `village`), in both the `addAddress` schema and the `updateAddress` body schema.
2. Every field in those two schemas now has a Joi `.label("...")` matching the
   Android UI's own field labels, so any future Joi validation error reads e.g.
   `"Full name" is not allowed to be empty` instead of `"name" is not allowed to be empty`.

## Manual test steps

### ✅ Blank "Street or road" saves successfully
1. User app → Add Address (or edit an existing one).
2. Fill all fields except "Street or road" — leave it blank.
3. Save.
4. **Expect:** address saves with no error, `addressLine1` stored as `""`.

### ❌ Blank "Full name" shows a human-readable error
1. User app → Add Address.
2. Leave "Full name" blank, fill everything else.
3. Save.
4. **Expect:** error dialog reads `"Full name" is not allowed to be empty` (not
   `"name" is not allowed to be empty`).

## Automated coverage
`packages/user/__tests__/address.test.js` (or nearest address suite) should cover:
- `addAddress`/`updateAddress` accept `addressLine1: ""`.
- Missing required field (e.g. `name`) returns the human label in the error message.
Run: `cd packages/user && NODE_ENV=test npx jest`

## Deploy
Backend-only change → deploys with the next `dev` backend deploy (`dapi.haper.in`).
No app release required (Android already sends `""` today; this just makes the
backend accept it).
