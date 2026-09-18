# Test — product card thumbnail

Feature: products get a dedicated 1:1 `thumbnail` (the image shown on home / search /
cart cards). When it is blank, clients fall back to `images[0]` exactly as today.

Design: `product-thumbnail-design.md` · Plan: `thumbnail-implementation-plan.md`

| Phase | Repo | Status |
|---|---|---|
| 1 — backend field + fan-out | haper-backend | DONE on `dev` (3df3700) — **deploy to dev pending (manual)** |
| 2 — admin upload UI | haper-admin | DONE, uncommitted (this guide) |
| 3a — web client | haper-web | not started |
| 3b — Android / iOS | haper-android / haper-ios | not started |

Needs: haper-backend deployed to dev (`dapi.haper.in`) + haper-admin deployed
(`damin.haper.in`) before the end-to-end steps below can be run.

## Admin — Product Master (super admin)

1. Products → open any product → Edit. ✅ A **Card thumbnail** field sits directly above
   **Images**, with helper text "Shown on home, search and cart cards…".
2. Product with images but no thumbnail → ✅ chip reads **"Using first image"**.
3. Product with neither → ✅ chip reads **"No card image"** (amber).
4. Click the dashed 96×96 **Upload** box → OS picker opens. ✅ Only ONE file can be picked.
5. Editor opens titled **"Edit thumbnail"**. ✅ There is **no 1:1 / Free toggle** — the crop
   is locked square. Rotate, Zoom, Brightness, Contrast, Reset all still work.
6. **Use this photo** → ✅ preview appears in the slot, chip disappears, toast
   "Thumbnail updated.". ✅ Save is disabled while the upload is in flight.
7. Save changes → ✅ "Product updated — synced N store item(s)".
8. Re-open the product → ✅ the thumbnail is still there.
9. **Replace** → same editor → new image replaces the old one.
10. **Remove** → ✅ slot returns to the dashed dropzone, chip returns. Save → re-open →
    ✅ thumbnail is gone (blank is sent explicitly so the backend unsets it).
11. ❌ Edge: kill the network before **Use this photo** → ✅ toast "Failed to upload
    thumbnail.", the slot goes back to exactly what it was (never a blank/half-staged state).
12. Keyboard: Tab to the Upload box → ✅ visible focus ring, Space/Enter opens the picker.
    ✅ Screen reader names are "Upload card thumbnail" / "Replace card thumbnail" /
    "Remove card thumbnail" (the gallery's own Remove stays distinct).

## Admin — Items (store admin AND super admin)

13. Items → open an existing item → Edit. ✅ **Card thumbnail** shows a dimmed 96×96
    preview (or "Using first image" / "No card image" box), with
    "Managed in Product Master (super admin)." underneath.
14. ✅ There is **no** Replace/Remove/ⓧ here for **any** role, super admin included —
    it is a shared catalogue attribute (decision D2).
15. ✅ The Images label now reads "(n/3 · shown on the product detail screen)" — the old
    "first image is the thumbnail" wording is gone.

## Fan-out (needs phase 1 deployed)

16. Set a thumbnail on a product carried by two stores → Save.
17. ✅ Open the item in store A and store B → both show the same thumbnail.
18. ✅ The customer app / web card for that product shows the new image; the product
    **detail** screen still shows the `images` carousel, unchanged.

## Regression checks

19. ✅ Product Master **Images** upload still accepts multiple files at once and still
    shows the 1:1 / Free toggle in its editor.
20. ✅ Category image upload (CategoryModal) unchanged — toggle present, title
    "Edit photo".
21. ✅ Products with no thumbnail look **pixel-identical** to before everywhere.

## Automated

- `haper-admin`: `npx vitest run src/components/ImageEditorModal.test.tsx
  src/pages/Products/productForm.test.ts src/pages/Products/ProductModal.thumbnail.test.tsx`
  (aspect-lock on/off, status-chip state machine, upload/remove/error/in-flight states).
</content>
