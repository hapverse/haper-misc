# Print: several files in one order (design spec)

Mockup (open in a browser): `haper-misc/design-print-multi-file-mockup.html`.
Builds on: `design-print-page-spec.md`, `design-print-entry-final.md`, `design-print-cod.md`, `print-on-demand-design.md`. All data in this file is made up.
Scope: the customer apps (Android, iOS, web). Admin / rider screens get a one-line note only. No new colours, fonts or shared components.

---
## 0. What exists today (checked in code)

**Backend already allows many files in one order. No server change is needed for a first version.**
- Order body: `jobs[]`, min 1, max 10, unique `jobId`; each job has its own `pageRange`, `copies`, `sides` (`haper-backend/packages/user/src/routes/print/validator.js:13-18, 36`). `MAX_JOBS_PER_ORDER = 10`, `MAX_FILE_MB = 20` (`packages/shared/constants/print.constant.js:41-44`).
- Colour and paper are fixed (B&W, A4) - the only per-file options are **copies, sides, page range**.
- Upload is one file per request (`middleware.js:75`, `files: 1`). Each upload makes one draft job.
- The order price is already computed for ALL files together: the minimum order amount applies to the SUM, delivery is charged ONCE (`packages/shared/utils/print-pricing.utils.js:159-205`, used at `checkout.controller.js:180`). The extra minimum top-up is put on the first line (`print-pricing.utils.js:186-187`).
- BUT the quote endpoint is single-file only: `POST /print/quote` takes one `jobId` and returns that file as if it were the whole order, with the minimum AND delivery charge added to it (`controller.js:179-198`, `print-pricing.utils.js:102-140`). See Backend gaps, item 1.

**The three apps are single-file today (confirmed):**
- Android: one `fileState` (`PrintViewModel.kt:66`), `readyJob` is one job (`:100`), order built as `listOf(PrintOrderJob(job, ...))` (`:475`), picker is `OpenDocument()` (one file, `PrintScreen.kt:146`), "Choose another file" replaces the file and deletes the old draft (`PrintComponents.kt:375`, `PrintViewModel.kt:192`).
- iOS: `fileImporter(... allowsMultipleSelection: false)` (`PrintView.swift:58`), "Choose another" calls `draft.discard()` (`:170`), request has one job (`PrintCheckoutViewModel.swift:101`).
- Web: one `job` state (`Print.tsx:35`), file input has no `multiple` (`Print.tsx:313`), order sends `jobs: [{ ... }]` with one entry (`PrintReview.tsx:194`).
- Nothing keeps draft files across an app restart that I could find (state is in memory).

---
## 1. User flow
1. Home Print tile / Stationery card -> **Print documents** (empty state, unchanged: hero, consent row, rate card).
2. Tick consent (one tick covers every file) -> **Choose files** -> system picker (can pick several at once; section 2).
3. Screen turns into **Your files**: one row per file. Files upload 2 at a time; each row shows its own status.
4. Optional: **Add another file** (row at the end of the list) until 10 files.
5. Optional: change settings - one shared card ("Same settings for all files", on by default), or per file.
6. Sticky bar shows the order total and **Continue** (enabled when every file has finished).
7. **Review**: files list (collapsed), address, price, wallet, payment choice, consent, **Place order**.
8. Success -> **Order placed** (lists the files) -> **Order detail** (lists the files).
- Exits: back (existing discard dialog, now "Discard N files?"), a file fails (retry / remove / continue without it), offline banner, price changed, COD refused (existing recovery).

---
## 2. Layout and decisions

### 2.1 Picking files
| Platform | Several at once | Notes |
|---|---|---|
| Android | `ActivityResultContracts.OpenMultipleDocuments()` (same MIME list as today) | System picker has no max; we trim to the free slots (2.5). Photos: the same picker lists images; no separate photo picker needed. |
| iOS | `fileImporter(... allowsMultipleSelection: true)` for PDF + images; the existing "photo" source choice (`showSourceChoice`) uses `PhotosPicker` with `selectionLimit` = free slots | Keep today's two-source sheet ("Files" / "Photos"). |
| Web | `<input type="file" multiple accept=...>` | Desktop: also accept drag-and-drop on the files area (nice-to-have, section 10). |
- **Decision:** the first pick is multi-select; **Add another file** is also multi-select. Users never need to repeat the picker for each file.
- Order in the list = order picked, then order added. Upload order is the same.

### 2.2 Screen structure (phone, mobile-first, 16 dp / 16 px side padding, 12 gap)
```
 Top bar: "Print documents"                       (back)
 [offline banner / notice banner]                (only when needed)
 Section label: "Your files" ........ "3 of 10"
 +--------------------------------------------+
 | [pdf] Invoice-March.pdf              [bin] |   file row (PrintPanel)
 |       12 pages · 1.4 MB                    |
 |       1 copy · One side · All pages  Edit  |
 |       Ready                       ₹24.00   |
 +--------------------------------------------+
 | [pdf] Notes-Ravi-Sharma.pdf     (progress) |   uploading row
 ...
 +--------------------------------------------+
 | (+)  Add another file                      |   dashed 1dp BorderHairline, 56 dp, SurfaceApp
 +--------------------------------------------+
 +--------------------------------------------+
 | Same settings for all files        [ on ]  |   settings card (PrintPanel)
 | Copies  [- 1 +]    Sides [One side|Both]   |
 | Page range is set per file (Edit on a row) |
 +--------------------------------------------+
 Price summary (PrintPriceSummary: see section 5)
 Note to rider (existing)
 --- sticky bar --------------------------------
 | Total ₹93.00        [ Continue ]            |
```
- Rows are `PrintPanel` (existing), 16 dp radius, 12/14 dp padding, `SurfaceWhite`, 1 dp `BorderHairline`. File icon chip = existing `PrintIconChip` (pdf / image icon as today).
- Name: 14sp Bold `InkPrimary`, one line, middle-ellipsis so ".pdf" stays visible. Meta line 11.5sp `InkSecondary` ("12 pages · 1.4 MB", existing format). Settings line 11.5sp `InkSecondary`. Price right-aligned, 13sp Bold `InkPrimary`, tabular numbers.
- **Remove** = 48x48 dp icon button (trash, `InkSecondary`) at top-right of the row. **Edit** = text action (`GreenAction`, 48 dp tall hit area) at end of the settings line.
- Wide screens (web >= 768 px): same single column, max width 640 px centred (matches current print page); no table. Price summary and the sticky bar stay in the column.
- Reorder: **not in v1.** Pages inside one file keep their order; the order of files has no price or print effect for the customer. Staff print them in list order. (Nice-to-have: long-press drag handle.)
- Replace: **removed as a separate action.** Remove + Add does the same and "Choose another file" would be confusing with a list. On a failed row, "Remove" and "Retry" only.
- Tap on file name/row = opens **File settings** (2.3), same as Edit.

### 2.3 Options model (decision)
Per-file options: copies (1..`maxCopies`), sides (one side / both sides), page range. Fast path:

**"Same settings for all files" switch, default ON as soon as there are 2 or more files.**
- ON: the settings card shows **copies** and **sides** once. Changing them changes every file at once. New files take these values.
- **Page range is never shared** (pages differ per file). It stays "All pages" by default for each file. The card says "Page range is set for each file. Tap Edit on a file." Row settings line shows "All pages" or "Pages 1-5, 9".
- Tapping Edit on a row opens **File settings** (full-screen route on phone, existing preview + options block reused as-is for ONE file: preview, Pages All/Custom, Copies, Sides, price for this file). It shows copies and sides greyed with "Using the same settings as all files. Turn this off to change them for this file only." plus a text action **Change for this file**, which flips the shared switch OFF (see below). Page range is always editable there.
- OFF: each file keeps its own copies / sides. The settings card is replaced by "Settings are set for each file" and the row's Edit opens full File settings. Turning OFF copies the current shared values to every file first (nothing changes visibly).
- Turning ON again when files differ: dialog "Use the same settings for all files? Copies and sides on your files will be replaced with the values below. Page ranges stay." Buttons **Use same settings** / **Keep separate**. Values come from the first file in the list (shown in the dialog: "1 copy, one side").
- Worked example: Ravi adds `Poster.jpg` (1-page image) and `Report-Final.pdf` (40 pages). Switch is ON, 2 copies, both sides. Image: "2 copies · Both sides · All pages" (page range row hidden for 1-page files). PDF: he taps Edit, sets Pages 3-12. Row now "2 copies · Both sides · Pages 3-12". Shared copies stay 2 for both. Then he wants 5 copies of the poster only: Edit on poster -> "Change for this file" -> switch goes OFF, poster 5 copies, PDF still 2. Nothing else moves.
- 1-page files and images: hide the page range controls. Both-sides is still allowed (price shown follows the server quote).

### 2.4 Upload engine (all platforms)
- Client queue, **2 uploads in flight at once** (matches the server rebuild limit of 2 running + 2 waiting, `shared/utils/print-normalise.utils.js:297-298`). The rest wait in "Waiting".
- Row states (text AND icon, never colour only):
| State | Row shows | Allowed actions |
|---|---|---|
| Waiting | clock icon, "Waiting" | Remove |
| Uploading | linear progress (existing `GreenPrice` bar), "Uploading 45%" | Remove (cancels) |
| Checking | indeterminate bar, "Checking your file" (bytes sent, waiting for the server; existing copy) | Remove |
| Ready | green check, "Ready", price | Edit, Remove |
| Failed | alert icon, reason sentence in `InkPrimary`, `Danger` icon | Retry (if retryable), Remove |
| Not allowed (local check) | alert icon, reason, no upload attempted | Remove |
- Failure text is `InkPrimary` 12.5sp next to a `Danger` icon. Reason: existing `Danger` (#DC5F78) on white is about 3.7:1, below the 4.5:1 needed for small text. Same fix as `InkTertiary` in `design-print-page-spec.md`: do not put small text in `Danger`.
- Local checks run when the files are picked, before any upload (existing `localFileCheck` / web / iOS equivalents): type, size, duplicate, slot limit. A rejected file still gets a row so the user sees what happened.
- **Main button while files are not ready:**
  - Any file Waiting / Uploading / Checking: **disabled**, label "Uploading 2 of 4…" (live region, polite). Not-yet-ready price rows show a skeleton bar.
  - All finished, at least one Ready, some Failed / Not allowed: **enabled**, label "Continue with 2 files". Tap opens a confirm sheet (below).
  - No file Ready: disabled, label "Continue".
  - Quote loading: existing 0.6 dim, button disabled.
- **Confirm sheet when some files failed** (bottom sheet / dialog): title "1 file won't be printed", list the failed names, body "You can still place the order with the other 2 files.", buttons **Go back** (primary-secondary) and **Continue without it** (primary). "Continue without it" removes the failed rows. Never silently drop files.

### 2.5 Edge cases (exact behaviour)
| Case | Behaviour |
|---|---|
| 11th file / more picked than free slots | Take the first N that fit, skip the rest. Notice banner (dismissible, `SurfaceMint`): "You can print up to 10 files in one order. We added 7 of the 9 you picked. Place this order first, then add the rest." At 10 files the Add row is disabled: "10 of 10 files added". Count label "10 of 10". Limit is hard-coded 10 (not in config yet, gap 2). |
| File over 20 MB | Local reject, row: "This file is 34 MB. The limit is 20 MB. Try a smaller file or fewer pages." Remove only. Does not count towards the 10 (not uploaded). Limit comes from config `maxFileSizeMB`. |
| Unsupported type | Local reject: "We can only print PDF, JPG or PNG. For a Word file, save it as PDF and try again." (existing copy) |
| Too many pages | Server reason: "This file has too many pages. We can print up to 200 pages in one order. Split the file and print in parts." (existing copy; limit from config `maxPagesPerJob`) |
| Password / damaged file | "We couldn't open this file. If it has a password, remove it and upload again." (existing) |
| Duplicate (same name and same size as a file already in the list) | Skipped before upload. Notice: "Invoice-March.pdf is already in your list. To print more copies, change Copies." For several: "2 files were already in your list and were skipped." |
| `TOO_MANY_DRAFTS` (429, 20 saved files) | Stop the queue; Waiting rows stay Waiting-paused, the file that hit it shows Failed "You have too many saved files. Remove files you don't need, or try again later." Banner on top with action **Review my files** (scrolls to list). Note: the 20 includes files from earlier visits that this screen may not list (gap 3); old drafts disappear after 24 hours (`controller.js:14`). Not auto-retried. |
| `RATE_LIMITED` (429, 20 uploads an hour / 60 a day, `middleware.js:11-12`) | Failed: "Too many uploads right now. Please try again in a while." (existing). Retry allowed. Note: each Retry is one more upload against the hourly 20 - do not auto-retry this one. |
| `BUSY` (503) | Auto-retry quietly 2 times (after 8 s, then 20 s). Row text while waiting: "Waiting for a free slot…". After the 2nd retry fails: Failed "We're a bit busy right now. Please try again in a minute." + Retry. Other rows keep going. |
| Offline mid-upload | Uploading rows -> Failed "Upload stopped. Check your connection." + Retry (existing copy). Waiting rows pause as "Waiting for connection". Existing offline banner. When the network is back: paused rows resume by themselves; stopped rows retry ONCE by themselves, then stay Failed. |
| App killed and reopened | See 2.6. |
| One file fails, others ready | Others unaffected. Ready files can be ordered (2.4 confirm sheet). A failed file never blocks the page. |
| Retry all | If 2 or more rows are Failed with retryable reasons, show a text action **Retry all** beside the "Your files" label. |
| Remove while uploading | Cancels the request; the slot frees; next Waiting file starts. If the server already made the draft, delete it in the background (`DELETE /print/jobs/:id`; a 409 means it belongs to an order - ignore, as today `PrintViewModel.kt:287-292`). |
| Remove a Ready file | Confirm: title "Remove Invoice-March.pdf?", body "It will be deleted from our servers.", buttons **Remove** / **Keep**. Removing Failed / Waiting rows needs no confirm. |
| Remove the last file | Back to the empty state (hero, consent stays ticked). |
| Store changed (address) | Existing behaviour: files from the old store are discarded (a file belongs to the store it was uploaded for, `checkout.controller.js:105` "JOB_OTHER_STORE"). Copy: "You changed your address. Files uploaded for the old store were removed. Please add them again." |

### 2.6 Coming back after the app was closed
- The app saves the list of draft job ids and each file's options in local app storage (Android DataStore / iOS UserDefaults / web localStorage), keyed by store.
- On opening Print: for each saved id call `GET /print/jobs/:id`. Status UPLOADED + files LIVE -> shown as Ready. 404, ordered, expired or purged -> dropped silently.
- If at least one file came back: notice "We kept 3 files from earlier. They are deleted after 24 hours." with **Start fresh** (deletes them all after confirm "Remove all 3 files?"). Files that were mid-upload when the app closed are gone (no job id yet); the notice does not mention them.
- Preview URLs expire: fetch the job again before showing a preview (existing refresh pattern, `Print.tsx:89-107`).

---
## 3. Design tokens (all existing; none new)
Android names (`ui/theme/Color.kt`); iOS `HaperColors` and web Tailwind equivalents by role.
| Role | Token | Hex |
|---|---|---|
| Screen background | `SurfaceApp` | #F5FAF7 |
| Row / card | `SurfaceWhite` + 1dp `BorderHairline` | #FFFFFF / #E5EFE9 |
| Selected / notice fill | `SurfaceMint` | #E7F3EC |
| Progress, price, check | `GreenPrice` | #2F8163 |
| Links, text buttons | `GreenAction` | #257056 |
| Headings, body | `InkPrimary` | #1F332B |
| Secondary text | `InkSecondary` | #5A7268 (never `InkTertiary`) |
| Failed icon / well | `Danger` / `DangerSurface` | #DC5F78 / #FDF1F3 (icon + well only) |
| Pending / over limit chip | `WarningSurface` / `WarningText` | #FBF0DC / #8A5A12 |
Spacing: 16 side padding, 12 between rows, 8 inside meta lines, 10 inside rows. Radius: 16 rows (`PrintPanel`), pill chips. Type (Quicksand as today): section label 12sp SemiBold; name 14sp Bold; meta 11.5sp; price 13sp Bold; button 15sp Bold. Motion: row insert/remove 200 ms ease-out (fade + height); progress updates no animation beyond the bar; Reduce Motion = no row animation. Orange accents are not used (`design-print-page-spec.md` section 3).

---
## 4. Component inventory
| Component | Status | Props / variants |
|---|---|---|
| `PrintPanel`, `PrintIconChip`, `PrintPriceSummary`, `HaperPrimaryButton`, offline banner, error banner, `ConsentRow`, `HaperTopBar` | Reuse | unchanged |
| Existing options block (preview, pages All/Custom, copies, sides) | Reuse as **File settings** screen | now takes one file from the list; copies/sides read-only when shared switch is ON |
| `PrintFileRow` | NEW (per platform) | `name`, `pages`, `sizeLabel`, `status` (waiting / uploading(progress) / checking / ready / failed(message, canRetry) / rejected(message)), `settingsSummary`, `price?`, `onEdit`, `onRemove`, `onRetry` |
| `PrintAddFileRow` | NEW | `count`, `max`, `enabled`, `onClick`; label per 2.5 |
| `PrintSharedSettingsCard` | NEW (small, built from existing stepper + segmented control used in options) | `copies`, `sides`, `shared: Boolean`, callbacks |
| `PrintNoticeBanner` | Reuse the amber note / mint info chrome | `message`, `action?`, `dismissible` |
| `PrintUploadQueue` | NEW logic (state-holder, not UI) | concurrency 2, BUSY back-off, offline pause, persisted ids (2.6). State/architecture is for the frontend architect to review. |
| `PrintOrderFilesList` (review + order placed + order detail) | NEW read-only | `items: [{ fileName, pages, copies, sides, pageRange }]`; collapsed to 3 rows with "Show all 7 files" when > 3 |
Do not share components across repos (same rule as COD spec).

---
## 5. Price
- **Per-file line** (on the file row): printing cost of that file only = pages printed x copies x rate. Shown as "₹24.00". Does NOT include the minimum top-up or delivery (those are order-level and have their own rows).
- **Summary** under the list (existing `PrintPriceSummary` rows, in this order):
  `Invoice-March.pdf (12 pages x 1)  ₹24.00` ... one line per file / `Minimum order top-up  ₹X` (only if applied; helper "Minimum print order is ₹20.") / `Delivery charge  ₹20.00` (once; hidden when 0) / `Includes GST (18%)` / divider / **`Total  ₹93.00`**.
  With more than 3 files the per-file lines collapse into one `Printing (46 pages, 4 files)  ₹X` row with a "Show details" toggle (default collapsed on the files screen, expanded on Review).
- Sticky bar total = `quote.total` from the server, never added up in the view (same rule as before).
- **Refresh:** quote runs on 400 ms debounce after any change to files (a file becoming Ready, removed) or options (copies, sides, page range). Only Ready files are quoted. While quoting: existing 0.6 dim, button disabled, per-file prices show a 48 dp skeleton bar. Quote failed: existing sticky-bar error with Retry.
- Page range invalid on a file: inline error under that file's row ("Pages must be between 1 and 40", existing copy) and the quote is paused; the row shows "Fix pages" and Continue is disabled.
- Too many sides in total (limit 500 per order, `print-pricing.utils.js:172`): error banner "This order is too big to print at once (limit 500 pages including copies). Reduce copies or remove a file." Continue disabled.
- **COD when the total crosses the store's cap** (rules from `design-print-cod.md` section 1; compare against `quote.total`):
  - Review, total within cap: existing "You can pay online or in cash to the rider." with the Payment choice.
  - Total above cap: choice hidden; amber note line 2: **"Cash on delivery is available up to ₹300. This order is ₹340. Remove a file or pay online."** followed by a text action **Edit files** (goes back to the list, keeps everything). The amount is `formatPrintMoney`.
  - The user adds a file on the list screen and the total goes over the cap: nothing is said there (the pay choice lives on Review) - Review shows the line above. If COD was chosen on a previous visit, it is reset to Pay online and the line is shown.
  - Server refusals use the existing recovery: `COD_LIMIT`, `COD_NOT_ELIGIBLE`, `COD_OPEN_LIMIT` (server message verbatim in the error banner, selection reset to Pay online), `COD_OFF` 400 ("Cash on delivery isn't available right now. Please pay online.").
  - Nice-to-have (not v1): a quiet line on the files screen when the total is close to the cap.

---
## 6. Screens

### 6.1 Files (Print screen)
Described in 2.2-2.5. Sticky bar: left "Total ₹93.00" (15sp Bold) + "4 files · 46 pages" (11.5sp `InkSecondary`); right **Continue**.

### 6.2 Review
```
 Top bar: "Review order"
 Section "Files (3)"  [Edit files]
 +--------------------------------------------+
 | Invoice-March.pdf          12 pages  ₹24.00|
 |   1 copy · One side · All pages            |
 | Poster.jpg                  1 page   ₹ 4.00|
 |   2 copies · Both sides                    |
 | Report-Final.pdf           10 pages  ₹40.00|
 |   1 copy · One side · Pages 3-12           |
 +--------------------------------------------+
 Delivery address (unchanged)
 Price summary (section 5)
 Use wallet balance (unchanged)
 Payment (COD spec)
 Amber note (24 h deletion line unchanged: "Your files are deleted from our servers after printing.")
 Consent row (unchanged)
 Pay bar: [ Place order · pay ₹93 ]
```
- Files panel is read-only; **Edit files** pops back to the list.
- Pay bar label unchanged. Place order sends all Ready `jobs[]` in list order.
- If the server says a file is no longer available (`JOB_UNAVAILABLE` / `JOB_EXPIRING` / `JOB_OTHER_STORE`, `checkout.controller.js:105-113`): banner with the server message (it names the problem) + "Back to files"; the affected file(s) are marked Failed "Please add this file again" on the list. Other files stay.
- Price changed (`PRICE_CHANGED`): existing flow, the new quote (with lines) replaces the old.

### 6.3 Order placed
Existing success screen plus a line under the order number: **"3 files · 46 pages"** and (COD) "Pay ₹93 to the rider when it arrives." Files list (collapsed to 3 rows, same `PrintOrderFilesList`) with "Show all".

### 6.4 Order detail
Existing detail screen. Replace the single-file block with `PrintOrderFilesList` (order items already carry `print.fileName/pages/copies/sides/pageRange`, `checkout.controller.js:212-213`). Header chip: "3 files · 46 pages". Timeline, COD wording, cancel window: unchanged. Files list header: "Your files". After printing, file names turn into "Document" because the server replaces them (`PURGED_FILE_NAME`): row shows "Document 1, Document 2…" - number them by position when the name is "document". Sorting: same order as the order.
- Staff / rider note (admin is not in scope): summary line should read "3 files, 46 pages" (pages = pages printed per file, before copies), with each file on its own line "name - pages - copies - sides - range". Rider sees one parcel: "Print order · 3 files".

---
## 7. Copy (plain English)
| Where | Text |
|---|---|
| Empty-state button (was "Choose file") | **Choose files** |
| Empty-state caption | "You can pick up to 10 files. PDF, JPG or PNG, up to 20 MB each." (numbers from config where present) |
| Section label | "Your files" , count "3 of 10" |
| Add row | "Add another file" / at limit "10 of 10 files added" |
| Shared switch | "Same settings for all files" ; helper (on) "Copies and sides apply to every file. Page range is set for each file." ; (off) "Settings are set for each file." |
| Row status | "Waiting", "Uploading 45%", "Checking your file", "Ready", "Waiting for a free slot…", "Waiting for connection" |
| Row actions | "Edit", "Retry", "Remove" |
| Remove confirm | "Remove Invoice-March.pdf?" / "It will be deleted from our servers." / "Remove" / "Keep" |
| Switch-on dialog | "Use the same settings for all files?" / "Copies and sides on your files will be replaced with the values below. Page ranges stay." / "Use same settings" / "Keep separate" |
| File settings (shared) | "Using the same settings as all files." / action "Change for this file" |
| Continue button | "Continue" ; uploading "Uploading 2 of 4…" ; partial "Continue with 2 files" |
| Failed-files sheet | "1 file won't be printed" / "You can still place the order with the other 2 files." / "Go back" / "Continue without it" |
| Restore notice | "We kept 3 files from earlier. They are deleted after 24 hours." / "Start fresh" ; confirm "Remove all 3 files?" / "Remove all" / "Keep" |
| Limit notice | "You can print up to 10 files in one order. We added 7 of the 9 you picked. Place this order first, then add the rest." |
| Duplicate | "Invoice-March.pdf is already in your list. To print more copies, change Copies." |
| Too many drafts | "You have too many saved files. Remove files you don't need, or try again later." |
| Order too big | "This order is too big to print at once (limit 500 pages including copies). Reduce copies or remove a file." |
| COD over cap | "Cash on delivery is available up to ₹300. This order is ₹340. Remove a file or pay online." / "Edit files" |
| Review files header | "Files (3)" / "Edit files" |
| Success | "3 files · 46 pages" |
| Discard dialog (back with files) | "Discard 3 files?" / "They will be deleted from our servers." / "Discard" / "Keep" |
Errors for type / size / pages / password / busy / network / rate limit / unavailable: reuse the existing strings in `PrintLogic.kt:105-126` word for word on all three apps.

---
## 8. States per screen
| Screen | Loading | Empty | Partial | Error | Success | Disabled |
|---|---|---|---|---|---|---|
| Files | config skeleton (existing); restore check shows 1 skeleton row | existing empty state | some rows uploading/failed (2.4); price rows skeleton | row-level errors; banner for limits; quote error in sticky bar | all rows Ready, total shown | Add row at 10 files; Choose disabled offline or consent not ticked (existing); Continue per 2.4 |
| File settings | preview skeleton (existing) | n/a | quote loading dims price | preview failed (existing) / range error inline | back to list | copies and sides read-only when shared |
| Review | quote + config skeleton rows (existing) | n/a (cannot arrive with 0 ready files) | some files missing -> banner + back | existing banners + COD recovery | Place order | existing rules |
| Order placed / detail | existing skeleton | n/a | files purged: names become "Document N" | existing retry | files list shown | n/a |

## 9. Accessibility
- Touch targets 48 dp / 44 px minimum: row Remove, Edit, Retry, Add row (56 dp), switch row, steppers.
- Each file row is one grouped element with a spoken summary, status said last: "Invoice-March.pdf, 12 pages, 1.4 megabytes, 1 copy, one side, all pages, 24 rupees. Ready." Actions are separate focusable items inside: "Edit settings for Invoice-March.pdf", "Remove Invoice-March.pdf", "Retry upload of Invoice-March.pdf".
- Status changes announced politely, one at a time and batched (not every percent): "Invoice-March.pdf is ready", "Notes.pdf failed. We couldn't open this file." Progress bar has `progressBarRangeInfo` / `accessibilityValue` / `role=progressbar` with `aria-valuenow`, updated at 10% steps. Failures use an assertive live region.
- Icons are decorative (hidden); state is always in text. Failure text `InkPrimary` on white (about 14:1); `InkSecondary` on `SurfaceApp` 4.92:1, on `SurfaceMint` 4.56:1 (AA). Do not use `Danger` for text.
- Focus order: top bar -> banners -> "Your files" -> each row (name, Edit, Remove) in list order -> Add row -> shared switch -> copies -> sides -> price summary -> note -> consent -> Continue. After Remove: focus goes to the next row (or the Add row if last). After a picker returns: focus goes to the first new row. After a dialog closes: back to the control that opened it.
- Remove / Continue dialogs trap focus and close with Back / Escape. Web: Add row is a `<button>`, list is `<ul>`, count in `aria-label` ("Your files, 3 of 10").
- Font scale 200%: rows grow, name wraps to 2 lines then ellipsis, price moves under the meta line; sticky bar stacks total above the button.
- Reduce Motion: no row animation, progress bar still updates.

## 10. Small screens (<= 360 dp) and large fonts
- Row: price drops under the settings line; Remove stays top-right; Edit moves to its own line.
- Shared settings card: copies and sides stack vertically.
- Sticky bar: total on one line, button full width below (two lines) when the font scale is above 1.3.
- Keyboard open (page range field): list scrolls; sticky bar stays above the keyboard on Android (`imePadding`), iOS uses safe-area; web uses `visualViewport` as today.

---
## 11. Platform notes (differences only)
- Android: `OpenMultipleDocuments`; progress via the existing `ProgressFileBody`; Remove confirm = `AlertDialog`; file settings = full-screen route; notices = inline banners. Queue lives in `PrintViewModel` (or a small `PrintUploadQueue` class it owns).
- iOS: `fileImporter` multiple; `PhotosPicker` limit = free slots; dialogs via `confirmationDialog` (destructive role on Remove); file settings = pushed screen; swipe-to-delete on a row is allowed IN ADDITION to the Remove button (never instead of it). Announce with `UIAccessibility.post(.announcement)`.
- Web: `<input multiple>`; drag-and-drop on desktop (later); file settings = pushed route on phone width and a right-side panel is NOT used (keep one column); `aria-live` region for status; keep `PRINT_FILE_ACCEPT`. Large uploads: use the existing XHR/fetch progress path per file.
- All: customer apps are light-only; no dark theme work.

---
## 12. Backend gaps
Nothing blocks a first version. These are small, additive and make it cleaner:
1. **Order-level quote (recommended).** `POST /print/quote` only accepts one `jobId` (`validator.js:26-34`, `controller.js:181-198`) and adds minimum + delivery to that one file. The correct multi-file maths already exists (`computeOrderQuote`, `print-pricing.utils.js:163`, used only inside `placeOrder`, `checkout.controller.js:180`). Ask: let `/print/quote` also accept `jobs: [{jobId, pageRange, copies, sides}]` and return the order quote with `lines` (the public quote shape already has `lines`, `toPublicQuote` `:212-215`).
   - **Without any backend change:** the app can still quote each file with the existing endpoint and compute: printing = sum of (billable sides x rate per side) from each response (`billableSides`, `ratePerSide` are in the response), minimum top-up if the sum is below `minimumOrderAmount`, delivery once, GST as shown. Server stays the authority: `PRICE_CHANGED` (409) returns the real quote. This works but duplicates pricing maths on three clients and breaks the "never add up on the phone" rule, so the single endpoint is the better fix. A rejected idea: sending a wrong `expectedTotal` to `/print/order` just to read the quote - it runs address and COD checks and is fragile.
2. **Expose limits in `GET /print/config`.** `maxJobsPerOrder` (10) and `maxBillableSidesPerOrder` (500) are not in the config response (`controller.js:62-81`). Clients would hard-code 10 and learn about 500 only from a 400 at quote/order time.
3. **List my drafts (nice-to-have).** There is no `GET /print/jobs` list. The 20-draft cap counts all unordered files, including ones this screen cannot see (e.g. from an app reinstall). Without it, `TOO_MANY_DRAFTS` can be hard to fix by hand; drafts clear after 24 h (`controller.js:14`). Local saved ids (2.6) cover normal restarts.
4. Multi-file upload in one request: **not needed** (client queue of 2 matches the server limits). Not recommended - it would hide per-file errors.

---
## 13. Open questions (max 4)
1. **Partial order allowed?** Recommendation: yes - ready files can be ordered after an explicit "Continue without it" sheet (2.4). Alternative (block until every file is fine) is safer but frustrating when one file is damaged.
2. **Minimum top-up display.** Server puts it on the first line (`print-pricing.utils.js:186`). Recommendation: show it as its own row ("Minimum order top-up") and keep file lines at their real cost, so a small file never looks expensive.
3. **Duplicate files.** Recommendation: skip with a note and point to Copies. Alternative: ask "Add again?" - more taps for a rare case.
4. **Keep drafts across app restarts?** Recommendation: yes (2.6) - 40 s of upload per big file is the main pain when the app is killed. If the PM wants a smaller first version, ship without it and show the empty state after a restart (files vanish after 24 h anyway).

## 14. Build size (for the PM)
Must-have (first version, all three apps; roughly 3-4 dev-days each on Android/web, 3-4 on iOS):
- Multi-pick + Add another file + file list with remove (confirm) - the core.
- Upload queue (2 at once) with per-row states, retry, BUSY auto-retry, offline handling.
- Local checks: type, size, 10-file limit, duplicate.
- Shared settings card + per-file File settings (page range per file) + the switch-on dialog.
- Price summary with per-file lines, one delivery fee, minimum top-up row (client sum or order-level quote, gap 1).
- Review files panel, COD over-cap message with "Edit files", partial-order confirm sheet.
- Order placed + order detail files list ("3 files · 46 pages").
- Test guides: update `test-print-upload.md`, `test-print-checkout.md`, `test-print-customer-{android,ios,web}.md`.
Needs backend (small, 1 dev-day): gap 1 and gap 2.
Nice-to-have (later): saved drafts across restart (2.6, about 1 day per app), reorder, drag-and-drop on web, swipe-to-remove on iOS, "close to the COD cap" hint on the list, list-my-drafts endpoint, undo on remove.
