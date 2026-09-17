# Bilingual README and Manual CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish synchronized English and Simplified Chinese project home pages, make English the default, and prevent routine pushes or documentation changes from automatically starting CI.

**Architecture:** Keep `README.md` and `README.zh-CN.md` as a deliberately paired documentation surface with the same section keys, commands, and local link targets. Keep GitHub Actions available as an explicit manual fast/full verification tool instead of an automatic push, pull-request, schedule, or release trigger.

**Tech Stack:** Markdown, Node.js 22 test runner, GitHub Actions YAML, npm package metadata

**Spec:** User-approved design in the 2026-09-17 conversation.

## Global Constraints

- English remains the default repository and npm language.
- Both README files provide a visible `English | 简体中文` switch.
- Commands, paired section keys, and shared local documentation links remain synchronized.
- Do not claim npm publication, remote CI success, Windows/Linux execution, or real-client verification without current evidence.
- Run one local verification cycle for the complete change; do not split README sections into separate development tasks.
- GitHub CI is manual-only and exposes explicit `fast` and `full` suites.

---

### Task 1: Deliver the bilingual project home and manual CI boundary

**Files:**
- Create: `README.zh-CN.md`
- Create: `test/readme-sync.test.mjs`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: current source-candidate commands, governance contracts, npm metadata, and GitHub Actions jobs.
- Produces: paired project home pages, a structural synchronization check, English npm description, and manual fast/full CI dispatch.

- [x] **Step 1: Write the failing synchronization test**

  Add a Node test that reads both real README files and requires the Chinese file, matching ordered sync keys, identical shell command blocks, matching shared relative documentation targets, and reciprocal language links.

- [x] **Step 2: Run the test to verify it fails for the missing Chinese README**

  Run: `node --test test/readme-sync.test.mjs`

  Expected: failure because `README.zh-CN.md` does not exist.

- [x] **Step 3: Implement the approved documentation, metadata, and CI changes**

  Reorganize the English README around quick start, project value, workflow, adaptive task routing, evidence boundaries, contributor validation, and references. Create the Chinese mirror with the same sync keys, commands, and links. Add the Chinese README to the npm package file list, refine the English npm description, and replace automatic CI triggers with a manual `suite` selector.

- [x] **Step 4: Run the complete local verification boundary**

  Run the README synchronization test, the fast suite, Skill validation, YAML parsing, and npm pack dry-run. Inspect the resulting diff and package contents. Do not dispatch GitHub Actions.

- [x] **Step 5: Update GitHub About and publish the repository changes**

  Set a concise bilingual GitHub About description, read it back, commit the child repository, push it, commit only the parent repository pointer, and push the parent. Confirm remote revisions without starting CI.
