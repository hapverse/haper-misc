# Research: "Apna Club" (ApnaKlub) app teardown vs Haper Business

Date: 2026-11-01. Method: static analysis of the public APK + public web pages. The app was never installed, run, logged into, or contacted. Nothing here is copied code or branding; it is feature-level research for our own design.

Plain-word glossary used below:
- **MOQ / MOV** = minimum order quantity / minimum order value (smallest order the seller accepts, e.g. "add Rs 5,000 more to place the order").
- **KYC** = "know your customer": proof that the buyer is a real business (GST certificate, PAN, shop licence).
- **Slab discount** = a discount that unlocks at a threshold (e.g. "spend Rs 25,000 this month, get 1% back").
- **SDUI** = server-driven UI: the server sends the screen layout, so the app can change screens without a Play Store update.
- **Token amount** = a small advance paid online to confirm a cash-on-delivery order.

## 1. App facts

| Item | Value |
|---|---|
| Name (Play) | "ApnaKlub : Wholesale B2B Shop" (company spelling is ApnaKlub, not "Apna Club") |
| Package id | `com.apnaklub.apnaklub` (confirmed on the Play listing URL and in the APK manifest) |
| Why this app | Only match for a B2B wholesale/club grocery-FMCG app; it sells FMCG to kirana (small neighbourhood grocery) shops in tier-2/3 India. Raised ~$16M Series A (Tiger Global etc.). |
| Play stats | 500K+ downloads, 4.22 stars from ~5,128 ratings, "Updated Oct 12, 2026" (Play page as fetched 2026-11-01) |
| Version analysed | 8.3.74, versionCode 374, minSdk 24, targetSdk 35 |
| File | `apnaklub.apk`, 62,333,306 bytes (62 MB) |
| SHA-256 | `79947f3d7c7bc27e4b08d8a3c5fb6de6baa613c79b1648f37544c3fc861d0c93` |
| Signing cert (SHA-256) | `bf3a7569594955b4ab167e8ae336b745b94001645519c81557bf862c72204925`, subject "CN=Android, OU=Android, O=Google Inc." (a generic Android-debug-style cert, not obviously the vendor's own; so this may be a mirror-repackaged build. Treat the fingerprint as "of this file", not proof of the publisher.) |
| Source | APKPure download host (`d.apkpure.net/b/APK/com.apnaklub.apnaklub?version=latest`). APKMirror had no listing; APKPure's website and APKCombo were blocked by bot checks, so I used only the plain download link and did not try to bypass the checks. |
| Local files | APK in `.../scratchpad/apnaclub-apk/`; decoded copy in `.../scratchpad/apnaclub-extract/`; notes in `.../scratchpad/apnaclub-scripts/` |
| Caveat | Base APK only. The native code split (`libapp.so` etc.) was not in the file, but this build ships a Dart "kernel" bundle (`kernel_blob.bin`, 133 MB) that contains readable strings and app/model source text. That is where nearly all findings come from. |

## 2. How it works (user journey)

Evidence tags: [UI] user-visible copy from the app's English string catalogue; [MODEL] data-model/class names; [WEB] public pages and Play reviews.

1. **Login.** Phone OTP, with Truecaller one-tap, "OTPless" (WhatsApp login), Firebase phone auth, and "get OTP on call". Language picker at first launch: English, Hindi, Hinglish, Gujarati. Login screen shows retailer testimonials. [UI]
2. **Browse before KYC is allowed, but prices are gated.** Users can see products; copy such as "Complete your KYC to view price", "Want to see AK price?", "Upload 1 document and complete your KYC to start buying these products" shows that wholesale price ("AK Price") is hidden until KYC is submitted. [UI]
3. **KYC (5 steps, about 24h verification).** Pick any ONE business document: GST certificate, Business PAN, Shop and Establishment licence, Trade licence, Udyog Aadhaar/Udyam, Drug licence, Food licence, Scale licence, Municipal receipt, Commercial electricity bill, Service/Professional tax, Business ITR, Current cheque. Each has a sample image and a "certificate must clearly show legal name, trade name, registration number" hint. Upload by camera, gallery or PDF; type the document number; tick "I confirm this document is correct". Status per document: Pending / Approved / Rejected with "Resubmit". A showcase tour (Hindi) walks users through it. GST can be verified instantly by OTP or by PAN; a wrong GST 3 times forces the "GST certificate + Business PAN" path. A newer rule makes a supporting document mandatory on top of the main one, with a warning date after which ordering is blocked. A PAN is demanded when yearly purchases cross a limit. Account is blocked from ordering while KYC is rejected. [UI][MODEL]
4. **Shop and address.** Shop name, address, pincode check (`customer/pincode/v1/check`), map pin, "We do not deliver to this pincode yet", and a rule that homepage pincode and delivery-address pincode must match (cart is cleared on change). Address must be in English because the courier system does not support other scripts. [UI]
5. **Catalogue.** 10,000+ products, 400+ brands, categories, brand pages, filters, search with mic, video content per category, "Suggest a product" form when search fails, "Notify me when in stock", recently viewed. Home is server-driven (rails, brand strips, alert banners, KYC widgets can be changed without an app release). [UI][MODEL]
6. **Pricing shown to the shopkeeper.** Per item: MRP, **AK Price** (their wholesale price), **Margin %** ("margin is calculated on AK price", "Up to X% margins"), pack-of-N variants ("Pack of 12"), "hot deal item: you can order only N qty", "Last N pieces left", per-unit price, per-pincode delivery date ("get it as early as 12 Nov"). Retailers can also set a **selling price** (not below AK price, not above MRP) and see "Your profit"; this feeds a "Create your own online store in 2 steps" feature (store link, share to customers). [UI]
7. **Discount mechanics (all value-based, not quantity-tier per line, as far as visible).**
   - Cart-value slabs, shown as a floating cart nudge: "Shop for Rs X & N more items to get Y% OFF", "Get instant Rs X off on orders above Rs Y", "Add Rs X more for free delivery". [UI][MODEL: `SlabOffers` widget]
   - Coupons (flat, percent, expiring, "not combinable, existing coupon will be removed"), freebies (free item auto-added; cannot be removed or have qty changed), cashback baskets, vouchers (unlock after delivery), "Extra 10% off", "Joining discount", Rs 100 off first order.
   - **Online-payment discount**: "Get X% off if you pay online".
   - Back-end carries a per-variant "slab quantity" object and a "bulk cohort pricing" report, so quantity slabs or cohort-specific prices exist server-side. Whether the app shows them as "buy 100 get 2%" was not visible. [MODEL, inferred]
   - Customer **cohorts** (survey cohorts, cohort pricing) let ops give different prices/offers to groups. [MODEL]
8. **Cart rules.** Two fulfilment lanes in one cart: **AKExpress** (fast, own stock) and **Regular**; each has its own minimum order value ("Add Rs X AKExpress items or Rs Y regular items to place order"). Minimum values and blocked pincodes come from a remote config (ConfigCat flags), so ops can change them without a release. Max-qty-per-product messages ("You can buy only up to N units"), "Prices updated / Quantity updated / Products not available" popups with "Update cart to place order", "Refresh cart". The cart page is built on the server for the chosen payment method (totals change with method). [UI][MODEL]
9. **Checkout and payment.** Methods: Cash on Delivery (extra COD charge, "free above Rs X"), COD with a **token amount** paid online first ("Pay Rs X in advance to place a COD order"), Online (Razorpay, UPI intents: GPay, PhonePe, Paytm), bank transfer by NEFT/IMPS/RTGS to the company's account or UPI QR, **wallet** (refunds, cashback, loyalty bonus), and **Credit**. Wallet and credit cannot be combined ("Wallet payment method removed. You cannot use the wallet with credit"). Option to place an order **without a GST invoice**. Self-pickup is also modelled ("pay in advance for self delivery pickup"). [UI][MODEL]
10. **Credit (the part closest to our "pay later").** Not their own lending: partner lenders **Rupifi, ePayLater and Settle**. Flow: "Apply for Credit" opens a partner KYC form (in-app web view), status "under review / rejected by credit partners / inactive". Once active: Credit Account page with limit, available limit, "spent till now", due date, "Repay now" (web view), late-fee table by outstanding-amount range, a "credit charge" shown at checkout as "X% of cart value for N days credit", "Credit Discount", and a block "Cannot select credit as your credit limit is lesser than order total". Also advertises business loans ("starting at X% p.a."). [UI][MODEL]
11. **Delivery and tracking.** "48 hours", free-delivery threshold with progress ("add N more products to get free delivery"), shipments per order (an order can split into several shipments with AWB number and rider detail), live tracking, delivery ETA range, courier-style logistics price endpoint. [UI][MODEL]
12. **Invoices, returns, complaints.** "Get Invoice" per order; GST-invoice generation; if the GST is cancelled the app says upload a new approved GST doc to keep getting GST invoices. Raise Complaint with SKU-level returned quantity, ticket list (open/resolved), callback "within 48 hours", return policy link (15 days per a review). Refund status screen and refund to wallet. [UI][MODEL][WEB]
13. **Reorder.** One-tap reorder from any past order, with a bottom sheet to pick items, and out-of-stock handling ("some items went out of stock, please reselect"). [UI]
14. **Retention.** Loyalty "Riste" scheme (see below), spin-the-wheel and scratch-card cashback, lucky draw, "Jackpot Junction", refer-and-earn (Rs 100 each, friend's first order must be above Rs 2,499), partner (sales rep / POC) referral code, vouchers, Diwali campaigns, in-app stories/surveys (Nudge, Plotline), push + WhatsApp/call support, a named relationship manager per loyalty member.
    - Loyalty tiers (monthly delivered purchases, returns excluded, needs 15 unique products): Rs 25k-75k = 1%, Rs 75k-1.5L = 1.5%, Rs 1.5L+ = 2%, paid into the wallet. Needs 5 prior orders and 2 months with the company.

## 3. Tech / SDK stack

- **Framework:** Flutter (Dart), single Android activity. Shorebird code-push is configured (they can ship Dart patches without a Play update).
- **API:** GraphQL (`/graphql`, ferry/graphql_flutter) for home, cart, search, profile, KYC, loyalty, credit, reorder; plus REST under `web/api/v1/...` (customer order list/cancel, reseller info/documents/products/shipping-address/loyalty/wallet-transactions, logistics price, KYC, pincode, maps). Names only; no endpoint was contacted.
- **Remote config / flags:** ConfigCat (minimum order values, delivery dates, offer T&Cs, location prompt interval).
- **Payments:** Razorpay checkout + UPI deep links; lenders Rupifi, ePayLater, Settle (web-view onboarding/repayment); bank/UPI manual transfer.
- **Auth/KYC:** Firebase Auth (phone), Truecaller SDK, OTPless; GST verification by OTP or PAN.
- **Analytics/engagement:** Firebase (Analytics, Crashlytics, Performance, Messaging, Remote Config, Storage, Realtime DB), Segment, Adjust, Branch-style app links (`app.link`), Facebook App Events, Netcore Smartech (push), Plotline, UXCam, Sentry, OpenTelemetry, Nudge SDKs (stories, spin wheel, survey, SDUI). Google Maps + location.
- **Permissions:** location (fine/coarse), camera, notifications, phone state (for Truecaller), exact alarms, boot-completed, wake lock, vibrate, foreground service, ad-id.
- **Security findings (report only, values not recorded):** hardcoded third-party keys are present in app resources/strings (analytics write key, an engagement-platform key, maps key, Facebook client token, Truecaller client id; likely a feature-flag SDK key in the Dart bundle). The release build also bundles an HTTP-inspector debugging package (Alice). The Dart bundle includes the whole GraphQL client schema including admin-style mutation names; schema exposure is a risk for them, and a reminder for us not to ship admin types to clients.
- **Anything in the target that asked to run/install/send something:** none noticed.

## 4. Feature matrix: Apna Club vs Haper

Haper status comes from `design-retailer-wholesale.md`, the plan, and the `test-retailer-wholesale-*.md` guides: Have = built/tested on dev; Planned = in the design/plan (P2 = credit, dark until enabled); Missing = not in design.

| Feature | Apna Club | Haper Business |
|---|---|---|
| Retailer approval before buying | KYC, any ONE of 13 doc types | Have: GSTIN + shop photo + optional GST cert; status screens; reject reason codes; resubmit limit |
| Prices hidden until approved | Yes ("complete KYC to view price") | Have (wholesale items invisible to non-retailers) |
| GSTIN self-check | OTP / PAN instant verify | Have: format + checksum + state; admin "check on GST portal" manual step. Missing: automated live verification |
| Wholesale-only catalogue | Yes (all items) | Have: wholesale packs ("Pack of 100") in size groups; wholesale rail |
| Separate retailer cart | Single cart, 2 lanes (AKExpress / Regular) with separate MOV | Have: wholesale lines in the same cart as retail (mixed cart rules); no separate cart or lanes |
| Margin / profit display | AK price vs MRP, "margin %", "your profit" | Missing |
| Per-product quantity-tier discounts (100 pcs = 2%) | Not visible in app; slab-qty object exists server-side | Missing (design: pack price only, wholesale lines never take discounts) |
| Cart-value slab offers + progress nudge | Yes | Partly: free-gift tiers + free delivery bar exist for retail lines only; wholesale lines excluded |
| MOQ / MOV per lane or per item | Yes, remote-config | Missing (open question about 6-qty cap only) |
| Credit / pay later | Via partner lenders; limit, due date, late fee, repay | Planned P2: own credit ledger, limit, due 15d after delivery, record offline payment, overdue block |
| Credit fee shown at checkout | "X% for N days" | Planned? Not specified (no interest/fee) |
| COD rules | COD fee, free above limit, token advance | Have: per-retailer COD switch. Missing: COD fee / token advance |
| Bank transfer / UPI QR instructions | Yes | Missing |
| Online-pay discount | Yes ("X% off if you pay online") | Missing (wholesale lines take no discount) |
| Wallet | Yes (cashback, refunds) | Exists for retail (wallet); excluded from credit |
| GST invoice | Per order, GST re-check, "order without GST invoice" | Have: B2B GST invoice with retailer GSTIN, HSN code |
| Reorder | One tap + picker + OOS handling | Missing for wholesale (retail reorder status unchecked) |
| Order split into shipments | Yes | Missing |
| Returns with SKU qty + ticket | Yes, 15-day policy | Have: pack returns (packs-sell guide). Missing: retailer-facing return ticket UX |
| Loyalty / monthly purchase bonus | 1% to 2% of monthly spend into wallet | Missing |
| Relationship manager / field rep | POC + partner referral code | Missing |
| Server-driven home / remote flags | SDUI + ConfigCat | Partial (our admin flags; no SDUI) |
| Stock-out helpers | Notify me, suggest-a-product | Missing for wholesale |
| Retailer's own online store | "Create your online store" with selling price | Missing (out of scope for us) |
| Multi-language | EN, HI, Hinglish, GU | Missing (check for Haper app) |
| Gamification (spin, lucky draw) | Heavy | Missing; low priority |

## 5. What we MISS (ranked by value)

1. **Quantity/value-based discounts that the retailer can see and chase.** Their cart nudges ("Shop Rs X more to get Y% off", free-delivery bar) drive basket size. Ours says wholesale lines never take discounts. Your 100 pcs = 2%, 150 pcs = 5% idea is not in the design at all: per-line tier pricing is a new rule that touches discounts, coupons, GST invoice lines and the order-line snapshot.
2. **MOQ/MOV control.** A retailer app without a minimum order value loses money on tiny orders. They use MOV per fulfilment lane, changeable remotely. We have none.
3. **One-tap reorder for retailers.** Kirana shops buy the same 30-60 items weekly; reorder plus "usual items" is the core habit. We have no wholesale reorder.
4. **Margin/profit transparency.** Showing MRP vs wholesale price and "your margin %" is their main sales pitch ("up to X% margin").
5. **Payment ladder for risky orders**: COD fee with a free threshold, and a token advance for COD. Protects against COD refusals on large orders. Also a bank-transfer/UPI-QR path for big invoices.
6. **Retailer-facing returns/complaint flow with SKU quantity and ticket status.** Complaints in reviews are mostly about this.
7. **Relationship manager / sales rep link.** Loyalty members get a named manager; this is how B2B retention is won.
8. **Loyalty bonus (monthly spend tiers).** Retention lever; can wait until volumes exist.
9. **Automated GST verification.** They verify GST by OTP/PAN in seconds. We do a manual admin check (fine at low volume).
10. **Shipment split, Hindi/Hinglish UI, notify-me, suggest-a-product.** Smaller items.

## 6. What we can ADD

Quick wins (small, no new money rules):
- **MOV for wholesale lines** (one number per store in config, shown as "Add Rs X more to place a wholesale order"). Reuse the existing min-order banner pattern.
- **Margin line on pack rows**: "Rs 11.5 per piece vs Rs 14 MRP = 18% margin" (the design already computes per-piece price; add the MRP compare). The design lists "savings-vs-singles hint" as optional extra Q7, so promote it.
- **Reorder for retailers** from order detail and a "Your usual items" rail (last 90 days of wholesale lines).
- **Cart progress nudge** counting wholesale spend toward a wholesale free-delivery threshold.
- **Notify-me on sold-out packs** and hint copy in Hindi/Hinglish.
- **Admin reminder to ops**: surface "applications waiting more than 2 days" (already in design); add a daily digest.

Bigger (needs design + backend rules):
- **Quantity-tier discounts** (your 100/150 pcs idea). Suggested shape: a tier table per wholesale pack or base item (`minQty`, `percentOff`), applied at cart and frozen into the order line (`tierPercent`, `listPrice`) like the existing `costPrice` snapshot; show the ladder on the pack tile ("Buy 100: 2% off, buy 150: 5% off", with "Add 12 more to get 5%"). This needs a decision to relax the current rule "wholesale lines never take discounts" for this one mechanism only, and a GST-invoice decision (discount shown as a line discount so tax is on the net price).
- **Credit phase 2 enhancements**: due-date reminders, statement download, optional late fee. Our ledger is in-house, so we avoid their partner dependency (a lender approval can take days and can reject a good shop).
- **COD fee/token advance** for large COD orders.
- **Monthly loyalty bonus** into the wallet, only after wholesale volume exists.
- **Retailer return ticket** (SKU, qty, reason, photo, status) reusing admin order-audit.
- **Relationship-manager field**: assign an admin user to each retailer, show name + call button.

## 7. What we can IMPROVE (with evidence)

Evidence: three Play reviews visible on the listing (Oct 2026), a third-party review summary (Kimola, "slow app, unavailable products, high minimum quantity, wrong deliveries, poor response") and the Play rating (4.22 from ~5.1k). I could not read more reviews; treat themes as indicative.

| Their weakness (evidence) | How Haper can do better |
|---|---|
| Cart becomes very slow after 20-30 items: "20-30 seconds just for the cart to load" (a heavy retailer who ordered Rs 10 lakh+) | Keep cart pricing server-fast and local-first; cache per-line tier math; target cart update under 1 second at 50+ lines; add a quick bulk-add by SKU/barcode. Load-test cart with 100 lines before launch. |
| "No expiry date of any product", 15-day return window, worry about near-expiry stock | Show batch expiry/shelf life on pack rows (we already track batches/expiry in warehouse); promise "min N months shelf life" or return rights for short-dated stock. |
| "Paid amount and the bill inside the box differs"; incomplete deliveries | Delivery check against the invoice line by line at handover (picker app already does scan-based picking); show shortage and auto-credit it to the ledger. |
| "Nobody receives the helpline call"; promised fixes not honoured; "total fraud" | Ticket with status and SLA in-app (they have tickets but a 48-hour callback); assigned relationship manager with WhatsApp. |
| Sales executive pushing the user to place the order | No pressure flows; let the retailer build a list and place when ready. |
| Price hidden until KYC (friction at install) | Their approach is gating; ours already hides wholesale items and shows normal retail. Show a teaser ("wholesale prices from Rs X per piece, apply to unlock") to convert. |
| Credit depends on external lenders: application "rejected by our credit partners", delay, plus a fee shown as % of cart | Own ledger with simple terms ("pay within 15 days of delivery, no fee" if that is the business choice), clear limit bar, statements, offline payment recording. |
| Gamification (spin, lucky draw) adds noise to a B2B app | Keep the retailer UI plain: price, margin, stock, reorder, invoice. |
| Hardcoded keys, debug inspector in release | Keep keys server-side and restrict by app; never ship admin types or debug tooling in release builds. |

## 8. Evidence limits

- No dynamic analysis: nothing observed from live screens, so exact layouts, tier-pricing display, actual limits/fees, and real MOV numbers are unknown.
- Base APK only: native code split was missing, so only the Dart kernel strings/model names were read. A feature name proves the feature exists in code, not that it is turned on for all users.
- Quantity-tier ("buy N get X%") display was not found in app copy. Slab-qty and bulk-cohort pricing exist in the data model only.
- Credit terms (interest, limit, late-fee table values) come from partner web views at runtime and could not be read.
- Reviews: only 3 on-page Play reviews plus one aggregated summary; Kimola page returned HTTP 410 when I tried to read it, so its themes are from the search snippet. No Trustpilot/MouthShut data found.
- Version/signature: from a mirror; the Play listing's current version was not shown, so 8.3.74 may differ from the latest Play build.
- Business facts (funding, 400+ brands, 48h delivery) are from press/site and not verified.

## 9. Recommended next steps

1. Decide whether to allow quantity-tier discounts on wholesale packs (1 decision; relaxes the "no discounts on wholesale" rule). If yes, write a short plan: tier table, cart application, order-line snapshot, GST invoice discount line, admin editor, tests.
2. Add a wholesale MOV config and the "add Rs X more" banner (smallest change that protects margin).
3. Add margin/per-piece comparison on pack rows (promote optional Q7 in the design).
4. Add retailer reorder ("usual items") to the design and test guides.
5. Review the P2 credit scope against this note: add due reminders and statements; decide on COD fee/token advance.
6. Add a returns/complaint ticket flow for retailers with SKU-level quantity.
7. Run a cart load test with 100 wholesale lines before launch.
8. If more evidence is wanted: ask the user to share screenshots from their own installed copy, or read more public reviews, before committing to tier-UI details.

Per project rules, any build from this note must update the matching `test-retailer-wholesale-*.md` guide in the same session. No source in any Haper repo was changed for this research.
