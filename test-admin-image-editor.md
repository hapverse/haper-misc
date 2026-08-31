# Test: ImageEditorModal — crop, rotate, adjust brightness/contrast before upload

**Area:** Admin panel → image uploads for **Categories, Subcategories, Products, and Items**  
**Component:** `src/components/ImageEditorModal.tsx` (React modal, client-side only)  
**Integrated into:** `src/pages/Categories/CategoryModal.tsx` (single icon) · `src/pages/Products/ProductModal.tsx` (multi-file queue) · `src/pages/Items/ItemModal.tsx` (multi-file queue + re-edit on pending thumbnails)  
**New dependency:** `react-easy-crop@6.2.3`  
**Deploy needed:** haper-admin only; **no backend changes, no DB migration, no env var**.  
**Tests:** Manual walkthrough only (editor is 100% client-side canvas/DOM, no API contract test needed).

---

## What this is (the real flow)

When a store admin (or super admin) uploads an image to create or edit a **Category, Subcategory, Product, or Item**, the new **ImageEditorModal** opens automatically instead of uploading the raw file directly. The admin can **crop, rotate 90° (left or right), adjust zoom, tweak brightness and contrast**, and see a live preview of all changes. When satisfied, clicking **"Use this photo"** bakes the edits into a final JPEG image (capped at 1600px on the long edge, quality 0.85) and returns it for upload. The edited image is what gets saved — the original raw photo is discarded.

The editor:
- **Crop:** locked to 1:1 square by default (with a "Free" toggle to use the source image's natural aspect).
- **Rotate:** 90° left or 90° right buttons only (no free-angle rotation).
- **Zoom:** slider from 1x to 3x for cropping in.
- **Brightness:** slider from −50 to +50 (live canvas preview).
- **Contrast:** slider from −50 to +50 (live canvas preview).
- **Reset:** one-click return to defaults (all sliders, crop box, rotation back to start).
- **Cancel:** discard all edits, return to picker with no image staged.
- **Output size:** capped at 1600px long edge, JPEG quality 0.85, to stay under the backend's 5MB upload limit.
- **Focus trap + keyboard:** Esc closes the editor (same as Cancel); Tab stays within editor controls; focus restored on close.

For **Product** and **Item** (which allow multiple images), the editor queues files one at a time — admin edits the first, clicks "Use this photo", then the editor re-opens for the next file. After editing all files, all edited images are staged for upload together.

For **Item** re-editing, if an admin clicks on a pending thumbnail (before saving the item), the editor re-opens with the **last edited version** of that image (not the original raw photo). Further edits compound on that version.

---

## Prerequisites

1. **Access to haper-admin dev** (`damin.haper.in`).
2. **Image files ready for testing:**
   - At least one **portrait-orientation photo** (e.g., 1200×1800 px) to test crop/rotate.
   - At least one **landscape photo** (e.g., 1800×1200 px) to test Free crop mode.
   - One **large file** (e.g., >10 MB source) to verify the output cap (1600px long edge, quality 0.85) stays under 5MB for upload.
3. **Browser dev tools** (optional, for inspecting canvas output and blob URL cleanup).
4. **Permissions:** admin or super-admin role with ability to create/edit Categories, Subcategories, Products, and Items.

---

## ✅ Happy path — Category (single image)

### ✅ A. Add a category with image editing

1. **Navigate to Categories** page in admin.
2. **Click "Add Category"** (or similar button to open the Category modal).
3. **Fill in category name** (e.g., *"Dairy"*).
4. **Click the image upload area** and **select a portrait photo** (e.g., 1200×1800 px).
   - ✅ **Expect:** the **ImageEditorModal opens automatically** (not a direct upload).
   - ✅ **Expect:** the modal shows the source photo in a **crop preview box** (center).
   - ✅ **Expect:** a **1:1 square crop box** overlays the image (locked aspect).
   - ✅ **Expect:** controls are visible: Zoom slider, Brightness slider, Contrast slider, Rotate Left/Right buttons, "Free" crop toggle, Reset button, Cancel button, "Use this photo" button.
5. **Drag the crop box** to frame a different part of the photo.
   - ✅ **Expect:** the crop box moves; the preview updates live to show what will be cropped.
6. **Click "Rotate Left"** (90° counter-clockwise).
   - ✅ **Expect:** the entire preview rotates 90° counter-clockwise; the crop box resets position to center.
7. **Adjust the Zoom slider** to ~1.5x.
   - ✅ **Expect:** the preview zooms in; you can now re-position the crop box to frame a tighter section.
8. **Adjust Brightness** to +20.
   - ✅ **Expect:** the preview brightens live (you see the adjustment immediately in the crop box preview).
9. **Adjust Contrast** to +15.
   - ✅ **Expect:** the preview shows increased contrast.
10. **Click "Use this photo"** (after all edits).
    - ✅ **Expect:** the modal **closes automatically** and returns to the Category form.
    - ✅ **Expect:** the **edited image is now staged** in the category form's image preview (showing the cropped, rotated, brightness/contrast-adjusted version, not the original).
11. **Finish creating the category** (enter other fields, click Save).
    - ✅ **Expect:** the **category is saved with the edited image** (not the raw photo).
12. **Verify the saved category's image** (e.g., on the category list or detail view).
    - ✅ **Expect:** the image reflects all the edits: the crop, rotation, brightness, and contrast adjustments are all visible.

### ✅ B. Edit an existing category's image (re-upload)

1. **Open an existing category** (click Edit or similar on the category list).
2. **Replace its icon** by clicking the image area and selecting a new photo.
   - ✅ **Expect:** the ImageEditorModal opens again.
3. **Make some edits** (e.g., crop, adjust brightness).
4. **Click "Use this photo"** and **save the category**.
   - ✅ **Expect:** the category's image is updated with the new edited version.

---

## ✅ Happy path — Product (multi-file queue)

### ✅ C. Add a product with multiple images in sequence

1. **Navigate to Products** page.
2. **Click "Add Product"**.
3. **Fill in product details** (name, description, etc.).
4. **Click the multi-image upload area** and **select 3 photos at once** (Ctrl+Click or Shift+Click to multi-select).
   - ✅ **Expect:** the ImageEditorModal opens for the **first file only** (not all three).
   - ✅ **Expect:** the modal displays the first image.
5. **Make edits to the first image** (crop, rotate, adjust brightness).
6. **Click "Use this photo"**.
   - ✅ **Expect:** the modal **closes and immediately re-opens** with the **second image** (seamless queue).
   - ✅ **Expect:** the first image is **now staged** in the product form's thumbnail grid (or list).
7. **Edit the second image** (e.g., crop only, no rotation).
8. **Click "Use this photo"**.
   - ✅ **Expect:** the editor re-opens for the **third image**.
9. **Edit the third image** and click "Use this photo".
   - ✅ **Expect:** the modal **closes** (no more files in queue).
   - ✅ **Expect:** all **three edited images are now staged** in the product form.
10. **Complete the product creation** (click Save).
    - ✅ **Expect:** all three edited images upload and are saved with the product.

### ✅ D. Multi-file queue: cancel on the second image

1. **Add a product and select 3 images**.
2. **Edit and use the first image**.
3. **When the second image's editor opens, click "Cancel"** instead of using it.
   - ✅ **Expect:** the modal **closes** and returns to the product form.
   - ✅ **Expect:** only the **first edited image is staged** (the second and third are not processed).
   - ✅ **Expect:** you can still **select more files** (or try to upload without the second/third).

### ✅ D1. Editor interaction does not accidentally close parent modal

1. **Open a Product Add modal** (or Item Add modal).
2. **Fill in product details** (name, price, etc.).
3. **Click the multi-image upload area** and **select a photo**.
   - ✅ **Expect:** the ImageEditorModal opens.
4. **Inside the editor, interact with controls:** drag the crop box, move the Zoom slider, adjust Brightness and Contrast sliders.
   - ✅ **Expect:** all controls respond normally.
   - ✅ **Expect:** the **parent Product/Item modal remains open** in the background.
   - ✅ **Expect:** none of these interactions **accidentally close the parent modal**.
5. **Click on the editor's dark backdrop area** (the dark surround/overlay, outside the editor panel and controls).
   - ✅ **Expect:** the backdrop click **closes only the ImageEditorModal** (same behavior as Cancel).
   - ✅ **Expect:** you return to the parent Product/Item form, which **remains open**.
6. **Verify intentional closes:** reopen the editor and click **"Use this photo"** or **"Cancel"**.
   - ✅ **Expect:** only these buttons close the editor by design; accidental interactions do not trigger a close.

> **Note:** this was a real bug found and fixed same-day (2026-08-31) — clicks inside the editor (crop box drag, slider adjustments) were bubbling up and closing the parent ProductModal/ItemModal. Fixed via backdrop-click guard: only clicks on the editor's dark backdrop (outside the editor panel itself) close the editor; internal interactions do not propagate.

---

## ✅ Happy path — Item (multi-file queue + re-edit pending)

### ✅ E. Add an item with multiple images and re-edit one

1. **Navigate to Items** page.
2. **Click "Add Item"** (or similar to open Item modal).
3. **Select 2 photos** for the item.
   - ✅ **Expect:** the ImageEditorModal opens for the first image.
4. **Edit and use the first image.**
   - ✅ **Expect:** the editor opens for the second image.
5. **Edit and use the second image.**
   - ✅ **Expect:** both edited images are **staged in the item form** (you see small thumbnails of both).
6. **Before saving the item, click on the first thumbnail** (the pending/not-yet-uploaded image).
   - ✅ **Expect:** the ImageEditorModal **re-opens**, showing the **last edited version** of the first image (the edited one you used, not the original raw file).
   - ✅ **Expect:** all the previous edits (crop, rotation, etc.) are **pre-loaded in the editor** (Zoom, Brightness, Contrast sliders show the values, crop box is positioned as before).
7. **Make further edits** (e.g., adjust brightness more, recrop slightly).
8. **Click "Use this photo"**.
   - ✅ **Expect:** the thumbnail updates to show the **new re-edited version**.
9. **Save the item**.
   - ✅ **Expect:** the re-edited image is uploaded (the compound edits are baked in).

---

## ✅ Editor controls in detail

### ✅ F. Reset button restores all defaults in one click

1. **Open the ImageEditorModal** (add/edit any entity, upload an image).
2. **Make several edits:**
   - Crop (move the crop box).
   - Rotate (click Rotate Left).
   - Zoom to 2.0x.
   - Brightness to +30.
   - Contrast to +20.
3. **Click "Reset"** button.
   - ✅ **Expect:** the crop box returns to **center, 1:1 square**.
   - ✅ **Expect:** rotation resets to **0° (original orientation)**.
   - ✅ **Expect:** Zoom returns to **1.0x**.
   - ✅ **Expect:** Brightness slider goes back to **0**.
   - ✅ **Expect:** Contrast slider goes back to **0**.
   - ✅ **Expect:** the preview shows the **original unedited image**.

### ✅ G. Cancel discards all edits

1. **Open ImageEditorModal and make several edits** (crop, rotate, brightness).
2. **Click "Cancel"**.
   - ✅ **Expect:** the modal **closes immediately**.
   - ✅ **Expect:** you return to the form (Category/Product/Item) with **no image staged** (or back to the previous state if you were re-editing).
   - ✅ **Expect:** all edits are **discarded** — if you re-open the editor for the same file, it opens fresh with no edits applied.

### ✅ H. Closing the parent modal while editor is open

1. **Open a Category/Product/Item form and upload an image** to open the ImageEditorModal.
2. **With the editor open, close the entire parent form** (click the X button on the modal, or click outside the modal to close it, depending on implementation).
   - ✅ **Expect:** both the editor and the parent modal **close cleanly** (no crash, no error).
   - ✅ **Expect:** **no stale editor state persists** — if you re-open the form and try to upload an image again, the editor opens fresh.
3. **Open the form again and upload an image**.
   - ✅ **Expect:** the editor behaves normally with a fresh state (no "ghost" edits from before).

---

## ✅ Free crop mode

### ✅ I. Toggle "Free" to switch from locked 1:1 to source aspect

1. **Open the ImageEditorModal with a landscape image** (e.g., 1800×1200 px).
   - ✅ **Expect:** the crop box is a **1:1 square** by default.
2. **Click the "Free" toggle** (or similar control to unlock aspect ratio).
   - ✅ **Expect:** the crop box **switches to the source image's natural aspect** (for landscape: the box is wider than tall, matching the 1800×1200 ratio).
   - ✅ **Expect:** you can still **move and reposition** the crop box.
3. **Adjust Zoom** to crop in tighter.
   - ✅ **Expect:** the zoom **applies to the free-aspect crop box** as expected.
4. **Click "Use this photo"**.
   - ✅ **Expect:** the output image has the **source's aspect** (landscape), not forced to 1:1 square.

> **Note:** "Free" is a **known simplification** — it switches to the source image's aspect but does not allow you to freely resize the crop box. If you want to crop tightly in Free mode, use the Zoom slider to zoom in and reposition.

---

## ✅ Keyboard / accessibility

### ✅ J. Focus trap and Esc key

1. **Open ImageEditorModal**.
2. **Press Tab several times** to navigate through the controls (Zoom slider, Brightness slider, Contrast slider, Rotate buttons, etc.).
   - ✅ **Expect:** focus **stays within the editor modal** — does not escape to the page behind.
   - ✅ **Expect:** pressing Tab cycles through all interactive controls in a **sensible order** (e.g., top to bottom).
   - ✅ **Expect:** Shift+Tab cycles backward through the same controls.
3. **Press Esc** while the editor is open.
   - ✅ **Expect:** the modal **closes** (same as clicking Cancel).
   - ✅ **Expect:** focus is **restored** to the element that opened the editor (the upload button or image area).

---

## ❌ Edge cases

### ❌ K. Very large source photo (verify output cap prevents upload rejection)

1. **Prepare a large image file** (e.g., 4000×3000 px, uncompressed ~40 MB).
2. **Upload it to the editor** (Category/Product/Item).
3. **Make some edits** (crop, rotate, adjust sliders).
4. **Click "Use this photo"** and complete the upload (save the entity).
   - ✅ **Expect:** the image uploads **successfully** (no "file too large" 413 error).
   - ✅ **Expect:** the final output is **capped at 1600px long edge**, JPEG quality 0.85 → file size should be **well under 5MB** (backend limit).
   - ✅ **Expect:** the saved entity reflects the edited image correctly.

### ❌ L. Rapid open/close cycles (verify no memory leak on blob URLs)

1. **Open ImageEditorModal** (upload an image to Category/Product).
2. **Click Cancel** to close it (without using the photo).
3. **Open the editor again** (re-upload or re-edit).
4. **Click Cancel** again.
5. **Repeat this cycle 10+ times** in rapid succession.
   - ✅ **Expect:** the editor **remains responsive** (no slowdown, no jank, no memory bloat).
   - ✅ **Expect:** **blob URLs are cleaned up** on each close (not accumulating) — verify in browser DevTools Memory/Network tab if desired (blob: URLs should not pile up).
   - ✅ **Expect:** no console errors about "failed to revoke blob URL" or memory warnings.

> **Technical note:** this was a real bug caught during review — object URLs must be revoked when the modal closes, else they accumulate and leak memory/blob storage.

### ❌ M. Unsupported file type

1. **On the file picker, try to select a non-image file** (e.g., `.txt`, `.pdf`).
   - ✅ **Expect:** the file picker's **accept filter** (existing, pre-editor) **prevents selection** — the file is grayed out or not shown.
   - ✅ **Expect:** the editor is **never opened** for an unsupported type (this is the browser's native file input doing its job, not the editor's job).

> **Note:** the editor does not need to separately validate file type — the file picker's accept attribute handles it.

---

## ✅ Known simplification (not a bug)

### ✅ N. Re-editing compounds edits on the last edited version

1. **Add a Product with one image.**
2. **Upload the image → editor opens.**
3. **Crop to 50% of the original, rotate 90° left, click "Use this photo".**
   - ✅ **Expect:** the product form shows the cropped/rotated thumbnail.
4. **Before saving the product, click the thumbnail to re-edit.**
   - ✅ **Expect:** the editor re-opens with the **last edited version** (already cropped and rotated — not the original raw photo).
5. **Crop again** (cropping the already-cropped image) and click "Use this photo".
   - ✅ **Expect:** the thumbnail updates to show the **compound crop** (crop within crop).
   - ✅ **Expect:** this is **expected behavior, not a bug** — re-edits stack on the previous version by design.

> **Rationale:** re-edits start from the last baked version (not the original) so admins can progressively refine an image without being forced to start over from the raw photo every time.

---

## Deploy and rollout

### Current status (uncommitted)

This feature is **completely built** in haper-admin (React component) but **not yet committed**:

| Repo | Component | Status |
|---|---|---|
| haper-admin | `ImageEditorModal.tsx` + integration into CategoryModal, ProductModal, ItemModal | Reviewed, **APPROVED** by mayank-reviewer (0 Critical/Warning, 3 review rounds) |

### What needs to happen

**Step 1: User approves the commit**
- Once you (`vikashv`) review this test guide and agree the feature is ready, signal approval.

**Step 2: Commit and push to dev**
- `git add src/components/ImageEditorModal.tsx src/pages/Categories/CategoryModal.tsx src/pages/Products/ProductModal.tsx src/pages/Items/ItemModal.tsx package.json package-lock.json` (or equivalent, depending on how dependencies were added).
- `git commit -m "Add ImageEditorModal for crop/rotate/brightness-contrast image editing"`.
- `git push origin dev` — CI will trigger automatically (haper-admin build).

**Step 3: Deploy haper-admin**
- CI/CD auto-deploys to dev on push (standard flow).
- Verify build succeeds; no new eslint errors or test failures.

### No backend deploy, no other repos

- **No backend changes** — this is 100% client-side (canvas-based, no API contract change).
- **No database migration** — no new fields, no schema change.
- **No new env vars** — no secrets or config needed.
- **No client deploy needed** — web/Android/iOS are unaffected (image editing is admin-only).
- **No browser requirements** — standard HTML5 Canvas is widely supported; works on all modern browsers.

### Rollback (if needed)

If issues arise after commit:
- Revert the commit (`git revert <commit-hash>`) and re-deploy haper-admin.
- Users will see the old image upload flow (direct to upload, no editor).
- No data loss — edited images already uploaded are fine; only new uploads will skip the editor.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Editor modal does not open when I upload an image to Category/Product/Item | React component not deployed or build is stale. | Verify the build succeeded; clear browser cache (Cmd+Shift+R or Ctrl+Shift+R); rebuild and redeploy haper-admin. |
| Crop box is frozen or not draggable | react-easy-crop not installed or incompatible. | Verify `package.json` includes `"react-easy-crop": "^6.2.3"` and `npm install` (or `pnpm install`) was run. Rebuild admin. |
| "Use this photo" button is disabled or grayed out | UI state bug. | Try Reset (to reset to defaults), then click "Use this photo". If still disabled, file a bug. |
| Canvas output is blank or all black after clicking "Use this photo" | Canvas rendering failure (rare). | Check browser console for errors; file a bug with the exact image dimensions. |
| Brightness/Contrast sliders do not update the preview | Canvas live preview not wired. | Verify the component's onChange handlers are firing; check browser console for errors; rebuild and redeploy. |
| Image uploads fail with "file too large" (413) even after editing | Output size cap not working. | Verify the component caps to 1600px long edge and JPEG quality 0.85; check the canvas output size in DevTools; file a bug if the cap is not applied. |
| Blob URLs accumulate in memory (DevTools shows hundreds of blob: URLs) | Object URL cleanup broken. | This was fixed during review. If it recurs, inspect the modal's close handler to ensure `URL.revokeObjectURL()` is called on every close. |
| Editor opens but controls are missing (no sliders, no buttons) | CSS not loaded or component styles broken. | Clear cache; rebuild; check browser DevTools for CSS load errors. |
| Re-editing a pending image starts with blank/original photo instead of last edits | State not persisted correctly. | This is a known limitation if `editedBlobUrl` is lost on re-open. Verify the component stores the edited blob URL and re-loads it when re-editing. |
| Esc key does not close the editor | Focus/keyboard handler not wired. | Verify the modal's `onEscapeKeyDown` or similar handler calls the cancel function. Test Esc in browser dev console to confirm it fires. |
| Focus trap does not work (Tab escapes the editor to the page) | focusTrap not installed or not applied. | Verify the component uses a focus-trap library or manually traps focus with `onKeyDown`. Check if the modal is a true dialog element (`<dialog>`) or `<div>` with `role="dialog"`. |

---

## Notes for dev/QA

- **Fixed (2026-08-31): Editor backdrop click guard.** Clicks inside the editor (crop box drag, slider adjustments) were bubbling up and closing the parent Product/Item modal. Fixed via exact-target backdrop-click guard in ProductModal.tsx: only clicks on the editor's dark backdrop (outside the editor panel) close the editor; internal interactions do not propagate. See test ✅ D1.
- **No backend contract.** The editor is 100% client-side. No API changes, no database schema, no migrations — just a React component and a canvas.
- **Output size is capped intentionally.** The 1600px long edge + 0.85 JPEG quality keeps the final image under 5MB (backend limit). This is a hard constraint — do not remove or increase it.
- **Blob URL cleanup is critical.** On every modal close, revoke the blob URL via `URL.revokeObjectURL()`. Leaking blob URLs causes memory/storage buildup and can crash the browser on repeated edits. This was a real bug during review.
- **Free crop mode is a known simplification.** It switches to source aspect but does not allow draggable free-resize of the crop box. Use Zoom to crop tighter in Free mode. This was a deliberate design choice, not incomplete.
- **Re-editing stacks edits.** Crop-within-crop is expected behavior. Admins can re-edit iteratively without being forced back to the original. This is by design.
- **Focus trap + Esc are accessibility features.** Confirm Tab cycles through controls, Shift+Tab reverses, and Esc acts like Cancel. These are required for keyboard-only users.
- **Test on all three entity types:** Categories (single image), Products (multi-file queue), Items (multi-file queue + re-edit pending). The queue behavior and re-edit flow differ slightly.
- **Test rapid open/close cycles** (section ❌ L) — this caught a real memory leak during review. Run it as part of the acceptance test.
- **Unsupported file types are filtered by the file picker,** not by the editor. No need to test that in the editor itself.
