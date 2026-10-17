# Test guide: Print on demand, upload + quote (backend step 1b)

Needs: backend deploy only. Env `PRINT_S3_BUCKET` (private bucket, versioning off). Store `config.print.enabled = true`.
All calls need `Authorization` and `x-store-id`.

1. Upload a 3-page PDF (`POST /user/print/upload`, multipart `file` + `consent=true`) -> 201, `pageCount: 3`, `previewUrl` (valid 10 min). ✅
2. Upload a JPG and a PNG -> 201, `pageCount: 1`. ✅
3. Upload without `consent` or with `consent=false` -> 400. ❌ expected
4. `.exe` renamed `.pdf`, a text file, a Word file -> 415. ❌ expected
5. File over 20 MB -> 413. PDF over 200 pages -> 422. Password-protected or damaged PDF -> 422. ❌ expected
6. Store with print off -> 403. `PRINT_S3_BUCKET` empty -> 503. ❌ expected
7. 21st upload in one IST hour -> 429; 61st in a day -> 429; 20 unordered drafts -> 429 even if Redis is down. ❌ expected
8. `GET /user/print/jobs/:id` as the owner -> 200 with `previewUrl`; as another user -> 404. ✅/❌
9. `DELETE /user/print/jobs/:id` as owner -> 200, file gone from S3, row `EXPIRED/PURGED`; other user -> 404; ordered job -> 409.
10. `POST /user/print/quote` `{jobId, pageRange, copies, sides}` -> breakdown with `configVersion`; a client-sent price key -> 400. The breakdown never includes `costPerSide`/`costAmount` (store-internal cost).
11. `GET /user/print/config` (auth + `x-store-id`) with print on -> 200 with prices, limits, `allowedTypes`, `consentVersion`, `retentionHours: 24`, `configVersion`; no `costPerSide`/`sacCode`. ✅
12. Same call with store print off, or `PRINT_S3_BUCKET` empty -> 200 `{enabled:false}` only (client hides the Print tile, no error). ✅
13. Same call without a token -> 401. ❌ expected

## Error reasons (upload + quote)
Every error from `POST /user/print/upload` and `POST /user/print/quote` has `errorType: "PRINT"` and a stable `reason` next to `message`. Clients must switch on `reason`, never on `message`. HTTP codes are unchanged.

| reason | HTTP | when |
|---|---|---|
| `CONSENT_REQUIRED` | 400 | `consent` missing or not `true` |
| `NO_FILE` | 400 | no `file` part |
| `EMPTY_FILE` | 400 | zero-byte file |
| `INVALID_UPLOAD` | 400 | malformed multipart, extra/unknown parts |
| `INVALID_STORE` | 400 | bad `x-store-id` |
| `INVALID_REQUEST` | 400 | quote body fails validation / bad page range |
| `UNAVAILABLE` | 403 / 5xx | print off at the store, bucket not configured, storage error |
| `NOT_FOUND` | 404 | quote for a job that is not yours / does not exist |
| `NOT_QUOTABLE` | 409 | job already ordered, expired or from another store |
| `FILE_TOO_LARGE` | 413 | over 20 MB |
| `UNSUPPORTED_TYPE` | 415 | not a real PDF/JPG/PNG (bytes are checked, not the name) |
| `FILE_CORRUPT` | 422 | damaged PDF or image |
| `PDF_ENCRYPTED` | 422 | password-protected PDF |
| `NO_PAGES` | 422 | PDF with 0 pages |
| `TOO_MANY_PAGES` | 422 | over the store's page limit; body also has `maxPages` |
| `IMAGE_TOO_LARGE` | 422 | image over 40 megapixels |
| `FILE_TOO_COMPLEX` | 422 | file needs too much memory/time to rebuild (see below) |
| `RATE_LIMITED` | 429 | 21st upload in an hour / 61st in a day |
| `TOO_MANY_DRAFTS` | 429 | 20 unordered files already |
| `BUSY` | 503 | server is rebuilding too many files at once; retry in a minute |

14. Each row above -> check `reason` (and `maxPages` for `TOO_MANY_PAGES`). ❌ expected
15. Upload/`GET /jobs/:id` responses carry `Cache-Control: no-store` (they contain a signed preview URL). ✅

## Hostile-file protection
Files are rebuilt in a separate worker thread with a memory cap and a time limit, max 2 at once (2 more may wait).
Tunable env (optional): `PRINT_NORMALISE_TIMEOUT_MS` (20000), `PRINT_NORMALISE_HEAP_MB` (256, min 64), `PRINT_NORMALISE_CONCURRENCY` (2), `PRINT_NORMALISE_QUEUE` (2),
`PRINT_DECODE_STREAM_MAX_MB` (64, biggest single unpacked stream), `PRINT_DECODE_TOTAL_MAX_MB` (512, all unpacked streams in one file),
`PRINT_UPLOAD_MAX_IN_FLIGHT` (6, uploads being received at once per server, checked before the file is read into memory).
Prod should start with `PRINT_NORMALISE_CONCURRENCY=1` and `PRINT_NORMALISE_TIMEOUT_MS=10000`.

16. A ~30 KB "zip-bomb" PDF (tiny file whose pages expand to 1 GB) -> 422 `FILE_TOO_COMPLEX` within a few seconds; other API calls keep answering meanwhile. ❌ expected
17. PDF whose page content uses LZW/RunLength compression -> 422 `FILE_TOO_COMPLEX`. ❌ expected
18. Normal 3-page PDF, JPG, PNG still -> 201. ✅
19. 3+ big uploads at the exact same moment on one server -> extras get 503 `BUSY`; retry works. ❌ expected
20. A ~1 MB PDF with a hidden "object stream" that unpacks to 1 GB (opened before any page check) -> 422 `FILE_TOO_COMPLEX` in under a second; server memory does not jump by GBs. ❌ expected
21. A PDF with many hidden object streams, each 60 MB unpacked (together over 512 MB) -> 422 `FILE_TOO_COMPLEX`. ❌ expected
22. A PDF whose page content is damaged compressed data -> 422 `FILE_TOO_COMPLEX` (was silently treated as small). ❌ expected
23. Normal PDF saved with object streams (most modern PDFs) -> still 201. ✅
24. Server cannot start a worker thread once -> that upload fails (500), the NEXT upload works (no permanent 503). ✅
25. Hindi file name, e.g. `रवि की नोट्स.pdf` -> file list shows exactly `रवि की नोट्स.pdf` (was garbage like `à¤°à¤µ...`). ✅
26. More than `PRINT_UPLOAD_MAX_IN_FLIGHT` uploads arriving at once on one server -> extras get 503 `BUSY` immediately (before the 20 MB is read); retry works. ❌ expected
Needs: backend deploy (multer 2.4.0, sharp 0.35.5, `@cantoo/pdf-lib` pinned to exactly 2.11.1 -> run `npm ci` on the server).
