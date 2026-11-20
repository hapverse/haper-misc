# Android release checks

Run before uploading a new Android build to Play Console.

- ✅ Portrait feature is optional: the merged manifest (`app/build/intermediates/merged_manifests/<variant>/process<Variant>Manifest/AndroidManifest.xml`) or `aapt2 dump badging <apk>` lists `android.hardware.screen.portrait` once, with `required=false`.
- ✅ The app still opens and stays in portrait on a phone and a tablet (rotate the device; the screen must not turn).
- ✅ Play Console no longer shows "Required hardware feature declarations are restricting your app's availability" for `android.hardware.screen.portrait` after the build is uploaded.
- ❌ If the warning returns, check no library or activity re-adds `<uses-feature android:name="android.hardware.screen.portrait">` with `required=true`.

Needs: haper-android commit "fix(manifest): mark portrait screen feature as optional" on dev, shipped in the next Play release (first build after 2.5.7 / versionCode 57).
