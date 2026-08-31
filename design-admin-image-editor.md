# Design spec — manual image-enhancement step (haper-admin)

Status: spec ready for build. Target: tanmoy-web.
Scope: Category, Subcategory, Product, Item image upload in haper-admin (React).

## 1. Problem / job-to-be-done

Admin picks a product/category photo from their phone or a supplier PDF screenshot — it's
often crooked, has dead space around it, or is too dark. Today there is zero client-side
control: the raw file goes straight into `FormData` and up to the server, which only
auto-orients/resizes/compresses (`sharp`, `s3.utils.js`) — it does not fix framing or
exposure. The admin currently has to fix the photo in an external tool (or not at all) and
re-pick the file. This step closes that gap with the smallest possible in-browser editor:
crop, 90° rotate, brightness/contrast. Nothing else.

**Explicitly out of scope** (flagging so nobody is tempted to add these later without a
separate ask): free-angle rotate, filters/presets, text/stickers, layers, multi-undo
history, drawing/annotation, background removal (separate deferred project — see memory
`project_image_bg_removal`), saturation/hue/sharpen sliders, batch-apply-to-all-images.

## 2. Current state (verified in code, 2026-08-31)

- No shared upload component. Three independent implementations, all raw `<input
  type="file">` → `FormData` → multipart POST:
  - `CategoryModal.tsx` (Category + Subcategory, single icon file, `iconFile` state)
  - `ProductModal.tsx` (single image, `resolveMediaUrl` preview)
  - `ItemModal.tsx` (up to 3 images, `imageFiles`/`imagePreviews`/`keptImages` — most
    complex, see MAX_IMAGES logic)
- No `Modal`/`Button` shared component exists anywhere in the codebase — every modal
  hand-rolls its own `<div style={{position:'fixed', inset:0, ...}}>` overlay with inline
  `style={}` objects referencing CSS custom properties (`var(--bg-panel)`,
  `var(--border-color)`, `var(--radius-md)`, `var(--accent-primary)`, `var(--danger)`,
  `var(--text-primary)`, `var(--text-secondary)`). The new editor must follow this exact
  convention — inline styles + the same token names — or it will visually stick out as the
  one component that looks different.
- **Every image render site in the app is a 1:1 square**: `CategoriesList.tsx`,
  `ItemsList.tsx`, `ItemDetailsModal.tsx` (`aspectRatio: '1 / 1'`), `ProductsList.tsx`,
  `ItemLookupPage.tsx`, `OrderDetailsModal.tsx`, `MostSoldItemsPage.tsx` — all use
  `width:100%; height:100%; objectFit:'cover'` inside a square thumb wrapper (72px in
  ItemModal, 60px in ProductModal, etc). There is no non-square image slot anywhere in
  admin or (as far as this investigation reached) the customer apps' catalog surfaces.
  → **This settles the aspect-ratio question: default the crop to a locked 1:1 square.**
- No image-editing library in `package.json` today.
- Backend safety net stays as-is: auto-orient + resize(800×800) + JPEG compress on upload.
  The editor's crop output does not need to hit an exact pixel size — the backend will
  normalize it regardless. The editor's job is framing/exposure control, not final encode.

## 3. User flow

1. Admin opens Category/Subcategory, Product, or Item modal (create or edit) as today.
2. Admin clicks the existing upload dropzone and picks a file via the OS file picker
   (unchanged — no new entry point to learn).
3. **New step**: instead of immediately turning the picked `File` into a thumbnail +
   staging it for upload, the app opens `ImageEditorModal` on top of the parent modal,
   loaded with that picked file.
4. Admin adjusts crop / rotation / brightness / contrast, all previewed live on the same
   image.
5a. Admin clicks **Use this photo** (primary action) → editor bakes the final image to a
    `Blob`/`File`, closes, and hands it back to the parent modal, which stages it in its
    existing thumbnail row exactly where the raw pick would have gone. Parent modal state
    updates (`imageFiles`/`imagePreviews`, `iconFile`, etc.) — no other change to the
    parent's upload/submit logic.
5b. Admin clicks **Cancel** (or presses Esc / clicks the backdrop) → editor closes, nothing
    is staged in the parent modal, parent's file input is cleared so re-picking the same
    file re-fires `onChange`. Net effect: as if the admin never picked a file.
6. If the admin closes the **parent** modal while the editor is still open (e.g. clicks the
   parent's own backdrop somehow, or a "close everything" flow) → treat as Cancel: discard
   the editor's in-progress edit, revoke any object URLs, unmount cleanly. No orphaned
   state, no image silently uploaded.
7. Admin can re-open the editor on an already-staged (not-yet-uploaded) image by clicking
   its thumbnail before Save — re-edits from the last **applied** result, not from scratch
   (so a rotate+crop+brightness pass is refinable without starting over). Editing an
   already-**uploaded** (kept) image from a previous save is out of scope for v1 — those
   only support remove/re-upload as today, since re-editing a server image means
   re-downloading it as a blob, which adds real complexity for a "simple" ask.

## 4. Where it renders — modal-over-modal, not inline

Render `ImageEditorModal` as its own fixed-overlay layer stacked above the parent modal
(higher `z-index`, e.g. `410` vs the parent's `400`), not inline inside the parent form.
Reasons: parent modals are already tall/scrolling forms (ItemModal has 15+ fields); an
inline canvas editor would either get clipped by `overflowY: auto` or push the whole form
open massively. A modal-over-modal keeps the parent form's scroll position untouched and
gives the editor its own full-height canvas.

The parent modal stays mounted and dimmed behind it (same `rgba(0,0,0,0.55)` backdrop
convention, stacked — visually reads as "one darker layer on top of another," which is
acceptable and matches how e.g. a confirm-dialog-over-modal pattern already reads in this
app, e.g. `ConfirmDialog` over `GiftTierFormModal`).

## 5. Layout

Single fixed-size modal, no responsive breakpoint gymnastics needed (admin panel is
desktop/tablet only — same assumption every existing modal already makes).

```
┌─────────────────────────────────────────────────────┐
│  Edit photo                                     [X]  │  ← header, matches ItemModal header style
├─────────────────────────────────────────────────────┤
│                                                       │
│              ┌───────────────────────┐               │
│              │                       │               │
│              │     image canvas      │               │  ← crop box overlaid,
│              │     with crop box     │               │    darkened outside crop
│              │                       │               │    (react-easy-crop default look)
│              └───────────────────────┘               │
│                                                       │
│         [ ⟲ Rotate left ]  [ ⟳ Rotate right ]         │  ← icon buttons, ItemModal toolbar style
│         [ ▭ 1:1 ]  [ ⬚ Free ]                          │  ← aspect toggle, 1:1 selected by default
│                                                       │
│  Brightness   ──────●──────────────────  0            │  ← slider + numeric readout
│  Contrast     ────────●────────────────  0            │
│                                                       │
│                                    [ Reset ]           │  ← ghost/tertiary, right-aligned above footer
├─────────────────────────────────────────────────────┤
│                                [Cancel]  [Use this photo] │  ← footer, matches ItemModal footer style
└─────────────────────────────────────────────────────┘
```

- Modal width: `480px` max (`maxWidth: '480px'`, `width: '100%'`, `padding: '1rem'` on the
  fixed wrapper) — deliberately narrower than ItemModal's 780px since there's no form, just
  one image and controls. Height: `auto`, canvas area fixed at e.g. `360px` tall.
- Canvas/crop area: fixed square-ish stage regardless of source image's native aspect (like
  `react-easy-crop`'s container) so the layout never jumps between images of different
  aspect ratios.
- Toolbar (rotate + aspect toggle) sits directly under the canvas, sliders below that,
  footer actions last — top-to-bottom reads as "see it → shape it → tone it → commit."

## 6. Controls — exact list, defaults, ranges

| Control | Type | Default | Range / values | Notes |
|---|---|---|---|---|
| Crop | draggable/resizable box over image | 1:1, centered, largest square that fits | free-drag position + resize handles | Aspect **locked to 1:1 by default** (see §8) with a "Free" toggle to unlock |
| Aspect toggle | 2-button segmented control | `1:1` selected | `1:1` \| `Free` | Switching to Free keeps current crop position, just unlocks resize |
| Rotate left / right | icon buttons | 0° | −90°/+90° increments, wraps at 360° | No free-angle input — explicitly cut per user's "simple" requirement |
| Brightness | slider + numeric readout | `0` | `-50` to `+50` | Maps to canvas filter/pixel adjustment; label shows signed value e.g. "+20" |
| Contrast | slider + numeric readout | `0` | `-50` to `+50` | Same scale as brightness for consistency — one mental model, not two different unit systems (avoids the "50%–150%" vs "−50–+50" mismatch that would make admins guess) |
| Reset | text/ghost button | — | — | Resets crop to full-image 1:1 default, rotation to 0°, brightness/contrast to 0 — does NOT close the editor, just clears all adjustments so admin can start over without re-picking the file |
| Cancel | secondary button (footer) | — | — | Discards everything, closes editor, parent unaffected |
| Use this photo | primary button (footer) | — | — | Bakes crop+rotation+brightness+contrast to a single output image via canvas, hands back to parent, closes editor |

Live preview: crop box drag/resize is immediate (react-easy-crop does this natively).
Rotate is applied to the displayed image immediately (rotate the underlying image element,
crop box stays in the same screen position). Brightness/contrast use CSS `filter:
brightness(1 + b/100) contrast(1 + c/100)` on the preview `<img>`/canvas for a truly live,
GPU-cheap preview — then the SAME numeric values are baked pixel-by-pixel into the output
canvas at "Use this photo" time (via `ctx.filter` on the drawing context, which supports
the identical CSS filter syntax — so preview and baked output match exactly, no drift).

## 7. States

- **Loading** (editor just opened, image still decoding): canvas area shows a centered
  spinner (reuse `Loader2` from `lucide-react` with the existing `.spin` CSS class already
  used in `ItemModal`'s save button) over a `var(--bg-secondary)` panel. Should be near
  instant for a local file (`URL.createObjectURL`) — this state exists mainly to avoid a
  blank flash, not because it's expected to be slow.
- **Editing**: default interactive state described above. All four adjustments compose
  live in one preview — there's no per-control "apply" step, only the final "Use this
  photo" commits everything at once.
- **Applying** (canvas bake in progress after "Use this photo" is clicked): button shows a
  spinner + "Applying…" (same pattern as ItemModal's `isSaving` → `Loader2` + "Saving...")
  and is disabled to prevent double-submit. For typical product-photo sizes (a few MB, well
  under the backend's 800×800 target) this should resolve in well under a second — but
  wire the state regardless so it never looks frozen on a slower device or an
  unusually large source photo.
- **Error**: file type/decode failure (rare — parent modals already set `accept="image/*"`
  and only invoke the editor after a file is picked). Show inline error text in the canvas
  area — "Couldn't open this image. Try a different file." — with only a Cancel action
  available (no retry inside the editor; admin re-picks from the parent).
- **Disabled**: while "Applying" is in flight, all sliders/buttons except nothing (there's
  no cancel-mid-bake — the bake is synchronous/fast enough not to need one) are disabled.
- **Empty**: N/A — the editor is never opened without a file; it has no empty state of its
  own. (The parent modal's own "no images yet" empty state is unchanged.)

## 8. Aspect-ratio recommendation

Default the crop to **1:1, locked**, with an explicit **Free** toggle for the rare case
(e.g. a wide banner-ish product shot) where the admin wants a non-square crop. Justification:
every single rendering site found in this codebase (`CategoriesList`, `ItemsList`,
`ItemDetailsModal`, `ProductsList`, `ItemLookupPage`, `OrderDetailsModal`,
`MostSoldItemsPage`) displays these images inside a square `objectFit: cover` box — a
non-square upload today just gets uglily cropped by CSS with zero admin control over which
part gets cut off. Giving the admin a locked 1:1 crop **by default** puts that control in
their hands instead of leaving it to CSS `object-fit`, while Free stays available as an
escape hatch rather than a hard requirement — keeping true to "simple" by not forcing a
mode choice up front (1:1 is just pre-selected, one click to change it).

## 9. Component inventory

One new shared component: **`ImageEditorModal`**, e.g.
`/Users/office/Documents/haper/haper-admin/src/components/ImageEditorModal.tsx`.

```ts
interface ImageEditorModalProps {
  isOpen: boolean;
  file: File | null;          // the just-picked source file
  onCancel: () => void;
  onApply: (edited: File) => void;  // baked output, same-ish size, image/jpeg
}
```

- Reused identically by `CategoryModal.tsx` (replaces the direct `setIconFile`),
  `ProductModal.tsx`, and `ItemModal.tsx` (invoked once per picked file — with multi-image
  Item uploads, the editor opens once per file in sequence, not a batch UI; each file gets
  its own edit pass since "simple" rules out a multi-image batch editor).
- New dependency: crop UI. Recommend **`react-easy-crop`** — small (~5kb gzip), no other
  deps, actively maintained, gives crop+pixel-crop-coordinates out of the box, pairs
  naturally with a plain `<canvas>` for the rotate + filter bake step (rotate isn't
  `react-easy-crop`'s job here since we're doing fixed 90° increments, not its built-in
  free-rotate — so the flow is: react-easy-crop for crop-box interaction only → canvas
  draws the source with `ctx.rotate()` in 90° steps + `ctx.filter` for
  brightness/contrast + crop rectangle → `canvas.toBlob()` for the output). Hand-rolling
  the crop-box drag/resize interaction from scratch is exactly the kind of complexity this
  spec is trying to avoid — a maintained library for that one interaction is the right
  trade, everything else (rotate, filters, bake) is plain canvas, no extra deps needed.
  Final call on the library is the implementing engineer's.
- No changes needed to `Modal`/`Button` shared components (none exist) — match the
  established inline-style + CSS-var convention.

## 10. Interaction / motion details

- Modal open/close: instant show/hide, no transition needed — matches every existing modal
  in this codebase (none of them animate open/close).
- Slider drag: native `<input type="range">`, live-updates the preview on every `input`
  event (no debounce needed — CSS filter recompute is cheap).
- Rotate button press: apply instantly, no animation (a 90° snap doesn't need to animate to
  read as intentional — instant feedback is clearer than a spin for a discrete action).
- "Use this photo" button: standard press feedback consistent with existing primary buttons
  in this codebase (background stays `var(--accent-primary)`, cursor `not-allowed` while
  disabled/applying) — no new hover states to design, reuse what `ItemModal`'s submit
  button already does.
- Destructive-action confirmation: **not needed**. Cancel just discards an in-progress,
  never-saved edit (nothing has been persisted yet at any point in this flow) — no
  confirm dialog required, unlike deleting a real saved record.

## 11. Accessibility

- Editor modal traps focus while open (same expectation as any modal-over-modal here); Esc
  closes it (== Cancel).
- Tab order: crop canvas (if focusable, else skip) → Rotate left → Rotate right → Aspect
  toggle → Brightness slider → Contrast slider → Reset → Cancel → Use this photo.
- All icon-only buttons (rotate left/right) get `aria-label` ("Rotate left 90 degrees" /
  "Rotate right 90 degrees") since they carry no visible text label.
- Sliders: native `<input type="range">` with `aria-label` "Brightness" / "Contrast" and
  `aria-valuetext` reflecting the signed numeric value (e.g. "+20") so screen readers don't
  just announce a raw 0–100 range number.
- Touch targets: rotate buttons and the aspect toggle sized at minimum 40×40px hit area
  (admin panel is desktop-first but some admins use tablets in-store) — consistent with the
  36–40px control heights already used in `ItemModal`'s toolbar buttons.
- Contrast: reuse existing tokens (`var(--text-primary)` on `var(--bg-panel)`, already
  verified AA elsewhere in this app) — no new color introduced except the crop-box overlay
  darkening, which is a `rgba(0,0,0,0.5)` mask outside the crop area (standard
  react-easy-crop default), not a text/contrast concern.

## 12. What's intentionally cut (guardrails against scope creep)

- No free-angle rotate (canvas letterboxing math for arbitrary angles is real complexity
  for a feature the user explicitly wants simple — 90°-only avoids it entirely).
- No filters/presets, no saturation/hue/sharpen/vignette — brightness+contrast only, as
  asked.
- No batch/multi-image editing UI — one file in, one edited file out, called once per
  picked file.
- No undo/redo history stack — one Reset button that clears everything back to the
  original pick is enough; multi-step undo is editor-app complexity this doesn't need.
- No re-editing of already-uploaded (server-side) images in v1 — only newly-picked,
  not-yet-uploaded files go through the editor.
- No animated modal transitions — matches the rest of the codebase, which has none.

STATUS: done
OUTPUT: spec produced at /Users/office/Documents/haper/haper-misc/design-admin-image-editor.md — new shared ImageEditorModal (modal-over-modal, 480px, react-easy-crop + canvas bake), 1:1-locked crop default (verified every render site in the app uses square objectFit:cover) with a Free toggle, 90°-only rotate (no free-angle), brightness/contrast both -50..+50 via CSS filter preview baked identically via canvas ctx.filter at Apply time, Reset/Cancel/Use-this-photo actions, loading/editing/applying/error states specified, Cancel-or-parent-close both discard cleanly with no orphaned state, re-edit-already-uploaded-image explicitly deferred out of v1
NEXT: tanmoy-web — build ImageEditorModal per the spec at /Users/office/Documents/haper/haper-misc/design-admin-image-editor.md (verbatim), wiring it into CategoryModal.tsx, ProductModal.tsx, and ItemModal.tsx in place of their direct file-pick-to-state assignment
