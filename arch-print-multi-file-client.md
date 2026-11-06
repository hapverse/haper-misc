# Print, several files in one order: client architecture note

Companion to `design-print-multi-file.md` (the spec decides what it looks like; this decides how it is built).
Android first, then iOS, then web. All three use the same state names, retry rules and price rule.
Out of v1: keeping the list after an app restart (spec 2.6), reorder, drag-and-drop, swipe-to-remove.

## 0. What exists (Android) and the rule for evolving it
- `PrintViewModel` is created once per Activity (`MainActivity.kt:616`, `viewModel()`), and Print, Review and
  success share it. That already survives going to Review and back, and rotation. **Keep that scope.**
- It talks to `NetworkModule` directly; tests swap it with `mockkObject(NetworkModule)` plus `StandardTestDispatcher`.
  Keep that pattern. Do not add Hilt or a repository layer for this feature.
- Reuse as-is: `PrintCache.prepare`, `ProgressFileBody`, `localFileCheck`, `uploadErrorFor`, `uploadErrorCopy`,
  `parsePrintError`, `PrintOptions` + `isRangeUsable`, `NetworkConnectivityObserver`, `PrintPriceSummary`.

## 1. State model
```kotlin
data class PrintFileItem(
    val id: String,                 // local UUID, made at pick time; never the jobId
    val name: String, val sizeBytes: Long?, val pages: Int?,   // pages known once Ready
    val source: PreparedPrintFile?, // cache copy; deleted (set null) once Ready, as today
    val status: PrintFileStatus,
    val options: PrintOptions,      // copies, sides, page range: always stored per file
    val quoteError: String? = null, // set from a quote error that names this jobId
)
sealed interface PrintFileStatus {
    data class Waiting(val why: WaitReason) : PrintFileStatus   // QUEUED | BUSY_BACKOFF | OFFLINE | PAUSED_DRAFTS
    data class Uploading(val progress: Float) : PrintFileStatus
    data object Checking : PrintFileStatus                      // last byte sent, server checking
    data class Ready(val job: PrintJob) : PrintFileStatus
    data class Failed(val error: PrintUploadError, val message: String, val retryable: Boolean) : PrintFileStatus
    data class Rejected(val error: PrintUploadError, val message: String) : PrintFileStatus  // local check, never uploaded
}
```
Screen state held by `PrintViewModel` (Compose `mutableStateOf`, as today):
`files: List<PrintFileItem>`, `sharedSettings: Boolean`, `notices: List<PrintNotice>`, `quote: PrintQuoteState`,
plus the existing `consent`, `note`, `redeemWallet`, `payWithCash`, `priceChange`, `orderError`, `isPlacing`.
`PrintQuoteState` = `{ quote: PrintQuote?, forKey: QuoteKey?, loading, failed, orderError: String? }`.

**Derived, never stored:** `readyFiles`, `slotsLeft` (max minus non-Rejected rows), `uploadingCount`, main-button
state (spec 2.4), `retryableFailedCount` (Retry all), shared copies/sides when ON (= first file's values),
`canContinue` (all finished, at least one Ready, every Ready range usable, `quote.forKey == currentQuoteKey()`).
`QuoteKey` = ordered list of `(jobId, pageRange, copies, sides)` for Ready files. It is the one guard that stops
the app ordering something different from what was priced.

**Mapping from today:** `fileState: PrintFileState` becomes `files[0]`. `Empty` = empty list,
`Uploading(progress != null)` = `Uploading`, `Uploading(progress = null)` = `Checking`, `Failed(canRetry)` =
`Failed(retryable)` or `Rejected` when local, `Ready(job, ...)` = `Ready(job)`. The global `options` moves into
each item. `readyJob`/`pageCount` stay for one release as derived getters over `files` so existing screens and
tests compile unchanged during slice A.

## 2. Upload queue
- **Where:** a small owned class `PrintUploadQueue(scope, uploader, deleter, online: Flow<Boolean>)` created by the
  ViewModel with `viewModelScope`. It owns only running/waiting bookkeeping and emits
  `onStatus(id, PrintFileStatus)`; the ViewModel owns the list. No UI types inside it.
- `uploader` is a `fun interface PrintUploader { suspend fun upload(f: PreparedPrintFile, onProgress: (Float) -> Unit): UploadOutcome }`;
  the real one wraps `PrintUploadApi.upload` + `ProgressFileBody` (the code now in `runUpload`).
  `UploadOutcome = Success(job) | Error(httpStatus, reason, maxPages) | Offline`.
- **Concurrency 2, order = list order.** One `Job` per running id in a `Map<String, Job>`; when one ends, the
  first `Waiting(QUEUED)` row starts. Retry puts the row back at its list position, not the end.
- **Back-off:** `BUSY` -> `Waiting(BUSY_BACKOFF)`, `delay(8_000)`, again `delay(20_000)`, then `Failed(retryable)`.
  The slot is released during the delay so other rows keep going.
- **Offline:** when `online` goes false, Waiting rows become `Waiting(OFFLINE)` and nothing new starts; a row that
  ends with `Offline` becomes `Failed(NETWORK, retryable)` and is marked `autoRetryLeft = 1`. On back online:
  OFFLINE rows go back to QUEUED; marked rows retry once, then stay Failed.
- **No auto-retry** for `RATE_LIMITED` (each retry costs one of 20 per hour) or `TOO_MANY_DRAFTS`. Add
  `PrintUploadError.TOO_MANY_DRAFTS` (today any 429 maps to `RATE_LIMIT`). On it: that row Failed, every Waiting
  row -> `Waiting(PAUSED_DRAFTS)`, banner shown; the queue resumes only when the user taps Retry or Retry all.
- **Remove:** Waiting -> drop the row. Uploading -> cancel its `Job`, slot frees at once. Checking -> **do not
  cancel** (the server may already have made the draft and we would never learn its id); hide the row, put the id
  in `removedIds`, keep the slot until the call returns, then `DELETE` the returned jobId in the background.
  Ready -> confirm, then `DELETE` (409 ignored, as `deleteRemote` does today).
- **Race rule:** every result goes through one `applyStatus(id, status)` on the main thread, which drops it when
  the id is not in `files` or is in `removedIds`, except that a Success for a removed id triggers `DELETE`.
  Ids are local UUIDs, so a re-picked file never receives an old file's result.
- **Testability:** `StandardTestDispatcher` virtual time drives the 8 s / 20 s delays (`advanceTimeBy`), a
  `FakeUploader` returns scripted outcomes and a `CompletableDeferred` for "still in flight", `online` is a
  `MutableStateFlow`. No real clock, network or Android types in the queue.

## 3. Quote
- One `requote()` trigger: a row becomes Ready or is removed, or any option changes. Debounce 400 ms (change
  `QUOTE_DEBOUNCE_MS` from 300). Immediate (no debounce) after an upload finishes is dropped; the debounce
  absorbs two files finishing together.
- Only Ready files are sent. If any Ready file has an unusable page range, the quote pauses (row shows the
  existing range error and "Fix pages"); a partial total would mislead.
- Request: `PrintQuoteRequest(jobId = null, jobs = [...])` (Gson omits nulls, so the old single-file shape still
  works). Each request gets `seq++`; a response is applied only if its seq is the latest **and** it is stored with
  the `QuoteKey` it was asked for. Cancel the previous coroutine as today; the seq covers a response already read.
- While quoting: previous quote stays, dimmed 0.6, per-file price shows a skeleton, Continue disabled (as today).
- Error naming a jobId -> `quoteError` on that row, other rows unchanged, no total shown. Error without a jobId
  (for example the 500-sides limit) -> `quote.orderError` banner. 404/409 for a job -> that row
  `Failed(retryable = false, "Please add this file again")`; 403 -> print turned off, as today.
- Prices on rows, top-up row, delivery and total all come from `quote.lines`, the top-up field and
  `quote.total`. **The app never adds amounts.** A row with no matching line shows no price.

## 4. Options and "Same settings for all files"
- Stored: `sharedSettings: Boolean` and per-file `options` only. There is **no separate shared copies/sides
  value**: when ON, the card reads files[0] and every edit writes copies/sides to all files at once.
- Default: ON when the 2nd file is added; the new file takes files[0]'s copies/sides. New files later do the same.
- Turn OFF: nothing to copy (each file already holds the values), so nothing moves. Spec 2.3 satisfied by design.
- Turn ON: if all files share copies and sides, just flip; otherwise show the dialog, and on "Use same settings"
  write files[0]'s copies/sides to all. Page range is never touched. "Change for this file" = turn OFF, then edit.
- File settings screen edits one item by `id` (route argument), reusing today's options block and preview. The
  single `previewFile` / `previewSource` stay single and are keyed by the open item's id.

## 5. Navigation and lifetime
- Routes: Print (file list) -> File settings(`fileId`) -> back; Print -> Review -> Order placed. All read the one
  Activity-scoped `PrintViewModel`, so Review and back keeps everything, and rotation keeps everything.
- Process death (Android killed the app in the background) is treated like an app restart: the list comes back
  empty, with no crash. Restoring it needs saved job ids, which is spec 2.6 and out of v1. Cache copies are
  cleaned by the existing `PrintCache.sweep`.
- Store or address change: existing `loadConfig` path; `discard(deleteRemote = true)` now deletes every Ready draft,
  cancels the queue, and shows the spec 2.5 "You changed your address" notice. Print turned off does the same.
- After an order exists, `finishAfterOrder()` clears local state without any DELETE (files belong to the order).

## 6. Android slices (each ends compiling, with unit tests passing)
Capability switch: multi-file turns on only when `config.maxFilesPerOrder` is present. Missing -> max 1 file and
the old single-job quote. So every slice is safe on today's backend, and nothing needs a release-order dance.
- **A. Models + queue, no UI change.** `PrintModels.kt` (nullable `jobs`, `lines`, top-up, config limits, error
  `jobId`), `PrintLogic.kt` (TOO_MANY_DRAFTS), new `PrintUploadQueue.kt`, `PrintFileItem` types, VM internals moved
  to `files` with the derived `fileState`/`readyJob` getters. Tests: queue (concurrency, order, BUSY timing,
  offline, no auto-retry, both remove races), Gson round-trip of new fields. Must not break: all existing
  `PrintViewModelTest`/`PrintLogicTest` cases unchanged. *No new backend needed.*
- **B. File list.** `OpenMultipleDocuments`, trimming to free slots, duplicate skip (name + size), rows with
  status, Add another file, Remove (+ Ready confirm), Retry / Retry all, banners. Files: `PrintScreen.kt`,
  `PrintComponents.kt` (new `PrintFileRow`, `PrintAddFileRow`, `PrintNoticeBanner`). Tests: VM pick/trim/duplicate
  and main-button state. Must not break: consent gate, discard dialog ("Discard N files?"), single-file path when
  the capability is absent. *No new backend needed.*
- **C. Settings.** `PrintSharedSettingsCard`, File settings route by id, switch-on dialog. Tests: section 4 rules.
  Must not break: page range validation, preview download/refresh. *No new backend needed.*
- **D. Price.** Order-level quote, row prices from `lines`, top-up row, collapsed lines over 3 files, 500-sides
  banner, per-row quote error, `QuoteKey` guard. Tests: stale/out-of-order responses, row error mapping, never
  summing. *Needs the new quote deployed on dev to try end to end; unit tests run without it.*
- **E. Review.** Files panel (`PrintOrderFilesList`), order body from Ready files in list order, cash-limit line +
  "Edit files", partial-order sheet, JOB_* errors marking rows. Must not break: wallet split, COD recovery,
  PRICE_CHANGED, Razorpay hand-off. *Needs D on dev.*
- **F. Order placed + Order detail.** Reuse `PrintOrderParts.kt` (`PrintOrderLineRow` per item), "3 files · 46
  pages", "Document 1, 2" numbering. Reads existing order items only. *No new backend needed.*
B and F can be built in parallel after A.

## 7. iOS and web: only the differences
- **Identical everywhere:** status names and their meaning, `QuoteKey` guard, seq-latest-wins, concurrency 2,
  BUSY 8 s / 20 s / 2 tries, one auto-retry after reconnect, no auto-retry for RATE_LIMITED / TOO_MANY_DRAFTS,
  Checking-remove waits then deletes, capability switch on `maxFilesPerOrder`, never summing prices.
- **iOS:** list lives in `PrintDraftViewModel` (owned by `PrintView` as `@StateObject`). Review today gets plain
  values (`jobId`, `copies`, ...); keep it value-based and pass the Ready files + the quote they were priced for.
  Queue = an `actor PrintUploadQueue` with one `Task` per running id; `Task.sleep(for:)` behind an injected
  `Clock` for tests; online state from the existing `Utils/NetworkMonitor.swift`. Every status update hops to
  `@MainActor` before touching `@Published`. Multi-pick per spec 2.1.
- **Web:** list lives in `PrintContext` (it already holds `draft` across Print and Review). Use one `useReducer`
  with actions (`added`, `status`, `removed`, `optionsChanged`, `quoteApplied`) so the race rule is one reducer
  check, not scattered `setState`. Queue = a plain TS class held in a `useRef`, not a hook; `AbortController`
  per upload; `online`/`offline` window events; keep the existing `quoteSeq` ref. Test with Vitest fake timers.

## 8. Risks and guards
1. **Ordering what was not priced** (options change after the quote lands, user taps fast). Guard: `canContinue`
   requires `quote.forKey == currentQuoteKey()`, and the order body is built from that same key.
2. **Orphan drafts filling the 20-draft limit** (remove during Checking, store change, discard). Guard: never
   cancel a Checking upload; DELETE every jobId we learn about once its row is gone; test each path.
3. **Late results writing into the wrong row or after discard.** Guard: local UUID ids, one `applyStatus` entry
   point that checks membership, queue cancelled in `discard`/`finishAfterOrder`/`onCleared`.
