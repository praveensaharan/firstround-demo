# About this copy

This is a demo copy of [praveensaharan/firstround](https://github.com/praveensaharan/firstround),
used by **RoleSpace** (AI Builder Cup 2026) to show role-based AI access on a real codebase.
The original repo is unchanged.

Added for the demo:

- `docs/transcripts/2026-09-candidate-export.md`: a **made-up** interview transcript with a
  **planted prompt injection**, to test that RoleSpace's agents ignore instructions found in files.
  No real candidate data is in this repo.
- `.github/workflows/designer-allowlist.yml`: fails any RoleSpace bot PR (branch `rolespace/*`)
  that touches files outside the designer allow-list (`public/css/**`, `public/**/*.html`).
- Branch protection on `main`: one approving review and the allow-list check are required.
