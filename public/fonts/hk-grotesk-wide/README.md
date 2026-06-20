# HK Grotesk Wide (self-hosted)

Primary UI font for JRC Race Engineer. **SIL Open Font License 1.1** — free for personal and commercial use.

## Download (true Wide variant)

1. Get the **free Desktop Font Family** from [Hanken Design Co.](https://hanken.co/collections/free/products/hk-grotesk-wide) ($0 — add to cart, checkout).
2. Unzip the OTF files (7 styles: Light through Black).
3. Convert each OTF to WOFF2 (e.g. [fonttools](https://github.com/fonttools/fonttools): `pyftsubset font.otf --output-file=HKGroteskWide-Regular.woff2 --flavor=woff2`, or any OTF→WOFF2 converter).
4. Place WOFF2 files in this folder using these names:

| File | Weight |
|------|--------|
| `HKGroteskWide-Light.woff2` | 300 |
| `HKGroteskWide-Regular.woff2` | 400 |
| `HKGroteskWide-Medium.woff2` | 500 |
| `HKGroteskWide-SemiBold.woff2` | 600 |
| `HKGroteskWide-Bold.woff2` | 700 |
| `HKGroteskWide-ExtraBold.woff2` | 800 |
| `HKGroteskWide-Black.woff2` | 900 |

**Note:** Hanken sells a separate **Web Font Family** ($120) with pre-built WOFF2; the free desktop license permits self-hosting converted WOFF2 under OFL.

## Until files are added

The app loads **HK Grotesk** (standard width) via `typeface-hk-grotesk` as a fallback — not the Wide cut. Add the files above for the full Awwwards-style wide grotesk.
