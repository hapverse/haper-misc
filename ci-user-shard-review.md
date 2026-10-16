# Review: shard USER tests 4-way (ci.yml + deploy.yml, uncommitted)

Reviewer: mayank-reviewer, 2026-10-15. Reference: 820b003 (admin sharding).

## Verdict: APPROVE (0 CRITICAL, 0 HIGH, 0 MEDIUM, 3 LOW)

The change copies 820b003 line for line, with admin replaced by user.

## What was checked

1. **Shard command works.** Jest is 30.3.0, and `--shard` has existed since Jest 28. npm passes everything after `--`
   to the `test` script (`jest --runInBand --detectOpenHandles --forceExit --shard=N/4`).
   I ran `jest --listTests --shard=i/4` locally (no tests executed). Result: 98 files split 25/25/24/24,
   0 duplicates, total = 98. Every file runs exactly once.
2. **Aggregate gate (ci.yml:73-84).** `needs: test-user-shard` plus `if: always()`. The step fails on any result
   other than `success`. A matrix job's result is `failure` if any shard fails, and `cancelled`/`skipped` if
   the shards were cancelled or skipped. All of these exit 1, so the gate can only pass when all 4 shards pass.
   The job name is exactly `User Service Tests`, the same as HEAD, so the required check name is unchanged.
   The shard checks are named `User Service Tests (shard N/4)`, which is a different string, so no collision.
   The names of the auth, delivery, admin, picking and cron jobs are unchanged.
3. **deploy.yml.** `user` is removed from the matrix (line 17). The new `test-user` matrix job is at lines 69-92.
   The deploy job has `needs: [test, test-admin, test-user]` (line 98) and no `if:`. With no `if:`, GitHub
   behaves like `success()`: if any needed job fails, is skipped or is cancelled, deploy is skipped. Deploy
   cannot run after a failed or skipped user shard.
4. **Same config as the old user job.** Node 20, `cache: 'npm'`, `npm install`, checkout@v4. In ci.yml,
   NODE_OPTIONS=4096 comes from the workflow-level `env:` (line 22), which applies to every job, shards included.
   In deploy.yml, the old matrix got NODE_OPTIONS from its job-level env. The new job sets the same env itself
   (lines 76-77).
5. **Env vars.** Besides NODE_OPTIONS, the old user job (`git show HEAD:.github/workflows/ci.yml`) had no job
   env, no services and no secrets. Nothing was lost. The tests use only in-memory Mongo
   (`packages/user/__tests__/setup.js`), so no service containers are needed.
6. **YAML.** Both files parse with js-yaml. The parser throws on duplicate keys, and it did not throw. There are
   8 unique job keys in ci.yml and 4 in deploy.yml. Indentation is correct.

## LOW (optional)

- **L1 deploy.yml:44,70.** The deploy-workflow check names change from `Run All Tests (user)` to
  `Run All Tests (user shard N/4)`. This workflow runs on push only, so branch protection is not affected.
  Update anything that watches check names by hand (dashboards, notes).
- **L2 deploy.yml:18-22 (already there, not from this diff).** The comment still says this matrix runs
  `npm run test:admin`. That stopped being true in 820b003, and user has now moved out as well. Fix: reword
  the comment, or leave it.
- **L3 ci.yml:77 (same as admin).** `always()` means the gate also runs when someone cancels the workflow, and
  then it reports a failure. It is still safe because it never passes. `!cancelled()` would skip the gate on
  cancel instead. Keep it as is to match admin.

No test was run for real in CI. The shard split was proven with `--listTests` only. The first PR run is the
real proof: check that all 4 `User Service Tests (shard N/4)` checks and `User Service Tests` appear.
