# Print-on-demand final verification (2026-10-12)

All repos on `dev`, nothing staged. In-memory Mongo only. Backend flags: `NODE_ENV=test npx jest --coverage=false --runInBand --forceExit --testTimeout=120000`.

| Item | Command | Result | Notes |
|---|---|---|---|
| backend/user | full jest | PASS 98/98 suites, 1682/1682 tests | print-upload-hardening.test.js PASSES (all 98 files incl. it ran) |
| backend/admin | full jest | 160/161 suites, 2724/2726 tests | gift-tier.test.js (2 GET tests) failed in full run; re-run alone: 20/20 PASS -> flake (unrelated to print) |
| backend/cron | full jest | PASS 12 suites, 174 tests | |
| backend/delivery | full jest | PASS 9 suites, 163 tests | |
| backend/picking | full jest | PASS 8 suites, 95 tests | |
| haper-admin | tsc -b | PASS (no output) | |
| haper-admin | vitest run | PASS 101 files, 1166 tests | |
| haper-admin | eslint (print files) | PASS, 0 problems | |
| haper-web | tsc --noEmit; vite build | PASS; built | chunk-size warning only |
| haper-android | testDebugUnitTest assembleDebug | BUILD SUCCESSFUL | unit tests re-executed via cleanTestDebugUnitTest |
| haper-ios | xcodebuild build (simulator, no signing) | BUILD SUCCEEDED | no test/fastlane run |
