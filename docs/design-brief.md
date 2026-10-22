# KZero Onboarding Portal Design Brief

## Available references

Local KZero-owned design references are now available in:

- `/design/screenshots/chrome_eoNLzb8OR7.png`
- `/design/screenshots/chrome_f6WvVl03G1.png`
- `/design/screenshots/chrome_hohrOCOXKv.png`
- `/design/screenshots/chrome_v6hmYVgRs6.png`
- `/design/screenshots/chrome_zW61RalOuY.png`

## Current approach

The portal route now follows the available references conservatively by reusing these patterns:

- black top chrome
- dark blue hero banners with soft gradient depth
- light, structured information cards with rounded corners
- compact utility pills and CTA buttons

## Portal logo standard

- Use the official horizontal KZero Passwordless logo directly on dark navy surfaces.
- Render the monochrome logo in white at approximately 180px wide without a white tile, chip, or container.
- Keep the logo left-aligned, preserve its aspect ratio, and use consistent spacing around it.
- Reuse the shared `KzeroLogo` component across admin, MSP, customer, report, and related internal portal headers.
- Use a light-surface treatment only when a page has a specific documented reason to deviate.

## TODO

- Add screenshots from `partners.kzero.com` that show authenticated onboarding and task workflows specifically, not just knowledge-base pages.
- Add an approved SVG version of the KZero Passwordless logo if one becomes available.
- Confirm Microsoft Bookings URL targets and CTA copy.
