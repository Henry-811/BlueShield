# Root Site and Navigation Baseline

Status: complete

## Concept Brief

- Target users: government, enterprise, public-safety, and industrial visitors evaluating Blue Shield Robotics capabilities.
- Core problem: visitors should understand the mission areas, product family, integrated capabilities, industries, and contact paths directly from the global navigation.
- Core concept: a grouped, site-wide capability navigation paired with a specific capability-briefing call to action.
- MVP: the website runs from the repository root; required navigation content is present and usable; contact intent is carried to the contact form; runtime images are grouped under `assets/`.
- Non-goals: changing the homepage animation, redesigning the visual system, replacing the hero layout, connecting the contact form to a backend, or deleting recovery material without a verified archive.
- Key assumptions: the repository root is the canonical deployable surface; unique legacy artwork and the pre-migration JavaScript/CSS are retained in `docs/references/legacy/`; the existing black/blue visual language remains authoritative.

## Unified Language

- Mission: an operational outcome a customer wants to achieve.
- System: an air or marine platform.
- Integrated capability: payload, autonomy/intelligence, or communications/control functionality shared across systems.
- Industry solution: the operating context in which missions and systems are applied.
- Capability briefing: the primary contact action and the exact CTA wording.

## Business Rules

1. The repository root must contain the eight HTML entry pages plus the shared CSS and JavaScript needed to run the site.
2. `Missions` must expose the eight mission names from the approved requirements document.
3. `Air & Marine Systems` must expose three named groups: Air Systems, Marine Systems, and Integrated Capabilities.
4. `Air–Sea Search & Rescue` must be present under Marine Systems and navigate to the matching systems-page section.
5. `Industry Solutions` must use the eight full approved industry names, not shortened variants.
6. `Contact` must expose four enquiry types: capability briefing, demonstration, pilot program, and general enquiry.
7. The blue navigation CTA must read `Request a Capability Briefing` and open the contact page with that enquiry type selected.
8. Runtime imagery must live under `assets/brand`, `assets/products`, `assets/missions`, or `assets/industries` according to its role.
9. Existing animation timing and visual direction must not change in this feature.
10. Unique reference artwork and the pre-migration JavaScript/CSS must remain recoverable through the hash-verified legacy archive; the duplicate nested site is not a runtime dependency.

## User Flows

### Primary flow

1. A visitor opens any site page.
2. The visitor opens a global navigation group.
3. The visitor sees the complete capability taxonomy without first entering an index page.
4. Selecting an item opens the relevant detail page or section.
5. Selecting a contact intent opens the contact page with that intent preselected.

### Alternative flow

- On mobile or touch input, the visitor opens the menu and expands one group at a time.
- Keyboard users tab to a group trigger, open it, navigate its links, and can close it with Escape.

### Recovery flow

- An unsupported `request` query value must not break the contact form; it falls back to `General Enquiry`.
- Missing optional artwork must not make navigation text unavailable.

## Domain Model Impact

There is no database, API, authentication, or persisted domain model. Navigation configuration in `site.js` is the authoritative data source, rendered into the shared header and contact form.

## Acceptance Scenarios

1. Given any root HTML page, when it loads, then all shared CSS, JavaScript, and referenced images resolve without a console or network error.
2. Given the desktop navigation, when `Air & Marine Systems` opens, then the three required groups and all required items are visible.
3. Given the Industry Solutions menu, when it opens, then all eight approved full industry names are present.
4. Given the Contact menu, when a visitor chooses `Arrange a Demonstration`, then the contact page opens with `Arrange a Demonstration` selected.
5. Given the blue CTA, when it is activated, then the contact page opens with `Request a Capability Briefing` selected.
6. Given a mobile viewport, when the menu is opened, then each group can be expanded without relying on hover and all core links remain available.
7. Given keyboard navigation, when focus reaches a menu trigger, then the menu can be opened and closed without trapping focus.
8. Given the legacy recovery archive, when its manifest is verified, then all seven unique artwork files and both pre-migration source files match their recorded byte lengths and SHA-256 digests.
9. Given explicit deletion approval and a verified archive, when the obsolete nested folder is retired, then the canonical root site and its tests continue to work without that path.

## Design Plan

- Change goal: make the repository root directly deployable and align the global navigation with the approved taxonomy.
- Impacted surface: root HTML/CSS/JavaScript, runtime asset paths, the shared header, systems anchors, and contact-form intent selection.
- Placement: deployable files live at the repository root; runtime images are grouped by visual role under `assets/`; feature documentation lives under `docs/features/`; non-runtime recovery material lives under `docs/references/legacy/`.
- Dependency direction: HTML loads shared CSS and `site.js`; `site.js` owns navigation data and DOM rendering; assets remain passive dependencies.
- Alternative rejected: deleting the nested source before identifying and archiving unique files would lose reference artwork and the only pre-migration JavaScript/CSS copies. The accepted strategy preserves those files with a hash manifest before any separately confirmed deletion.
- Verification: structural Node tests, referenced-asset checks, local-browser desktop/mobile interaction checks, keyboard checks, and an independent final-tree review.

## Invariant Ledger

| Invariant | Authoritative source | Lock/transaction | External projection | Frontend state | Regression verification |
|---|---|---|---|---|---|
| Navigation labels and grouping match the approved taxonomy | `site.js` navigation arrays | Not applicable; static files | Rendered global header | Open group and `aria-expanded` state | Structural test plus browser menu inspection |
| Every runtime asset reference resolves inside root `assets/` | CSS and `site.js` asset paths | Not applicable | Browser image/CSS requests | Image load state | Asset-path test plus browser console/network check |
| Contact intent survives navigation to the form | Contact option value and `request` query parameter | Not applicable | URL query contract | `#requestType` selected value | Structural test plus browser navigation scenario |
| Legacy recovery material remains intact | `docs/references/legacy/archive-manifest.json` | Not applicable; immutable reference files | None | None | Manifest path, size, and SHA-256 verification |

## Test Plan

| Scenario source | Risk | Level | Coverage |
|---|---|---|---|
| Root pages and asset organization | data integrity | integration/static | Parse source references and assert every local runtime file exists |
| Legacy recovery archive | data integrity | integration/static | Verify every manifest path, byte length, and SHA-256 digest |
| Obsolete nested path retirement | data integrity / R8 | integration/static | Assert the duplicate source folder is absent after explicit approval and the root site remains self-contained |
| Approved menu labels and groups | happy path | integration/static | Assert canonical labels and grouping markers in `site.js` |
| Contact request mapping | boundary | browser/manual | Verify each supported query value and the invalid-value fallback |
| Desktop menu interaction | happy path | browser/E2E | Open each menu and inspect visible items and links |
| Mobile/touch navigation | boundary | browser/E2E | Use a narrow viewport, open the drawer, and expand groups without hover |
| Keyboard behavior | accessibility | browser/manual | Tab through triggers and links; verify Escape closes the open group |
| Animation non-goal | regression | visual/manual | Compare animation names and durations before and after the change |

## Verification Results

- `node --check site.js`: passed.
- `node --test tests/site-structure.test.mjs`: 7/7 tests passed, including legacy archive integrity and obsolete-path retirement.
- Desktop browser checks: passed at 1280, 1200, 1181, 1180, 1024, and 921 px without horizontal overflow or navigation overlap.
- Mobile browser checks: passed at 920 px and 390×667; the drawer scrolls to every link and CTA, submenu state resets across the breakpoint, and touch targets are at least 44 px high.
- Interaction checks: hover/click opening, Escape focus restoration, outside-click closing, and contact-intent query selection passed.
- Runtime checks: all rendered images loaded, all systems anchors resolved, and the browser console was empty.
- Animation regression check: the homepage background remains `matrixDrift 24s`; the title remains `typeTrackIn 0.8s` with the original stagger.
- UI detector: `site.js` returned no findings. CSS warnings matched the retained legacy stylesheet and were intentionally not redesigned in this animation-deferred, preserve-the-original-aesthetic scope.
- Independent navigation/accessibility review: no blocking findings.
- Obsolete-folder retirement: after separate user approval, `Blueshield网站设计/` was sent to the Windows Recycle Bin; the archive remained intact and the local root preview continued to return HTTP 200.
