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

## Confidential development and release

- The repository owner authorizes public distribution of the current implementation.
- Working notes, private records, and machine-specific material remain under ignored `local/`
  paths and must never be committed or included in a published package.
- Check any applicable local confidentiality policy before disclosing newly restricted material.
- Treat roadmap designs as unimplemented until current code and verification evidence prove
  otherwise. Never convert a design, prototype, or expected effect into a product claim.
- A release requires explicit owner authorization and current verification evidence; an AI
  assistant, passing test, implementation commit, or release plan cannot grant that authority.

## Productization team

- For AICG productization work, read `local/governance/productization-team.md` when present.
  It records the owner-approved role pool and on-demand assignment rules. Role slots are not
  named employees, automatic agent delegation, independent review evidence, or human sign-off.
- In the first substantive assistant response to each user turn, state the active analytical
  role or roles and why they were selected. Disclose material role changes before continuing.
- Put the role statement on the first line as `Active roles: role-id (reason)`, or
  `当前角色：role-id（原因）` in Chinese. Give every active role its own reason and use the same
  format before continuing after a material role change.
- For local AICG execution, follow `local/governance/local-aicg-source.md` when present; use
  the active development checkout rather than inferring freshness from the npm version string.

## Enforcement

`npm run validate` — and therefore `prepublishOnly` — runs `scripts/public-surface-check.mjs`,
which scans both the Git tracked set and the npm pack set. Add machine-local codenames to
`local/public-surface-denylist.txt` (one token per line) or the `AICG_PUBLIC_SURFACE_DENYLIST`
environment variable; never hard-code them in the repository. See
[docs/internal/reference/public-surface-hygiene.md](docs/internal/reference/public-surface-hygiene.md).
