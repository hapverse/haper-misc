# Test guide — haper.in/shop (Amazon Associates compliance)

Repo: `haper-static`. Deploy: merge `dev` → `main` (manual, user-only) → GitHub Actions rebuilds on EC2.

## Why this exists
Amazon rejected Associates account `duggu1711-21` on 26 Sep 2026 because every link on
`haper.in/shop` carried a different tag (`vikash5472-21`). Amazon could not attribute traffic
to the applying account. The tag now lives in one place: `amazonAssociatesTag` in
`src/data/site.ts`.

## Before re-applying
- [ ] `amazonAssociatesTag` in `src/data/site.ts` equals the **Store ID shown in Associates Central**
      for the account being applied with (exact string, including `-21`).
- [ ] Site deployed to prod and `https://haper.in/shop` shows the new build (view source, search `tag=`).
- [ ] In the application form, list `https://haper.in` as the website and describe it honestly
      (grocery delivery company site with a curated shop page + buying guides).

## Checks on the live site
- ✅ Every Amazon link on `/shop` and `/shop/*-guide` contains `tag=<Store ID>` and nothing else.
- ✅ Every Amazon link opens in a new tab with `rel="noopener noreferrer nofollow sponsored"`.
- ✅ "(paid link)" label sits directly under each "Shop on Amazon" button and after each inline link.
- ✅ Exact sentence "As an Amazon Associate I earn from qualifying purchases." appears in the top
      disclosure box on `/shop` and every guide, in the legal block at the bottom, and in the site footer.
- ✅ "Amazon and the Amazon logo are trademarks of Amazon.com, Inc. or its affiliates." appears in
      the legal block at the bottom of `/shop` and every guide.
- ✅ No prices or stock shown anywhere (avoids Amazon's price-timestamp rules).
- ✅ No Amazon logo images used (only plain text "Amazon").
- ✅ `/privacy` has section "4A. Affiliate links (Amazon Associates)" and `/privacy#affiliate-links` works.
- ✅ Footer shows no `#` placeholder social icons (hidden until real URLs are set in `site.ts`).
- ✅ `/shop/kitchen-storage-guide`, `/shop/mixer-grinder-guide`, `/shop/home-cleaning-kit-guide`
      load on prod (nginx `try_files $uri.html`).
- ❌ Do not add price tracking, Amazon logos, cloaked/shortened links, or link Amazon from
      non-product text.

## Festive section
- ✅ Seven "Festive & gifting" products link to Amazon product pages (`/dp/ASIN`) with `tag=duggu1711-21`,
      plain product links; old-account linkIds removed when the fresh account duggu1711-21 was created on 26 Sep 2026.

## Optional follow-up (improves approval odds)
- Set `asin` on products in `src/data/shop.ts` so links go to product detail pages (`/dp/ASIN`)
  instead of search results. Search links are the fallback only.
