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

## Android app changes (2026-08-31)

The fix also includes a **Kotlin-side validation bug fix** and a new **UX enhancement**:

- **Error message bug**: The error validator was checking a mis-wired variable, so leaving
  "House / flat / building" blank showed the wrong message `"Street is required"`. The
  backend's Joi schema labels the `street` field as "House / flat / building" (required)
  and `addressLine1` as "Street or road" (optional). Android now correctly validates
  against the right field and shows `"House / flat / building is required"` under the
  House/Flat input field, not under the wrong one.
- **Auto-capitalize enhancement**: The "House / flat / building" field now applies the
  Android keyboard hint `KeyboardCapitalization.Words` to auto-capitalize each word as
  you type (e.g. typing "flat 402, shreeji residency" becomes "Flat 402, Shreeji Residency").
  This is a keyboard-level IME behavior, not a forced text rewrite — behavior may vary
  slightly depending on the device's keyboard app.

## Manual test steps — Android QA

### ✅ Blank "House / flat / building" shows error under the right field
1. User app → Add Address (or edit an existing one).
2. Leave "House / flat / building" blank; fill all other required fields (Full name,
   Phone, Locality, PIN).
3. Save.
4. **Expect:** error dialog displays `"House / flat / building is required"` (not
   `"Street is required"`). The error message appears directly under the House/Flat
   input field, in red text with the ⚠ marker.

### ✅ Blank "Street or road" saves successfully (no error)
1. User app → Add Address (or edit an existing one).
2. Leave "Street or road" blank; fill all other required fields.
3. Save.
4. **Expect:** address saves with no validation error, `addressLine1` stored as `""`.
   The "Street or road" field has NO required star and no validation — it is intentionally
   optional to support legacy addresses saved before the field existed.

### ✅ "House / flat / building" auto-capitalizes each word as typed
1. User app → Add Address.
2. Tap the "House / flat / building" field and type: `flat 402, shreeji residency`
3. **Expect:** as you type, the keyboard automatically capitalizes the first letter of
   each word; the field value reads `Flat 402, Shreeji Residency` (matching standard
   Android capitalize-words keyboard behavior).
4. **Note:** This is a keyboard-level hint (KeyboardCapitalization.Words), so the exact
   behavior depends on the device's IME. Most keyboard apps will capitalize as described;
   some older or custom keyboards may behave differently. This is not a forced app-side
   rewrite — it relies on the keyboard's own capitalization.

### ❌ Other fields unchanged
1. User app → Add Address.
2. Verify that **Full name**, **Locality**, and **Landmark** fields behave exactly as
   before — no new keyboard capitalization or text rewrite applied to them.
3. **Expect:** no changes to these fields' behavior compared to prior builds.

## Deploy
**Android app release required.** The validation error message fix and keyboard capitalization
enhancement are entirely client-side (Kotlin code in `AddEditAddressScreen.kt` and
`ValidationUtils.kt`). A new Android build must be released to ship these fixes to users.

**Backend deploys independently.** The backend change (`.allow("", null).optional()` for
`addressLine1` + `.label()` mappings) deploys with the next `dev` backend deploy
(`dapi.haper.in`). Backend is ready now; app release is the blocker.
