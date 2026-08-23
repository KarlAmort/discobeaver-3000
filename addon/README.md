# 🦫-3000->🪩

`addon/` is the canonical Manifest V3 source for Safari on macOS, iOS, and iPadOS and for Chromium browsers.

The extension discovers HTML video elements, adds scene analysis and previous/next scene controls, and optionally connects those actions to system media controls through the Media Session API. Its on-device replay model separates first-pass exposure from repeated viewing and backward-seek dwell, then shows the strongest personal replay point without using YouTube's private heatmap data.

The extension reports only its own lifecycle, failures, scene counts, and timing or resource measurements to `https://3000.amort.berlin/fireservice/report`; it does not report page URLs, titles, media URLs, pixels, replay observations, or browsing history. Replay aggregates remain in local extension storage under a truncated SHA-256 media key.

## Browser package

Run `scripts/addon`; the command tests and lints the source before writing `build/discobeaver-3000-VERSION.zip`.

Load `addon/` unpacked in Chrome during development, then submit the verified zip to the Chrome Web Store.

## Apple companion apps

On a current Mac, run `xcrun safari-web-extension-packager addon` and choose a multiplatform Swift project with bundle identifier `berlin.amort.discobeaver-3000`; the packager creates the containing macOS and iOS/iPadOS companion apps and extension targets from this same directory.

The same package can instead be uploaded to the Safari Extension Packager in App Store Connect, which creates macOS and iOS apps without local Xcode.

Use one paid-upfront App Store record with universal purchase, SKU `discobeaver-3000-universal`, and the 1024-pixel source at `icons/1024.png` for the containing apps.

The App Store seller name comes from the enrolled legal entity and cannot be replaced by product metadata; use `🦫-3000->🪩` wherever App Store Connect accepts the product or developer display name, and `discobeaver-3000` where `>` is rejected.

Apple requires an Apple Developer Program membership and signed containing apps for device tests, TestFlight, and App Store distribution.

## Sources

- [Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
- [Packaging a web extension for Safari](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)
- [Distributing your Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)
