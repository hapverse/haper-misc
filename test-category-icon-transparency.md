# Test: category icon keeps its transparent background

**Area:** Admin → Categories → create / edit icon. Apps show the icon on a coloured tint tile.
**Bug:** a transparent PNG icon came out with a BLACK background (re-encoded to JPEG, which has no transparency).
**Fix (backend):** `uploadAndProcessImages*(folder, { keepAlpha: true })` — only the category create/edit routes opt in. An image that has transparency is stored as PNG (`.png` key, `image/png`); an opaque photo is still stored as JPEG. Products, items, sub-categories, banners, stores, avatars: unchanged (JPEG).
**Also needed (haper-admin):** the admin ImageEditorModal bakes every edited image to JPEG in the browser, which also turns transparency black. Until the editor can output PNG for category icons, the backend fix alone does not help uploads made through the admin UI.
**Deploy needed:** backend (admin package) + the haper-admin editor change. No DB migration, no env var.
**Automated:** `packages/admin/__tests__/category-icon-transparency.test.js`.

## Steps
1. ✅ Create a category with a transparent PNG icon (e.g. a cut-out vegetable PNG). Open the saved icon URL: it ends in `.png` and the background is see-through (checkerboard in an image viewer), not black.
2. ✅ Android / iOS / web home: the category tile shows the icon on its coloured tint, with no black or white square behind it.
3. ✅ Edit an existing category and replace the icon with a transparent PNG: same result as step 1.
4. ✅ Upload an ordinary JPEG photo as a category icon: saved as `.jpg`, looks as before.
5. ✅ Upload a product / item image that is a transparent PNG: still stored as JPEG (behaviour unchanged — products are out of scope).
6. ✅ (admin) Create/edit a CATEGORY, pick a transparent PNG, crop/rotate in the editor, "Use this photo", Save: the uploaded file is `.png` and the saved icon is still see-through. Brightness/contrast keep transparency.
7. ✅ (admin) Sub-category icon, product, item images through the editor: still `.jpg` as before.
8. ❌ Icons uploaded BEFORE this fix stay black — they are not repaired automatically. Re-upload the original transparent PNG for each affected category.

## Edge cases
- PNG file renamed to `.jpg`: stored as `.png` because the output really is PNG.
- PNG with no transparent pixels but an alpha channel: stored as PNG (slightly larger file, looks identical).
