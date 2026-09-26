# AGENTS.md — working rules for the AICG repository

This repository is public and ships as the `ai-code-governance` npm package. Both published
surfaces must stay free of private and machine-specific material.

## Public-surface rules

- Working notes — plans, review and evaluation notes, reports, pilots, and design drafts —
  belong under `local/` only. `local/` is git-ignored and excluded from the npm package.
- Never commit, and never pack:
  - absolute home paths for a personal user directory;
  - private project codenames, internal organization names, or internal repository names;
  - private email addresses or other personal contact details.
- Code comments describe behavior and design generically. Do not cite a private repository, a
  local workspace path, or an internal project as the source of a design.
- Tests and fixtures use neutral names (`member-app`, `sample-web-stack`, and similar), never a
  real project name.
- The npm `files` list in `package.json` is an explicit allow list. npm cannot exclude files
  inside a listed directory with `.npmignore`/`.gitignore`, so never list a broad directory
  that can hold notes.

## Enforcement

`npm run validate` — and therefore `prepublishOnly` — runs `scripts/public-surface-check.mjs`,
which scans both the Git tracked set and the npm pack set. Add machine-local codenames to
`local/public-surface-denylist.txt` (one token per line) or the `AICG_PUBLIC_SURFACE_DENYLIST`
environment variable; never hard-code them in the repository. See
[docs/internal/reference/public-surface-hygiene.md](docs/internal/reference/public-surface-hygiene.md).
