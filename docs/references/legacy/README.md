# Legacy Source Archive

This directory preserves the files from `Blueshield网站设计/` that did not already have an exact copy in the root site before that obsolete folder was retired.

## Contents

- `artwork/`: seven unique reference or unused legacy PNG files.
- `source/site.js`: the pre-root-migration JavaScript implementation.
- `source/visual-2026.css`: the pre-root-migration visual override stylesheet.
- `archive-manifest.json`: expected size and SHA-256 for every preserved file.

These files are reference and recovery material only. The runnable site must load files from the project root and `assets/`; it must not depend on this archive.

## Deliberately Not Archived

- The eight HTML entry pages, `styles.css`, and 29 runtime images were already present in the root site with identical SHA-256 content.
- The four top-level transparent product images were already preserved as `assets/products/atlas.png`, `dolphin.png`, `meridian.png`, and `scout.png` with identical SHA-256 content.
- The requirements document is already available as `/网站.docx`.
- `~$网站.docx` is a temporary Microsoft Word lock file and has no recovery value.

The current root `site.js` and `visual-2026.css` remain authoritative. Do not replace them with the historical copies in this archive unless intentionally restoring the pre-migration implementation.
