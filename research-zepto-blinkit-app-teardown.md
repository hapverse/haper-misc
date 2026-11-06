# Research: Zepto and Blinkit Android app teardown (what they have, what to copy for Haper)

Date: 2026-10-26. Status: **Part 1 done. Part 2: Zepto 26.10.3 teardown DONE (sections 3.1–3.3, 3.5–3.8). Blinkit 18.39.1 PENDING — apkpure has removed it (HTTP 410); needs Play Store sign-in on the emulator or a phone with Blinkit installed (see "How to unblock").**

Goal: look inside the latest Play Store builds of Zepto and Blinkit, list every feature/flow they ship, note what they do more efficiently than Haper, and turn that into an implementation list for Haper (android + backend).

## 0. Targets (observed from the Play Store listing pages, fetched 2026-10-26)

| App | Package | Latest version on Play | Updated | Installs |
|---|---|---|---|---|
| Zepto: Groceries in minutes | `com.zeptoconsumerapp` | 26.10.2 | 22 Oct 2026 | 100M+ |
| Blinkit: Groceries & more | `com.grofers.customerapp` | 18.39.1 | 24 Oct 2026 | 100M+ |

"What's new" for both = "bug fixes and performance improvements" (no feature text).

## 1. Method and evidence rules
- Tooling: REA MCP (JADX headless 0.7.1 via `REA_JADX_MCP_JAR`, apktool, adb). Java 21 present. Android provider reports `available`.
- Static only: manifest, resources (strings, layouts, nav graphs), class/package inventory, decompiled flows, embedded config/feature flags, SDK list. No app is launched, no account is used, no bot protection or geo-gate is bypassed.
- Every claim in Part 2 will be tagged **observed** (seen in manifest/strings/code, with Evidence ID), **inferred** (reasonable reading of names/strings), or **unknown**.
- Public-listing facts (Part 0 and 2A) are marketing text, not verified behaviour.

## 2. Acquisition attempts (so you know what was tried)
| Route | Result |
|---|---|
| ADB device | none attached |
| Emulators on this Mac | `Pixel_9a`, `Pixel_9a_2`, `Pixel_10_Pro_Fold`, `Haper_Preview` all have Play Store images; `iRA_root` does not. Booted `Pixel_9a` (emulator-5554): **no Google account signed in**, Zepto/Blinkit not installed. Cannot install from Play without your account. |
| apkpure direct link | HTTP 403 (Cloudflare) — not bypassed |
| apkmirror | HTTP 403 (Cloudflare) — not bypassed |
| apkcombo / apkmonk / apk.support | DNS does not resolve (also via 1.1.1.1), sites appear dead |
| uptodown | Zepto 26.10.2 listed, but download is behind Cloudflare Turnstile — not bypassed. Blinkit not listed. |
| `apkeep -d apk-pure` (installed at /opt/homebrew/bin/apkeep) | **Zepto: worked** on 27 Oct with `-o acknowledge_dangers=true,arch=arm64-v8a` after your go-ahead (got 26.10.3, newer than Play page). **Blinkit: not on apkpure any more** (`apkpure.com/.../com.grofers.customerapp` → HTTP 410 Gone; apkeep returns nothing). |
| `apkeep -d google-play` | needs a Google account + OAuth token from you |

### How to unblock Blinkit (pick one)
1. **Play Store on the emulator**: start `Pixel_9a` (Play Store image), sign in with any Google account, install Blinkit, then tell me. I pull it with `pull_adb_package` and verify the signer. Nothing else is touched.
2. **Plug in an Android phone** that has Blinkit installed (USB debugging on). I only pull the APK set; nothing is changed on the phone.
3. If you have a Blinkit APK/XAPK file from anywhere, drop it in `~/Downloads` and tell me the name.

## 2A. What the Play listings claim (marketing text, 2026-10-26)

### Zepto (listing)
- Catalogue: 2,00,000+ products; "SUPERMALL" (electronics, fashion, beauty, home & kitchen, jewellery, fitness, pharmacy, toys, puja, gifting).
- **Zero fees**: no delivery fee on orders ₹99+, no handling, no surge, no rain charge (Nov 2025 change, press-confirmed; 2026 third-party checks say free-delivery threshold moves with demand, so treat as variable).
- **Zepto Café**: hot food/beverages in the same app, same cart.
- Live order tracking store → door; payments: COD, UPI, cards, wallets, net banking; "100% quality guarantee"; daily deals; 24/7 support.
- Press (2026): **Zepto Club** paid membership ₹99/mo (Jul 2026), **Zepto Select** premium grocery (Jul 2026), **Pay Later** up to ₹10,000 credit and **Real Lens** real-time produce photos (Mar 2026, limited rollout). Earlier: Zepto Pass → Zepto Daily memberships.

### Blinkit (listing)
- Catalogue: 30,000+ products (tagline changed from "10-minute" to catalogue size in Jan 2026 after gig-worker talks).
- Beauty store, electronics store, **printouts delivered** (B&W / colour), **ambulance in minutes** (Gurugram/parts of Delhi), payments incl. BNPL, Sodexo meal pass, Paytm food wallet.
- Live tracking, in-app chat support, monthly "House Full Sale", bank offers, bundles.
- Press/third-party (2026): small-cart fee ₹30 under ₹99, rain surcharge ₹20–45, late-night fee ₹25–40 (23:00–05:00); Bistro (food) cross-promoted; Recipes page.

## 2B. Haper baseline (from source on dev, 2026-10-26)
Android: Kotlin + Jetpack Compose, package `com.bheldi`, v2.5.6 (versionCode 56). Backend: Express 4 + Mongoose on MongoDB (lerna monorepo: auth, user, admin, delivery, picking, cron; shared models in `packages/shared`).
Paths: A = haper-android/app/src/main/java/com/bheldi/, B = haper-backend/packages/.

### Have (customer app)
- Splash → app-config check → force-update wall / global or per-store maintenance screen (A/ui/screens/maintenance).
- Login: phone + SMS OTP, Google Sign-In (then phone verify), name step, referral code at signup (A/ui/screens/auth).
- Location gate ("Where are we delivering?"), Places autocomplete, map pin picker, add/edit/soft-delete address, labels, village field, pincode geocode (A/ui/screens/address).
- Home: address + nearest-store header with store/address picker sheets, banner carousel (deep-links to category/item/URL), wallet strip + Print tile, "Shop by category" rail, paginated "Fresh picks" grid (admin `isSuggested`), sticky search shortcut, not-serviceable card (A/ui/screens/home).
- Bottom nav: Home, Categories, Orders, Profile.
- Categories grid ("Starting ₹X") → aisle listing (category → sub-category) with one client-side "Under ₹50" filter; **no sort/filter API**.
- Search: Atlas Search (`item_search` index, autocomplete + phrase boost on name, brand/tags/category text) with regex fallback; recent searches on device; category chips above results; zero-result fallback list (B/shared/repositories/item.repository.js).
- Product detail: image pager, brand, price/MRP/"Save ₹X", server-computed unit price (₹/100g), HTML description, stepper, "View cart", static trust tiles.
- Cart: server-side lines, per-line cap 6 + admin cart-limit rules, free-gift progress bar + FREE GIFT line, bill (items, coupon, delivery fee, platform fee, "You save"), delivery note, store checkout message.
- Coupons & offers screen (hold 20 min / confirm / release, min order, first-order, store-scoped, per-customer limit, brute-force guard). Automatic discount engine (percent/flat, global/store, time windows, margin guard). Free gift tiers (FEFO reserve).
- Checkout: "Now" (hard-coded "20 – 30 mins") or Schedule (weekday slots, capacity, lead time, blackout dates, reminders cron). Payment: Razorpay (UPI/cards/netbanking), COD (blocked for scheduled), Haper Wallet partial/full. Payment-status polling, pay-window countdown, retry, switch-to-COD, "place again".
- Orders: list + detail with 5-step timeline, static map pin, rider card with call, delivery OTP, free-cancel countdown, cancel with reason, one-time slot change, 1–5 rating, invoice PDF, admin-edit/short-pick refunds, "Chat with support" (opens support screen, not chat). Print orders have own timeline.
- Wallet (refunds + referral earnings; no top-up, no withdrawal). Refer & earn (share sheet, referral summary; payout on referee's first closed order, ₹500/mo cap, 6-month window).
- Profile/settings, delete account (preview, OTP, restore within grace), notification per-type toggles, device-only Alerts inbox, FCM push on order status.
- Support (call / email / visit, 7 AM–11 PM), FAQ accordion, About, terms WebView.
- Print on demand (PDF upload, pages/copies, B&W A4, live quote, online pay, 24h purge).
- Cross-cutting: offline overlay + retry interceptor, skeleton loaders, pull-to-refresh, dark theme, Firebase Analytics/Crashlytics/Perf, GA4 e-commerce events (A/util/AnalyticsTracker.kt). ~57 customer endpoints (A/data/api/ApiService.kt).

### Have (backend only / ops)
- Store resolution by geo $near radius or service-area polygon; per-store min order, delivery charge, platform fee, hours per weekday, checkout message, invoice toggle, picking/warehouse/batch flags, print config.
- Inventory v2: per-store items, warehouse→store, batches/lots FEFO, reservations with expiry cron, stock-movement ledger, transfers, auto-replenishment, stock alerts, supplier returns. Unpriced items hidden.
- Order pipeline: PAYMENT_INITIATED → PAYMENT_SUCCESS → OPEN → PICKING → PACKED → ASSIGNED → PROCESSING → OUT_FOR_DELIVERY → CLOSED (+ cancelled/admin-cancelled/undelivered/failed/refund states), rider accept/reject, delivery OTP, order edit + partial refund, address snapshot, audit log, invoice number.
- Payments: Razorpay order/verify/webhook, late-capture, payment-alert digest cron. Refunds go to wallet only.
- Realtime: Redis pub/sub → SSE for admin board only; customer app polls.
- Notifications: FCM order-status push (respects prefs), rider/picker/staff pushes, OTP SMS (DLT), email. No marketing/broadcast/topic push, no server-side inbox.
- Admin analytics (revenue, profit, COGS, signups, orders, daily snapshots). POS counter sales.

### Planned / in progress (haper-misc)
Product variants (spec + mockups only, no backend model) · category search chips (Android done; iOS/web pending) · print on demand (done) · scheduled delivery (built) · coupons/discounts/free gift (built) · admin cart limits (in progress) · store maintenance + checkout message (built) · thumbnail field · inventory v2 (dev) · order address durability · payment retry / reopen as COD · customer auth → user service (draft) · picker partial pick/undo (spec) · interstate GST/e-way bill (future).

### Not found in code (candidate gaps; to be confirmed against the APK findings)
- Reorder / "Buy it again" (TODO at A/ui/screens/orders/OrderDetailScreen.kt:1141).
- Live rider tracking (no rider-location endpoint; order map is a static pin).
- Computed ETA (only the "20 – 30 mins" literal at A/ui/screens/checkout/CheckoutScreen.kt:658).
- Recommendations: no similar items / bought-together / trending / personalised.
- Listing sort & filters (brand, price) server-side.
- Product variants / size selector.
- Wishlist / favourites, "notify me when back in stock".
- Rider tip.
- In-app chat or WhatsApp support; self-serve "report issue / missing item / refund request" on an order.
- Wallet top-up; refund to original payment method.
- Membership / subscription; marketing or broadcast push; server-side notification inbox.
- Deep links / App Links (manifest has no VIEW intent filters).
- Multi-language strings.
- Store open/closed indicator in app (model lacks hours exposure in StorePickerSheet).
- Substitution / replacement preference, "add items before packing", gift cards, saved payment methods / UPI intent outside Razorpay checkout.

## 3. Part 2 — APK findings

Evidence tags: **[obs]** = seen in manifest / resources / decompiled code / bundle string table (REA evidence IDs listed in 3.8). **[inf]** = inferred from names and copy, not from running the app. **[unk]** = could not determine statically.

### 3.1 Zepto 26.10.3 (versionCode 772) — identity, stack, SDKs

| Item | Observed |
|---|---|
| File | `com.zeptoconsumerapp@arm64-v8a.xapk` from apkpure via apkeep → base `com.zeptoconsumerapp.apk` (46 MB, sha256 `f0ad3415…0a878`) + `config.arm64_v8a.apk` + `config.xxhdpi.apk` |
| Signer | `apksigner` verifies; cert DN `CN=Android, OU=Android, O=Google Inc.` SHA-256 `e3fbe1a6…369d`. This DN is what Google-managed Play App Signing keys look like, consistent with a Play build, but I have no official fingerprint to compare, so tampering cannot be fully excluded **[inf]** |
| Version | 26.10.3 / 772, minSdk 29 (Android 10+), targetSdk 36, compileSdk 36. Newer than the 26.10.2 shown on the Play page on 26 Oct. |
| Framework | **React Native (New Architecture: Fabric + TurboModules) with Hermes bytecode** (`assets/index.android.bundle`, 16.2 MB, HBC v96, 72,232 functions, 84,178 strings). Native side Kotlin. 21,818 classes, 4 dex files. **[obs]** |
| OTA JS updates | Juspay **Airborne** 2.2.6 + in-house **Phoenix** (`com.phoenix.*`: PhoenixUpdateManager, PhoenixBundleList, PhoenixMurmurHash). `assets/manifest.json`: `{"appId":"zeptoConsumerAndroid","appVersion":"26.10.3","jsVersion":230,"bundleVersion":5}` → JS bundle versioned separately from the APK; features ship without Play releases. **[obs]** |
| Payments | **Juspay HyperSDK** (hyperpay, hyperupi, inappupi, upiintent, dotp, godel, hyperqr, hypernfc) + **NPCI UPI common library** (`org.npci.upi.security.pinactivitycomponent`) = in-app UPI PIN entry; **Amazon Pay SDK**; UPI intent URIs `upi://pay, paytmmp://pay, tez://upi/pay, phonepe://pay, ppe://pay`. Card NFC tap (hypernfc). **[obs]** |
| Login / OTP | Truecaller SDK, **OTPless** (incl. zero-tap WhatsApp OTP), WhatsApp OTP receiver, Google SMS Retriever, PhoneNumberHint, "Call Me With OTP" (IVR), Google Sign-In; **SharedAccountAuthenticator** (`com.zepto.shared_account`) → one login shared across Zepto apps (consumer ↔ Cafe) **[obs]**; silent-auth cleartext allow-list for carrier header-enrichment hosts (`partnerapi.jio.com`, `api-csp.airtel.in`, `in-vil.ipification.com`, `sekuramobile.com`) = **SIM-based silent login** **[inf]** |
| Analytics / growth | Firebase Analytics + Crashlytics + Sessions, **Sentry** (with profiling, rrweb), **AppsFlyer** (OneLink host `zepto-prod.onelink.me`, Install Referrer, Facebook SDK app id), Google Ad Manager (**sponsored products / native ads**, `GAMViewManager`, `TopAdsWidget`), AdMob, InMobi, AppLovin, Appography; in-house **Horizon** event pipeline (`com.zeptonow.horizon`: EventQueue, Compressor (lz4/xxhash), SQLDelight DB, PersistentStorage, batched `v2/publish-events`) **[obs]** |
| Security | **Play Integrity attestation** module (`attestation.*`, events `attestation_registration_*`, `device_integrity_resolved`), **AWS WAF mobile SDK** challenge tokens (`WafIntegration`, `waf_challenge_token_*`, `fe_waf_challenge`), RSA-OAEP module, `EncryptedMMKV` + `DEKManager` + `SecureKeysNative` (libsecurekeys.so), `DETECT_SCREEN_CAPTURE` + ScreenshotDetection, `libtoolChecker.so` (root/tamper check **[inf]**), `DeviceIntelligence` module **[obs]** |
| Perf / infra | `apiprefetch` + `LayoutPrefetchModule`, `PerformanceMode` (device performance classes), `jankTelemetry` (API 31+ FrameMetrics), `FrameTrace`, `PerfOverlay`, `Startup` timing markers, `ZeptoDns` (DNS-over-HTTPS fallback), `ZeptoImage` (Fresco) + **Coil 3** loader, `PhoenixBackgroundWorker` (WorkManager), `MemoryModule`, `AppCacheManager`, React Native **Reanimated/Worklets/Screens/Gesture-handler**, **MMKV**, **Lottie**, SVG, Maps (`rnmaps`), video (`react-native-video`/media3), camera (`zcamera` + CameraX), ZXing, keyboard-controller, Chucker (internal), `NetworkLogger` (ApiLatency, ApiRecording, ApiSpoofer, UrlRewrite, TimeoutOverride interceptors — internal tooling) **[obs]** |
| Permissions worth noting | READ_CONTACTS (referral invites), READ/RECEIVE/SEND_SMS (OTP + UPI device binding), RECORD_AUDIO (voice search), CAMERA (shopping-list OCR, prescription, reviews), NFC (card tap), AD_ID + ADSERVICES_* (ads), DOWNLOAD_WITHOUT_NOTIFICATION (invoices/assets), FOREGROUND_SERVICE, GET_ACCOUNTS (shared account) **[obs]** |
| Manifest extras | `largeHeap=true`; App Links `autoVerify` on `zepto.com, www.zepto.com, zeptonow.com, www.zeptonow.com, s.zepto.co.in, store.zepto.co.in` + custom scheme `zepto://` + OneLink; **two `activity-alias` launcher icons** (`APP_ICON_CAMPAIGN_1/2`) for festive app-icon swaps; `OrderCleanupService` / `GenericCleanupService`; WorkManager; backup agent for auto-login; dynamic feature module only for internal Chucker; GAM app id present; Firebase `crashlytics_collection_enabled=false` at manifest level (enabled at runtime) **[obs]** |
| Fonts | TT Norms Pro / "ZeptoNorms" (custom), Fraunces (serif, for premium "Select"), Open Sans, Roboto, `ZIcons.ttf` icon font **[obs]** |
| Backends named in bundle | hosts `api-gateway.zepto.co.in`, `api.zepto.co.in`, `www.zeptonow.com`, `shop.zeptonow.com`, `lite.zeptonow.com` (PWA), images on `ik.imagekit.io` (ImageKit CDN with URL transforms) and CloudFront; a `v1/gateway/graphql/` endpoint. Services (72 names): ads, attestation, campaign, **cart-federator (CFS)**, cart, chat, comms-delivery, coupon, crm-ticketing, experimentation, gamification, invoicing, **layout-configuration / layout-management (LMS)**, macros-search-federator, oms, order-creation, partner-integration, payment, pfs-postorder, printing, product-assortment, recipe, recommendation, rewards, samiksha (reviews), search, serviceability, shop-agent, spm, store, user-search, voucher, wallet, wishlist, zepto-coins, zerox. **[obs]** |

### 3.2 Zepto — screens, flows and features (from bundle strings, routes, events, API paths)

Legend: the bullet says what exists, then the evidence (route/widget name, event, endpoint, or copy).

**A. Startup, login, identity**
- Dynamic splash screen with campaign assets (`NativeDynamicSplashScreen`, `v4/banners/splash_screen`, `getActiveCampaignName`) **[obs]**; festive app-icon switching (`Change App Icon`, `switch_app_icon`, activity-aliases) **[obs]**.
- Login options: phone+OTP (SMS auto-read, WhatsApp OTP, OTPless zero-tap, Truecaller one-tap, "Call Me With OTP" IVR), Google, **auto-login** from shared account / backup (`AutoLoginScreen`, `auto_login_user`), **guest flow** (`login_guest`, `guest_flow_address_viewed`, `getGuestPaymentLink`) → browse + add to cart before login, "International login is disabled" **[obs]**. Signup variants A/B (`signup_variant`, `fe_login_revamp`).
- Anonymous device token before login (`v1/anonymous-device-token`), app-config + version check (`v1/user/customer/check_update`, in-app update `in_app_update_status`), force policy accept (`v2/user/customer/accept-policy/`) **[obs]**.
- **Frontend experiments service** (`v1/user-app/experiments`, `experimentation-service`, `user_user_variant_hash`) = remote A/B flags per user; internal "Frontend Experiments Editor" screen **[obs]**.

**B. Location and address**
- Serviceability check (`v1/serviceability`, `v2/store/serviceable`, `screen_viewed_unserviceable_store_location`, "Our team is working tirelessly to enable delivery to your location") and store resolution with **multiple store types per location** (`store_etas`, `store_ids`, `is_store_changed`, `primary_resolved_store_id`) **[obs]**.
- Address: Places autocomplete + details + geocode proxied through Zepto (`v1/maps/place/autocomplete`, `v1/maps/geocode`), **address form config from server** (`v1/user/customer/address/form`), address auto-prefill from GPS (`ADDRESS_AUTO_PREFILL_V2`), labels Home/Office/Other, **"Ordering for someone else?" receiver name + phone** (`Add Receiver's Details`, "delivery partner will coordinate directly with the receiver"), **Share Address / Request address from friend** link with share-token (`v1/user/customer/address/share-token`, `address/from-share-token`, `address/duplicate`), **address change prompt** when GPS and selected address differ (`location_mismatch`, `tooltip_to_change_address`, `location_info_distance`), map pin with "Confirm location" **[obs]**.
- Delivery instructions saved per address: No Contact Delivery, "Leave at door", "Don't ring the bell", "Beware of pets", plus **No-Bag Delivery** opt-in (`no_bag_*`, "We have opted you in for no bag delivery") and "Return PET bottles / reuse old bags" to rider **[obs]**.

**C. Home / storefront**
- **Server-driven UI**: `LayoutEngine` / `LMS` (layout-management-service) returns pages made of widgets (`v1/config/layout/layout-widgets/`, `v2/get_page`, `cfs/api/v1/get_page`, `cfs/api/v1/bulk-widget-data`, `cfs/api/v1/widget-refresh`). 200+ widget types observed, e.g. `HorizontalCarouselWidget`, `ProductGridWidget(V2)`, `FourRowsWidget`, `TabbedCarouselV2Widget`, `VideoBannerWidget`, `FlashSaleProductsWidget`, `HighlightedDealsWidget`, `PillCarouselWidget`, `MilestonesWidget`, `QuizWidget`, `PersonalizedOfferWidget`, `TopAdsWidget`, `PremiumContextualAdWidget`, `ToggleWidget`, `StoreMultiTab`, `RiderTabsWidget`, `TrustMarkerWidget`, `InfoCardWidget`, `SpacerWidget`. Layout cached + **prefetched natively** (`PREFETCHED_HOME_LAYOUT`, `home_cache`, `loaded_from_cache`, `is_page_cached`) **[obs]**.
- **Marketplace tabs / multi-tab storefront**: "Zepto Now" vs "Super Saver" (and Ultra Saver, Cafe) as switchable marketplaces with their own cart pricing ("Price with Super Saver is", `ss_price_compare_*`, `switch_and_save`, `MarketPlacePriceDiffModal`, `ZNtoSSPriceComparisonModal`, `CartMarketPlaceToggle`) **[obs]**. Zepto Select / premium toggle (`ZeptoSelectToggle`, `premium_toggle_on/off`, `premium_experience_bs`) **[obs]**.
- Stories / video: `FlickView` (short vertical videos, PIP, shoppable, `pip_video_*`, `shoppable_pip_carousel_viewed`), `zepview_story`, UGC content page, Lottie everywhere, festive themes (Diwali/IPL loaders, `header-festival.json`) **[obs]**.
- **Ads**: sponsored product cards and banners via GAM + in-house ads-service (`ad_click`, `is_boosted`, `boosted_pvids`, `map_ads_banner` even on the order-tracking map) **[obs]**.
- Gamification: Colosseum campaign engine (`gamification-service/api/v1/colosseum-config`, rule-matched campaigns rendered in a WebView), scratch card (`ScratchReveal` native view), spin-the-wheel, quiz widget, milestones/streaks, coupon unlock animations, IPL campaign, Secret Santa / Rakhi message sender **[obs]**.
- Home **Rain mode** ("Heavy rainfall. Higher Delivery Time Due To Rainfall", `rain_stand_still_mode.mp4`, `raining_delivery`) and **surge** messaging with "Save on Surge/Rain Fee" via Super Saver / Pass; "Surge end notification request registered" = notify-me-when-surge-ends **[obs]**.
- "Order limit for today" (`You've reached the order limit for today`), restricted products (tobacco age gate: rider checks PAN/Aadhaar; `declare-minimum-age`), **cart weight limit** ("Cannot update: Cart weight limit reached") **[obs]**.

**D. Browse, search, product**
- Categories → subcategory pages with **anchor tabs** (`aisle_anchor_tab`, `sub_cat_navbar`), category FAB to jump categories (`change_category_via_fab`, `DealsFabWidget`) **[obs]**.
- Search: pre-search page with topics/trending/recent (`v2/pre-search`, `v1/presearch-topics`, `v1/recommendations/pre-search`), autosuggest with live ranker (`autosuggestion_live_ranker_meta`, `inhouse_autosuggestion_index_used`), **filters and sort** (`v3/search/filters`, `filter_srp_*`, `FilterBottomSheet`, `v1/bottom-sheet-filters`), **bulk search** (`v3/search/bulk-search` used by shopping list), brand search, related searches, out-of-stock search widget, "Search Assist" guide, **voice "Ask AI" shopping assistant** ("Tap the mic button… Try saying 'Find me milk'", `api-india.cartesia.ai` for TTS **[inf]**), **shopping list** (type a list or **scan a handwritten list with OCR** → bulk add) **[obs]**.
- Product card: variants/rollups inline (`PRODUCT_VARIANT_ITEMS_SELECTION`, `VariantSelectionNudge`, `rolled_up_products`, `nos_rollup_options`), ETA on card (`item_viewed_eta_in_minutes`), tags, "AI Auto Add to Cart", campaign ATC button, ATC shimmer, **Swap & Save** (swap to a cheaper/Super-Saver equivalent, `organic_swap_bottom_sheet`, `swap_and_save`) **[obs]**.
- PDP: image gallery + video, key highlights, **ratings & reviews with photos, AI review summary, filters, helpful votes** (`RatingsAiSummaryWidget`, `v1/reviews/vote`, `v1/product-reviews/media`), **Review & Earn Z-Coins** for text/photo reviews, seller info (name, address, licence no. for marketplace), **Frequently Bought Together / Similar / Alternative items** (`recommendation-service`, `v1/inventory/catalogue/cross-sell-recommendations`), **Notify Me** when back in stock (`v1/inventory/catalogue/notify-on-stock-replenishment/`, `stop_notify_me`, "Back in stock" lottie), **Wishlist** (`wishlist-service`, move OOS/unserviceable cart items to wishlist), share product (`product_card_preview_share`), "Suggest a Product", brand page, dietary veg/non-veg/egg markers, customization for variants (`v1/customization-for-product-variant`), "Try and Buy" + "Open Box Verification" + "Doorstep Quality Check" badges, EMI/no-cost-EMI strip on PDP for high-value items **[obs]**.
- Recipes tab (`recipe-service`, `v1/recipe/search-products`, "Recipes tabbed carousel") **[obs]**.
- Pharmacy: category with prescription upload, pharmacist/doctor verification, telemedicine consult opt-in, password-protected PDF support (`NativePdfPasswordChecker`) **[obs]**.
- Print: `printing-service`, `v1/files/upload-request|status|preview|unlock|config`, B&W/colour, auto-detect B&W doc, low-resolution warning, page limit, password-protected files, "deleted from servers after printing", PIP preview **[obs]**.
- Electronics **device exchange** (IMEI, condition check app installed by rider, exchange value) **[obs]**; E-gift cards / digital vouchers (`v1/giftcard`, `voucher-service`) and gift bag / gift packing at checkout; "Gift Finder with AI" **[obs]**.

**E. Cart and checkout**
- Cart is server-side with **cart-federator (CFS)**: `v3/cart`, `cfs/api/v1/cart`, coupons list/apply/remove, `get-plans` (EMI), `slot-selection`, `widget-action`; cart page itself is widget-driven (`cart_layout_missing`, `CartInlineInfoWidget`, `UpsellProductCarouselWidget`, `OosRecommendationWidget`, `FTBBundlesWidget`, `GiftItemPickerWidget`, `NoBagDeliveryStripWidget`, `RiderTipsTab`, `DeliveryInstructionsTab`) **[obs]**.
- Cart features: free-delivery / MOV progress strip (`active_mov_strip_*`, `minimum_amount_needed_bottom_sheet`), **BxGy** offers with milestone widgets, coupons + **Promo Cash** + **Zepto Cash** wallet + **Z-Coins** redemption toggles, **Daily / Loyalty Pass upsell** in cart (`loyalty_pass_add_to_cart`, free trial, renewal), **rider tip** with presets, custom tip, "apply this tip for future orders", delivery instructions, no-bag toggle, **GST details** for invoice (`v1/customer/gstin`), **price-change popup** before order ("The bill total for your cart has been updated"), item-level max-quantity and weight limit, restricted items sheet, OOS items sheet with "move to wishlist", bill breakdown with convenience/surge/rain/tax lines (`checkout_info_*`), "You save" / savings widget, cart persistence + migration across store change (`refresh_cart_store_changed`, `stale_cart_cleared`) **[obs]**.
- Checkout / payment (**IPP = in-house payment page** `v1/ipp`, `v2/ipp` on top of Juspay): UPI intent to any app, **saved UPI / "1-click UPI"**, UPI collect, in-app UPI PIN (NPCI lib), cards with tokenisation (RBI), **QuickPay** one-tap repeat payment, wallets, **Pay on Delivery via Cash or UPI** (rider shows QR: "Ask the delivery partner for QR code"), **COD double-confirmation**, **Auto-COD fallback** when PG is down ("You may place a cash-on-delivery order", `auto_cod`, `payments_fallback_shown`), **EMI / No-cost EMI** with bank plans, **BNPL** (Simpl + **Zepto Pay Later** with KFS and repayment link), **AutoPay mandates** for Pass (pause/resume/revoke), payment offers (`v1/payment-gateway/offer-eligibility`), payment retry, "Reinitiate payment", instant checkout (`INSTANT_CHECKOUT`, `buy_now`), Amazon Pay **[obs]**.
- **Scheduled delivery / pickup slots** (`PICK A TIME SLOT`, `PickupSlotSelector`, `cfs/api/v1/slot-selection`, "Order Scheduled Successfully") **[obs]**.
- Order creation `v3/order`, idempotency (`same_order_idempotency_id`), throttling (`order_creation_throttled`), "Please order once your previous order gets delivered" (one live order rule, configurable) **[obs]**.

**F. Post-order**
- Order tracking page is **widget-driven too** (`pfs-postorder/api/v1/get-page/{page_type}`, `OrderTrackingWidget`, `ShipmentDetailsWidget`), polling with server-controlled interval (`order_polling_interval_changed`), **live rider location on map with animated polyline** (`updateRiderLocation`, `rider_location_animate`, `map_v2_load_event`), status lotties ("ARRIVING IN", "ARRIVED AT YOUR GATE", "ON THE WAY", `arrived_festival`), **ETA with "slightly delayed" states** and the Jan-2026 policy copy "Delivery partners are not informed about promised delivery time / No penalties for late deliveries" **[obs]**.
- **Add items after ordering** ("Forgot something?", `post-order-service/api/v1/orders/{orderId}/poia`, `PostOrderItemAdditionWidget`, time-boxed `time_expired_coachmark_viewed_poia`) **[obs]**.
- Rider: **call via virtual number** (`rider-virtual-phone-number`), **rider chat** (`rider_chat`, `chat-service`, `v1/conversation/poll`), rider safety info, delivery OTP shown with "Don't share OTP if there's an issue" (OTP = acceptance), **doorstep quality check / open-box / try-and-buy** acceptance flow **[obs]**.
- Cancel: self-cancel with reasons, auto "self canceled as eta breach time reached", cancel-exchange; order "recreate" (`recreate-order`) and **Order Again** / **Buy Again products** (`v1/buy-again-products`, `buy_again_group_recommendations`) **[obs]**.
- Rating: order rating v3 (emoji 1–5, tags per product, text), delivery rating, product rating with photos + Z-coin reward, in-app Play rating prompt (`v1/user/customer/app-rating-dialog/`) **[obs]**.
- Issues / support: **self-serve "Have an issue with your order?"** → select items, select issue, describe, **upload photos**, **instant refund** (`Get instant refund`), replacement flow (`initiate-replacement`, `verify-replacement`), **refund status page** with RRN and chargeback guidance (`v1/user/customer/refunds`, `Your Refunds`), credit notes for GST, **tickets** (`crm-ticketing`, `v1/tickets`, `v1/tickets/count`, "My queries"), **chat with support** (`v1/chat-url`, `ActiveConversationsWidget`, `cs_chat_blocker_page`), FAQ from config (`v1/config/faq/`), call/email fallback **[obs]**.
- Invoice: download invoice / credit note (`invoicing-service`, `/streaming-invoice/`), GST invoice with IRN **[obs]**.
- Notifications: "Falcon" SDK = **server-templated rich notifications** (image layouts chosen by experiment, repeat/reminder workers, removal worker, silent push for data sync, dismiss tracking), **arrival notification**, delivery alerts channel, gift/IPL channels, push-primer screens on order tracking, WhatsApp opt-in for updates **[obs]**.

**G. Account, money, loyalty**
- Profile: orders, addresses, **Zepto Cash wallet** (add money, top-up via gift card, expiring cash, `wallet-service`, `v1/wallet/recharge`, `direct-debit-wallet`), **Z-Coins** (earn for reviews, redeem at checkout, ledger `v1/coin/*`), **Promo Cash** (restricted credit), **Rewards / coupons earned** (`rewards-service`, `RewardsListScreen`), **referrals with contact-book invites and events/winners** (`v1/referrals/*`, "Get coupons worth ₹1000 on ten referrals", "25% off for you, 25% off for them"), **Daily Pass / Loyalty Pass** (member price vs non-member price on cards, free trial, auto-renew mandate, savings split, expiry nudges), saved payment instruments management (`v1/payment-management`, link/delink UPI, make primary), GST details, delete account, logout, app-icon change, notification settings, "Suggest a product", Help & Support, Review & Earn tab, E-gift cards, refunds page, transaction history **[obs]**.

**H. Internal / developer tooling that ships in prod (hidden behind internal-user flag)**
- Chucker network inspector, API spoofer / URL rewrite / timeout override, perf overlay HUD (JS/UI FPS, frozen frames, CPU, memory), jank alerts, performance-mode override, frontend-experiments editor, layout JSON preview, Lottie layer text override, event data modal, "Shadow tracker" (compares old vs new analytics pipelines: `shadow_event_mismatch`), screenshot-to-feedback, Arkon gesture recorder, in-app logs screen **[obs]**.

### 3.3 Zepto — how they make it fast and resilient (the "efficiency" findings)

1. **Native API prefetch before JS boots** **[obs, decompiled]**: `MainApplication.onCreate` and `MainActivity.onCreate` kick off coroutines (`Startup.a/b`, `AutoLogin.j`) that resolve location (`FusedLocation` state machine), read cached auth, and fire the homepage/layout API from Kotlin; `ApiPrefetchTracker` keeps a map `api → {status,data,latency,lat,lng}`; JS calls `LayoutPrefetchModule.awaitAndGetPrefetchResult(key)` which polls (`POLL_INTERVAL_MS`) up to `TIMEOUT_MS` and returns the JSON (or `{status:"timeout"}` plus the coordinates used). Events `pre_fetching_fetch_layout`, `PREFETCHED_HOME_LAYOUT`. Net effect: home layout is in memory by the time React mounts.
2. **Startup instrumentation** **[obs]**: `Startup.h.b("applicationOnCreateStartMs" | "newArchLoadStartMs" | "activityPreSuperEndMs" …)` markers, `app_start_cold/warm`, cold-start classification (`Startup.i/j`), sent to Horizon/Sentry. They measure every phase of startup.
3. **Device performance classes** **[obs]**: `performancemode.performanceClasses.*` + `PerformanceModeModule.getPerformanceResults` → JS picks "Performance mode" (lower image quality, `performance_mode_disables_upsell`, fewer animations, `isScrollOptimisationEnabled`). Low-end phones get a lighter UI, not the same UI.
4. **Jank telemetry** **[obs, decompiled]**: on API ≥ 31 a `jank-collector` HandlerThread registers `FrameMetrics` listeners per activity, reports slow/frozen frames with threshold alerts.
5. **DNS resilience** **[obs, decompiled]** `ZeptoDns`: system DNS first; on failure **DNS-over-HTTPS** via OkHttp `dnsoverhttps`; caches resolved IPs for `*zepto*` hosts; logs `dns_recovered`; interleaves IPv4/IPv6 (Happy-Eyeballs style ordering).
6. **Image pipeline** **[obs, decompiled]**: Coil 3 singleton with OkHttp client shared with RN, **disk cache sized to 10% of free space capped at 1 GB**, 300 ms crossfade; Fresco custom cache-key factory (`FrescoCacheKeyFactory`) so ImageKit URL variants share cache; `zepto_image_metrics` events; images served from ImageKit with on-the-fly resize **[inf from URL patterns]**.
7. **Persistent, encrypted, fast KV** **[obs]**: MMKV (`react-native-mmkv`) + `EncryptedMMKV` with a device-bound DEK; `PersistentStorage` wrapper with error events. No AsyncStorage on the hot path.
8. **OTA JS bundles + server-driven UI** **[obs]**: Airborne/Phoenix deliver new JS without a store release; LMS/CFS deliver page layouts and widget data; experiments service flips features per user. Most "features" are config, not binaries.
9. **Background config sync with cohort-based periodicity** **[obs]** `assets/WorkerConfig.json`: WorkManager job every 24 h for users active in last 72 h, 48 h for 3–7 days, off for dormant users; 50% rollout. Saves battery/network on inactive devices.
10. **Bulk widget hydration** **[obs]**: `cfs/api/v1/bulk-widget-data` fetches data for many widgets in one call; `widget-refresh` refreshes only changed widgets; `useBulkRefetchWidgetData`.
11. **Order tracking polling with server-controlled interval** (`order_polling_interval_changed`, `order_status_polling_stopped`) and **silent push** to trigger refresh instead of tight polling **[obs]**.
12. **Horizon event pipeline** **[obs]**: events queued in SQLDelight, compressed (lz4), batched to `v2/publish-events`, with `demand_monitor_*` and `high/medium/low_latency_operation` buckets → they measure API latency per operation class from the client.
13. **App Shortcuts** (long-press launcher: reorder, search, cart) and **dynamic splash** so the first frame is branded while prefetch runs **[obs]**.
14. **Attestation + WAF tokens cached locally** with retry/backoff so security checks don't block the critical path (`attestation_retry_scheduled`, `waf_challenge_token_ready`) **[obs]**.
15. **Address and store context prefetched natively** (`AppLocationManager`, `FusedLocation` states) so the first API already carries lat/lng **[obs]**.

### 3.4 Blinkit 18.39.1 — PENDING (no APK yet; see "How to unblock" in section 2)

### 3.5 Feature matrix — Zepto (observed) vs Haper (code) — Blinkit column to be filled

| Area | Zepto 26.10.3 | Haper 2.5.6 |
|---|---|---|
| App stack | RN + Hermes, OTA JS, server-driven UI | Kotlin + Compose, fixed screens |
| Login | OTP + WhatsApp/OTPless/Truecaller/IVR, Google, guest, auto-login | OTP, Google |
| Location gate | GPS prefill, mismatch prompt, store ETAs per location | GPS/manual gate, nearest store |
| Address extras | receiver details, share/request address link, instructions, no-bag | labels, village, notes |
| Home | widget layouts, marketplace tabs, stories/video, ads, campaigns | banners, categories, "Fresh picks", wallet strip, print tile |
| Search | pre-search, autosuggest, filters+sort, bulk/list search, OCR list, voice AI | Atlas search, chips, recents, fallback |
| Product | variants/rollups, ratings+reviews+AI summary, FBT/similar, notify-me, wishlist, swap&save | price/MRP/unit price, description |
| Cart | MOV strip, BxGy, coupons+promo cash+wallet+coins, pass upsell, tip, GST, weight limit, price-change popup, OOS→wishlist | coupons, free gift tiers, cart-limit rules, bill, note |
| Payment | UPI intent/collect/1-click, in-app UPI PIN, cards, QuickPay, COD + pay-on-delivery UPI QR, auto-COD fallback, EMI, BNPL, autopay | Razorpay, COD, wallet |
| Schedule | slots + pickup | slots (built) |
| Tracking | live rider on map, ETA states, arrival push, add items post-order, rider chat/virtual number | 5-step timeline, static pin, call rider, OTP |
| Issues | self-serve issue + photos, instant refund, replacement, tickets, chat, refund status page | call/email, cancel, admin edits |
| Loyalty | Daily/Loyalty Pass, Z-Coins, Zepto Cash, promo cash, rewards, referrals w/ contacts | wallet (refund+referral), refer code |
| Ratings | order/delivery/product ratings, review-and-earn | 1–5 order rating |
| Invoice | GST invoice + credit note download | invoice PDF |
| Notifications | templated rich push, arrival, reminders, silent sync, WhatsApp opt-in | FCM status push, per-type toggles |
| Perf | prefetch, perf classes, jank telemetry, DoH, MMKV, image cache policy | offline overlay, retry interceptor, skeletons |
| Verticals | Cafe, Pharmacy, Print, Electronics exchange, Gift cards, Recipes | Print |

### 3.6 Implementation list for Haper (ranked by impact ÷ effort, Android + backend; all backward-compatible, new fields nullable)

**Tier 1 — cheap, high impact (1–3 days each)**
1. **Reorder / "Order again" + "Buy again" rail**: backend `GET /v1/buy-again-products` (last N orders' items, in-stock at current store) + `POST /orders/:id/reorder` → cart lines; Android: button on order detail + Home rail. Fills a known TODO.
2. **Real ETA instead of "20–30 mins"**: backend computes per store (base prep + distance band + live load) and returns `etaMinutes` + `etaLabel` on store/serviceability and on cart; Android shows it on Home header, product cards, checkout; add "Slightly delayed" state on tracking.
3. **Notify me when back in stock**: `item_stock_subscriptions` collection, cron on restock → FCM; Android OOS card → "Notify me" toggle.
4. **Native API prefetch at cold start**: in `SplashScreen`/`MainActivity` start app-config, store resolution and Home layout calls in parallel with Compose init (coroutine `async` in a `StartupPrefetcher` singleton), expose results to the Home ViewModel. Add startup markers (Application.onCreate → first Home frame) to Firebase Perf/Analytics.
5. **Cart price-change confirmation**: server returns `priceChanged[]` on cart fetch before checkout; Android shows a sheet.
6. **Delivery instructions per address** (No contact, Leave at door, Don't ring, Pets) + **No-bag opt-in**: nullable `instructions[]`, `noBag` on address + order snapshot; picker app shows them.
7. **Deep links / App Links**: VIEW intent filters for `haper.in/{item,category,order}` + `haper://`; makes push, WhatsApp and banner links open the right screen.
8. **Rider tip** at checkout with presets + custom, goes to rider payout ledger (reuse wallet ledger pattern).
9. **"Ordering for someone else" receiver name+phone** on address/order snapshot; rider app dials receiver.

**Tier 2 — medium (1–2 weeks each)**
10. **Live rider tracking**: delivery app posts location every 5–10 s while OUT_FOR_DELIVERY → Redis GEO/latest; customer polls `GET /orders/:id/rider-location` at a **server-provided interval** (existing Redis pub/sub + SSE can serve admin; customer can poll); animate marker on the existing map.
11. **Self-serve order issues**: "Have an issue?" → pick items, issue type, photos (S3 presigned, reuse print upload), description → ticket + auto-approval rules for small refunds to wallet (instant refund); refund status screen listing all refunds with reference ids.
12. **Product variants** (already specced in `design-product-variants.md`): follow Zepto's model = separate sellable items grouped (`rolled_up_products`), "N options" pill, variant bottom sheet; server returns `variants[]` on list payloads so no extra call.
13. **Ratings & reviews on products** with photos, helpful votes, and **coins/credits for reviews** (small wallet credit).
14. **Search filters + sort** server-side (price, brand, discount, veg/non-veg, in-stock) + pre-search page (trending, recent, categories).
15. **Add items to a placed order** until picking starts: `POST /orders/:id/items` allowed while status OPEN/PICKING-not-started; picker gets an "added items" flag.
16. **Rich notification templates + arrival/reminder pushes**: server-side template id + image; "rider arriving" and "scheduled order reminder" already partially exist via cron.
17. **Wishlist** (server-side, move OOS items there automatically).
18. **Recommendations v1**: frequently-bought-together from order co-occurrence (nightly cron into `item_recommendations`), "similar items" by category+price band; show on PDP and empty-search.
19. **Pay-on-delivery via UPI QR** in the delivery app (static VPA QR + rider marks paid) and **auto-switch to COD when Razorpay is down** (already have switch-to-COD; add gateway health check to show it proactively).
20. **Scheduled-delivery pickup option** (store pickup slots) if stores want it.

**Tier 3 — strategic (multi-week, decide first)**
21. **Membership / pass** (free delivery + member prices) with autopay — needs pricing model.
22. **Server-driven Home** (JSON widget list from admin: banner, rail, grid, offer strip) so marketing can change Home without a release; keep Compose renderers per widget type.
23. **Performance mode for low-end devices**: detect RAM/class (`ActivityManager.isLowRamDevice`, `Build` class) → smaller images, no animations, fewer rails.
24. **In-app chat** with support (and rider) via a simple conversation API + polling, or WhatsApp deep link as the cheap version.
25. **Wallet top-up + refund to source**: Razorpay refunds API for online payments (currently wallet-only).
26. **Guest browsing before login** (anonymous device token) to cut signup friction.
27. **OTA-like config**: expand app-config (already exists) into a remote feature-flag + copy service so Android reads flags on start; A/B by user hash.

### 3.7 What NOT to copy (yet)
- Ads SDKs, Sentry profiling at 100%, 70+ microservices, BNPL/EMI, device exchange, Cafe/Pharmacy verticals, contact-book referral scraping (privacy + permission friction), SMS permissions (Play policy risk), WAF/attestation (no bot problem yet).

### 3.8 Evidence index (REA / tools)
- `inspect_android_package` summary: ev_ecc8f42c… (parent ev_96a56ef2…) — manifest, permissions, counts.
- `search_android_classes "zepto"`: ev_6b3b5612… — first-party native module inventory.
- `inspect_android_class`: ApiPrefetchTracker ev_adf4a41e…, LayoutPrefetchModule ev_aede0e44…, SharedCredentialManager ev_1739863e…, ZeptoDns ev_790bffcd…, DynamicSplashScreenModule ev_d19f893a…, AppShortcutsModule ev_6c88bc9c…, MainActivity ev_4886e0b8…, PerformanceModeModule ev_c984408d…, AppServiceStarterModule ev_7e5959bf…, PhoenixUpdateManager ev_8f5f3b4b….
- `inspect_android_method`: ZeptoDns.a ev_143da8bf…, MainActivity.onCreate ev_30a2d6c5…, MainApplication.onCreate ev_14bd67df…, LayoutPrefetchModule.awaitApiResult ev_93283a29….
- apktool `d --no-src` of base APK → `AndroidManifest.xml`, `res/values/strings.xml` (543 strings, mostly SDK), `res/xml/*`, `assets/*` (Juspay configs, WorkerConfig.json, manifest.json, npci rules).
- Hermes bundle parsed with hermes-dec 0.1.8 (`hbc-file-parser`): 31,977 string literals + 52,207 identifiers → bucket files in scratchpad `hermes/zepto/b_*.txt`, `ui_*.txt` (routes 202, API-like paths 420, endpoint fragments 205, services 72, snake_case events 1,923, flag-like 292, UI copy 5,662).
- dexdump class list (24,170 descriptors) → SDK inventory by package.
- Limitations: static only; no network capture; obfuscated Kotlin names (`a`, `b`…) for most first-party classes; JS bundle is bytecode (no source), so flows are reconstructed from strings/routes/events; some strings may belong to dead or experiment-only code paths.

## 4. Sources (public)
- Play listings: https://play.google.com/store/apps/details?id=com.zeptoconsumerapp , https://play.google.com/store/apps/details?id=com.grofers.customerapp
- Zepto fees Nov 2025: https://upstox.com/news/business-news/latest-updates/zepto-scraps-all-handling-surge-fees-how-does-it-stack-up-against-instamart-and-blinkit/article-183964/
- Zepto Club / retention: https://inc42.com/features/zeptos-retention-play-fewer-discounts-premium-carts-a-paid-club/
- Zepto Select: https://www.storyboard18.com/amp/brand-makers/zepto-launches-select-premium-grocery-service-ahead-of-ipo-zepto-select-grocery-service-ipo-ws-l-104233.htm
- Zepto Pay Later / Real Lens: https://www.indianretailer.com/news/retail-india-news-zepto-unveils-pay-later-and-real-lens-users
- Fee comparison 2026: https://rozmo.in/vs/blinkit-vs-zepto/ , https://rozmo.in/delivery-charges/
