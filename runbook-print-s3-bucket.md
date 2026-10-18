# Runbook: private S3 bucket for Print-on-demand

## What was actually done (2026-10-18): the existing image bucket is reused

The owner decided NOT to create a new bucket. Print files go into the existing private bucket `bheldi-static` (Block all public access is ON; its bucket policy only allows CloudFront to read). Done on 2026-10-18:
- Lifecycle rule `print-expire` on prefix `print/`: expire after 15 days, abort incomplete multipart after 1 day.
- Bucket policy: added a Deny statement `NoCdnForPrint` so CloudFront (both the Origin Access Identity and the service principal) cannot read `print/*`. Images under `uploads/` and `invoices/` are unaffected.
- Dev env: `PRINT_S3_BUCKET=bheldi-static` on the dev user API and dev cron, restarted with `pm2 restart Haper_Dev_User --update-env` and `pm2 restart Haper_Dev_Cron --update-env`. The Print tile then appeared in the dev app.
- Prod: set the same `PRINT_S3_BUCKET=bheldi-static` on the prod user API and cron when enabling print there (section D below, with the prod pm2 names).
The sections below are the ORIGINAL dedicated-bucket plan, kept as the alternative.

You run this yourself. Nothing here was run for you. Do dev first, prod later (same steps, other names).

Why a new bucket: a shared bucket mixes customer documents with images. Customer PDFs must never go there.
The app refuses to start printing until `PRINT_S3_BUCKET` is set, so a mistake fails closed.

## Fill in once (replace everywhere below)

| Placeholder | Example (fictional) | Yours |
|---|---|---|
| `<bucket>` | `haper-dev-print` (prod: `haper-prod-print`) | |
| `<region>` | `ap-south-1` (must match the image bucket and `AWS_S3_REGION`) | |
| `<logs-bucket>` | `haper-s3-logs` (existing, optional) | |
| `<account-id>` | `123456789012` | |
| `<api-principal>` | the IAM user/role the dev API + cron already use | |

How the app uses it: keys are `print/{userId}/{jobId}.pdf`, uploaded with SSE AES256, read via signed URLs (5 and 10 min), deleted by the cron.

---

## A. AWS Console

1. S3 > Create bucket. Name `<bucket>`, region `<region>`.
2. Object Ownership: **ACLs disabled (Bucket owner enforced)**.
3. Block Public Access: tick **Block all public access** (all 4 boxes on).
4. Bucket Versioning: **Disable**. Never enable it (versions would keep deleted customer files).
5. Default encryption: **SSE-S3** (Amazon S3 managed keys). Bucket Key on is fine.
6. Create bucket.
7. Open the bucket > Permissions > Bucket policy > Edit > paste the policy from B5 (with `<bucket>` replaced) > Save.
8. Management tab > Create lifecycle rule:
   - Name `print-expire`, scope: **Limit to prefix** `print/`.
   - Tick "Expire current versions of objects": **15** days.
   - Tick "Delete expired object delete markers or incomplete multipart uploads" > incomplete multipart: **1** day.
   - Save.
9. (Optional) Properties > Server access logging > Enable > target `<logs-bucket>`, prefix `print-access/`.
10. CORS: leave empty. Uploads go through the backend, not the browser.
11. IAM > Policies > Create policy > JSON > paste B7 (replace `<bucket>`) > name `haper-print-s3-access` > create. Attach it to `<api-principal>` (user or role).

## B. AWS CLI (same result)

Set once so you do not repeat it: `export AWS_REGION=<region>`

**B1. Create bucket.** Note: in `ap-south-1` (and every region except us-east-1) the LocationConstraint is required. For us-east-1 drop the `--create-bucket-configuration` line.
```
aws s3api create-bucket --bucket <bucket> --region <region> \
  --create-bucket-configuration LocationConstraint=<region>
```

**B2. Block all public access.**
```
aws s3api put-public-access-block --bucket <bucket> \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

**B3. ACLs off (bucket owner enforced).**
```
aws s3api put-bucket-ownership-controls --bucket <bucket> \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
```

**B4. Default encryption SSE-S3.**
```
aws s3api put-bucket-encryption --bucket <bucket> --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
```
Do NOT run `put-bucket-versioning`. A new bucket is unversioned, which is what we want.

**B5. Bucket policy** (denies non-TLS access and puts that are not AES256). Save as `policy.json`, then `aws s3api put-bucket-policy --bucket <bucket> --policy file://policy.json`
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::<bucket>", "arn:aws:s3:::<bucket>/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    },
    {
      "Sid": "DenyUnencryptedPut",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::<bucket>/*",
      "Condition": { "StringNotEquals": { "s3:x-amz-server-side-encryption": "AES256" } }
    }
  ]
}
```
Example: a put with no encryption header, or with `aws:kms`, is refused. The app always sends AES256, so it is fine.

**B6. Lifecycle** (15 days on `print/`, abort stuck multipart after 1 day). Save as `lifecycle.json`, then `aws s3api put-bucket-lifecycle-configuration --bucket <bucket> --lifecycle-configuration file://lifecycle.json`
```json
{
  "Rules": [
    {
      "ID": "print-expire",
      "Status": "Enabled",
      "Filter": { "Prefix": "print/" },
      "Expiration": { "Days": 15 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
```
This is a backstop. The cron still deletes files earlier on its own schedule.

**B7. IAM policy for the API/cron principal.** Save as `iam.json`, then
`aws iam create-policy --policy-name haper-print-s3-access --policy-document file://iam.json`
and attach it (user: `aws iam attach-user-policy --user-name <api-user> --policy-arn <policy-arn>`; role: `attach-role-policy --role-name <api-role> ...`).
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PrintObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<bucket>/print/*"
    },
    {
      "Sid": "PrintList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<bucket>"
    }
  ]
}
```
Only this one bucket, only the `print/` prefix. No `*` on other buckets.

**B8. (Optional) access logging.** The logs bucket must already allow the S3 logging service to write. Save as `logging.json`:
```json
{ "LoggingEnabled": { "TargetBucket": "<logs-bucket>", "TargetPrefix": "print-access/" } }
```
`aws s3api put-bucket-logging --bucket <bucket> --bucket-logging-status file://logging.json`

---

## C. Verify (run these, expect the stated result)

1. Not public:
```
aws s3api get-bucket-policy-status --bucket <bucket>
```
Expect `"IsPublic": false`.

2. Public-access block and no versioning:
```
aws s3api get-public-access-block --bucket <bucket>      # all four true
aws s3api get-bucket-versioning --bucket <bucket>        # empty output = never enabled
```

3. Upload a tiny test file (needs `--sse AES256`, same as the app):
```
echo test > t.pdf
aws s3 cp t.pdf s3://<bucket>/print/test-user/test-job.pdf --sse AES256
```
Without `--sse AES256` it must fail with AccessDenied (that proves the policy).

4. Plain URL must be blocked:
```
curl -s -o /dev/null -w "%{http_code}\n" https://<bucket>.s3.<region>.amazonaws.com/print/test-user/test-job.pdf
```
Expect `403`.

5. Signed URL must work (5 minutes):
```
aws s3 presign s3://<bucket>/print/test-user/test-job.pdf --expires-in 300
```
Open that URL: it downloads. After 5 minutes it stops (403).

6. Clean up the test file: `aws s3 rm s3://<bucket>/print/test-user/test-job.pdf`

---

## D. App side (dev)

1. Add to the dev **user API** `.env` and the dev **cron** `.env`:
```
PRINT_S3_BUCKET=<bucket>
```
Double check it is NOT equal to `AWS_S3_BUCKET_NAME` (the public image bucket). Nothing in the code checks this for you.

Recommended extra lines for the user API only (from the security audit):
```
PRINT_NORMALISE_CONCURRENCY=1
PRINT_NORMALISE_QUEUE=2
PRINT_NORMALISE_TIMEOUT_MS=10000
PRINT_NORMALISE_HEAP_MB=256
PRINT_DECODE_STREAM_MAX_MB=64
PRINT_DECODE_TOTAL_MAX_MB=256
PRINT_UPLOAD_MAX_IN_FLIGHT=4
```

2. Restart (names from `ecosystem.dev.config.js`):
```
pm2 restart Haper_Dev_User --update-env
pm2 restart Haper_Dev_Cron --update-env
```
`--update-env` makes pm2 pick up the changed `.env`. (Prod names are `Haper_Prod_User` / `Haper_Prod_Cron`.)

3. Confirm the API sees it. With a valid customer token for a store that has print enabled:
```
curl -s -H "Authorization: Bearer <customer-token>" https://dapi.haper.in/user/print/config
```
Expect `"enabled": true` in `data`. If you get `"enabled": false`, either print is off for that store or the env var did not load (the API treats an empty `PRINT_S3_BUCKET` as "off").

4. Confirm the cron. At the next hour's `:40` run, look in the cron log:
```
pm2 logs Haper_Dev_Cron --lines 200 | grep print-file-purge
```
Good: `[print-file-purge] candidates=0 purged=0 failed=0 skipped=0` (numbers may differ).
Bad: `ERROR PRINT_S3_BUCKET is not set: customer print files are NOT being deleted.` Means the cron `.env` was not loaded; recheck step 1 and restart with `--update-env`.

5. If `failed` is above 0 on later runs: the cron principal is missing `s3:DeleteObject` on `print/*`. Recheck B7.

## Risks / notes

- Cost: negligible (small PDFs kept at most 15 days; no new compute). Optional logging adds a few cents of storage.
- If the app runs on keys instead of an instance role, attach B7 to that same IAM user. Prod and dev appEnv use the instance role; other envs use `AWS_S3_*` keys.
- Prod is the same runbook with `haper-prod-print`; do it only when you decide to go live.
