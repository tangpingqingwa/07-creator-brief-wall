# Design QA — claim control alignment, iteration 2

## Evidence

- Source visual truth: `/Users/yann/outbid-verticals/07-creator-brief-wall/artifacts/design-qa/claim-line-source-r2.png`
- Density-normalized source: `/Users/yann/outbid-verticals/07-creator-brief-wall/artifacts/design-qa/claim-line-source-normalized-1200x745.png`
- Browser-rendered implementation: `/Users/yann/outbid-verticals/07-creator-brief-wall/artifacts/design-qa/claim-line-after-desktop-1200x745.png`
- Mobile implementation: `/Users/yann/outbid-verticals/07-creator-brief-wall/artifacts/design-qa/claim-line-after-mobile-390x844.png`
- Full comparison, source left and implementation right: `/Users/yann/outbid-verticals/07-creator-brief-wall/artifacts/design-qa/claim-line-comparison-full.png`
- Focused claim comparison, source left and implementation right: `/Users/yann/outbid-verticals/07-creator-brief-wall/artifacts/design-qa/claim-line-comparison-focused.png`
- State: honest empty rolling-seven-day wall; light plaster/paper theme.
- Desktop viewport: `1200 x 745` CSS px at density `1`. The `2400 x 1664` source included `174px` of browser chrome; its `2400 x 1490` page region was cropped and downsampled to `1200 x 745` before comparison.
- Mobile viewport: `390 x 844` CSS px at density `1`; implementation screenshot is `390 x 844` pixels.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Fonts and typography: the serif wall hierarchy and bid treatment are unchanged; only the heading item's cross-axis alignment was corrected.
- Spacing and layout rhythm: the label-to-minus gap is `4px` instead of `7.1953125px`; their center-line delta is `0.00390625px` instead of `4.04296875px`.
- Colors and visual tokens: unchanged; plaster, paper, ink, bid red, line, tape, and shadow tokens remain intact.
- Image quality and assets: no image, logo, illustration, icon, or generated asset was added or replaced.
- Copy and content: unchanged; the live fixture remains the truthful `$5` empty-wall state.
- Responsiveness: at `390 x 844`, the label and stepper remain on one line with a `4px` gap, `0px` center delta, contained glyphs, and `0px` horizontal overflow.
- Interaction: increase and decrease were exercised from `$5 → $6 → $5`; state restored correctly. Browser console errors: none.

## Comparison History

1. Earlier P2 — the minus and plus glyphs inherited the large heading size and exceeded their `21px` client boxes.
2. Earlier fix — made each step button a fixed inline-flex container with zero padding, a scoped font size, centered content, and contained paint; both client and scroll boxes became `21 x 21px`.
3. Current P2 — baseline alignment left the label center `4.04296875px` above the minus box and the gap measured `7.1953125px`.
4. Current fix — changed the claim heading to `align-items: center` and reduced its column gap to `0.25rem`.
5. Post-fix evidence — focused and full comparisons show the paper card and typography unchanged while the label and both controls share one center line; desktop and mobile remain overflow-free with both glyphs contained.

## Open Questions

- None for this scoped alignment correction.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 137 passed, 0 failed.
- `GET /healthz`: passed.
- `git diff --check`: passed.
- Desktop/mobile Chrome captures, stepper interaction, glyph containment, overflow, and console checks: passed.

## Implementation Checklist

- [x] Keep minus and plus inside their square buttons.
- [x] Align `Claim #1 for` with the button boxes.
- [x] Tighten the label-to-minus gap.
- [x] Preserve the Creator Brief Wall skin and responsive card.

## Follow-up Polish

- None required for this scoped correction.

final result: passed

## Maker contact footer · 2026-09-01

- Source visual truth: `/var/folders/wr/2073jwr96_q68h23sfdqtvf00000gn/T/codex-clipboard-856d0520-4293-4865-a587-ff7cf0f23936.png` (`2400 x 1664`, browser chrome included).
- Browser-rendered implementation: `/Users/yann/chat2/artifacts/design-qa/2026-09-01-maker-footer/07-desktop.jpg` (`1185 x 680`) and `/Users/yann/chat2/artifacts/design-qa/2026-09-01-maker-footer/07-mobile.jpg` (`375 x 812`); Chrome target was `390 x 844` with scrollbar space removed. Focused crops appear in the shared comparison sheets.
- State: creator brief wall, rules note visible, maker-email link keyboard-focused.
- Full-view evidence: the author contact is rendered as a taped paper colophon below the wall, preserving the site's physical-poster language.
- Focused evidence: one marker per public document; exact copy/href; `2px` red focus outline; desktop/mobile horizontal overflow `0px`.
- Required surfaces: serif wall typography, paper/tape spacing, tan/red tokens, and public copy remain coherent; the tape is an existing CSS surface motif rather than a substituted source asset.
- Findings: P0 `0`, P1 `0`, P2 `0`; the source badge/legal links are outside this email-contact request.
- Comparison history: pass 1 found no actionable P0/P1/P2 issue; no visual correction was needed.
- Regression: `140/140` tests passed; payment/provider behavior was untouched.

final result: passed

## Prelaunch public-copy cleanup — 2026-08-31

- Chrome routes checked: home, About, and Rules at the normal desktop viewport and `390 x 844`.
- Public copy contains no clone, development, test-fixture, internal field-name, or payment-provider implementation language.
- Claim controls share one visual centerline; amount decoration is clean and the step buttons stay inside their boxes.
- Responsive result: no horizontal document overflow on any checked route.
- Regression result: `npm test` passed `137/137`; `git diff --check` passed.
- Payment behavior remains unchanged; customer-facing wording is provider-neutral while Waffo stays internal.

---

# Design QA — dollar underline removal (2026-08-31)

## Evidence

- Source visual truth: `/var/folders/wr/2073jwr96_q68h23sfdqtvf00000gn/T/codex-clipboard-c7a079c8-3b1a-4024-ae1e-ae43d1ab390b.png`
- Single source-versus-render comparison: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/comparison-source-vs-ten-sites.png`
- Creator brief desktop render: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/4217-desktop-full.png`
- Creator brief mobile render: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/4217-mobile-full.png`
- Focused desktop amount crop: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/4217-desktop-amount.png`
- Focused mobile amount crop: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/4217-mobile-amount.png`

## Findings

- No actionable P0, P1, or P2 findings remain for this scoped correction.
- The dollar sign and numeric value render with `text-decoration-line: none`; the amount wrapper and input both have `border-bottom-style: none` and `border-bottom-width: 0px`.
- Existing typography, spacing, buttons, project skin, and Waffo payment behavior are unchanged.
- Existing keyboard focus selectors remain in place; only the persistent dashed amount decoration was removed.
- At `390 x 844`, the amount control remains inside the viewport with no horizontal overflow.
- Increase/decrease interaction passed: `$5 → $6 → $5`.
- Chrome console errors: `0`.

## Comparison History

1. Source defect — a dashed line appeared directly below the dollar amount.
2. Fix — removed the amount wrapper/input underline or dashed bottom border without changing form geometry.
3. Post-fix evidence — desktop and mobile crops show the amount cleanly, while controls stay aligned and interactive.

## Verification

- `npm test`: passed, 0 failed.
- `git diff --check`: passed.
- Chrome desktop computed-style check: passed.
- Chrome `390 x 844` responsive computed-style and containment check: passed.
- Chrome amount stepper interaction and console checks: passed.

## Follow-up Polish

- None required for this scoped correction.

final result: passed
