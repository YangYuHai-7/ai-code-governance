# Public-surface hygiene

AICG publishes two surfaces: the Git repository and the `ai-code-governance` npm package. Both
must stay free of machine-specific and private material. This rule is enforced by a machine
check, not by convention alone.

## Canonical location for working notes

Plans, review and evaluation notes, reports, pilots, and design drafts are working notes. They
live under `local/` at the repository root and nowhere else.

`local/` is ignored by `.gitignore`, so it is never committed, and it is excluded from the npm
package because `package.json` ships only `docs/internal/` and `docs/zh-CN/README.md` from the
documentation tree. Keep the two surfaces separate: a note that is worth shipping belongs in
`docs/internal/` as a finished reference document, and a note that is only for the maintainer
belongs in `local/`.

## What must never be committed or packed

- Absolute home paths for a personal user directory on any operating system.
- Private project codenames, internal organization names, or internal repository names.
- Private email addresses or other personal contact details.

Code comments, test fixtures, registries, and documentation describe behavior and design
generically. Do not cite a private repository, a local workspace, or an internal project as the
source of a design decision.

## The packaging rule behind the original leak

The `files` field in `package.json` is an explicit allow list. npm does not apply
`.npmignore` or `.gitignore` to files inside a directory that `files` already lists. Listing a
broad directory such as the whole documentation tree therefore ships every ignored note inside
it. List the smallest directories that should ship.

## Enforcement

```bash
npm run check:public-surface   # or: node scripts/public-surface-check.mjs
```

The check reads both published surfaces — the Git tracked set (`git ls-files`) and the npm pack
set (`npm pack --dry-run --json`) — and fails on any forbidden path or content finding.
`npm run validate` runs it, and `prepublishOnly` runs `validate`, so publication fails closed.

Machine-local codenames are not stored in this public repository. Add them to
`local/public-surface-denylist.txt` (one token per line) or to the
`AICG_PUBLIC_SURFACE_DENYLIST` environment variable (comma-separated). The generic rules
(absolute home paths, private email domains, and working-note paths) always run, so a machine
without a deny list still rejects the common cases.
