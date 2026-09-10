# Real-User Pilot Protocol

## Status and claim boundary

- Work package: `L3`.
- Current status: `externally-blocked`.
- Blocking dependency: consenting real participants and, where claimed, authorized real projects must execute the protocol with independent review.
- The ten U01–U10 simulated personas are design inputs only. They are not participants, customers, real projects, or certification evidence and cannot be relabeled under this protocol.
- A real person using a synthetic fixture may provide real-user usability evidence, but that does not make the fixture a `real-project` or prove production adoption.

Use [templates/external-evidence-receipt.json](templates/external-evidence-receipt.json) as a blank working template. It is intentionally `externally-blocked` and `blank-not-evidence` until all required fields are completed and reviewed.

## Research roles and independence

| Role | Responsibility | Independence boundary |
| --- | --- | --- |
| Product Owner | Approves purpose, participant segments, tasks, claim scope, and stop criteria. | Does not score their own implementation as independent evidence. |
| Pilot coordinator | Recruits participants, schedules sessions, manages consent references and withdrawal requests. | Does not pressure participation or alter findings to meet a target. |
| Session moderator | Reads the fixed script, records assistance, safety events, task outcome, and sanitized timings. | Does not silently rescue the participant or count assisted completion as unassisted. |
| Implementation owner | Supplies the frozen candidate and supported task fixture. | Cannot be the sole reviewer of any session. |
| Independent reviewer | Reviews candidate binding, consent status, raw-to-sanitized traceability, task evidence, and issue severity. | Must not be the participant, moderator, implementation owner, or Project Manager for that session. |
| Privacy custodian | Holds any identity-to-pseudonym map and raw consent artifact outside the repository. | Shares only the minimum pseudonymous reference needed for audit. |

Any receipt proposed as `real-project` evidence needs at least two declared independent reviewers before it can be merely `eligible-for-human-certification-review`. This remains a human-attested boundary: AICG does not verify identity or independence.

## Participant and project eligibility

Before recruitment, the Product Owner defines the intended segments and success questions. A participant is eligible only when:

- they are a real person in the declared experience segment;
- they can provide informed, voluntary consent;
- their relationship to the implementation team is disclosed;
- they have not been asked to impersonate a customer or reuse a simulated-persona script as personal testimony;
- any project used is authorized by its owner for the exact data collection scope.

Classify the session before it starts:

- `real-user-synthetic-project`: a real participant performs a usability task on a controlled fixture. This is not an AICG `real-project` receipt.
- `real-user-real-project`: a real participant performs an authorized task on a real project. It may produce a separate AICG `real-project` receipt after privacy review and independent review.

Do not recruit minors or collect sensitive personal data under this baseline. Any need to include protected or vulnerable populations, regulated data, employment evaluation, medical information, or financial account data requires a separate qualified legal/privacy review and protocol amendment.

## Consent

Consent must be obtained before installation, observation, screen/terminal capture, or collection of responses. The participant must receive plain-language notice covering:

- the purpose of the pilot and the exact candidate being evaluated;
- what tasks, commands, screen/terminal events, timings, and feedback are collected;
- whether audio, video, or screen recording is requested; each optional medium requires separate opt-in;
- who can access raw and anonymized evidence;
- retention and deletion periods;
- foreseeable confidentiality or repository risks;
- that participation is voluntary and stopping has no penalty;
- how to withdraw evidence and the latest practical withdrawal point before irreversible aggregate publication;
- that the pilot is research/product feedback, not certification, production approval, or a promise of customer support.

The signed consent artifact and identity-to-pseudonym mapping stay in restricted storage outside the repository. The repository receipt contains a pseudonymous consent reference, its digest, approved scopes, collection time, withdrawal channel identifier, and retention deadline.

## Privacy and anonymization

Use data minimization by default:

1. Assign a random participant ID that does not encode name, employer, email, location, or account.
2. Keep the participant-ID mapping separate under the Privacy custodian.
3. Use a sanitized fixture whenever a real project is unnecessary for the research question.
4. Never copy raw source code, secrets, credentials, customer data, private URLs, raw prompt history, or full terminal logs into Git.
5. Record exact commands and exit codes in sanitized form. Store any necessary raw artifact in approved restricted storage and put only a digest plus access classification in the receipt.
6. Review free text for identifying project and personal details before it enters reports.
7. Report small cohorts conservatively; do not publish combinations of role, company, location, or technology that re-identify a participant.

If a necessary observation cannot be anonymized within the approved scope, omit it and mark the related claim `unverified`.

## Candidate binding and pre-registration

Before the first session, freeze one candidate tarball and pre-register:

- package name, tool version, SHA-256, source commit when available, byte size, and freeze time;
- the participant segments and target count, without fabricated participant IDs;
- the task fixture or authorized-project criteria;
- the client, OS, runtime, lifecycle, governance depth, locale, and invocation scope;
- primary task outcome, assistance categories, stop criteria, and experience questions;
- the independent review assignment;
- evidence expiry and early-staleness events.

The moderator and one independent reviewer recompute the candidate SHA-256 before the session. A mismatch stops the session as `blocked`. Receipts cannot be copied between candidates, and a rerun after repackaging needs a new receipt ID.

## Session procedure

### 1. Pre-session checks

- Confirm consent is current and all requested capture modes are authorized.
- Confirm the participant may access the fixture/project without exposing unauthorized data.
- Record exact OS, client, and runtime versions without host or account identifiers.
- Verify and install the frozen candidate project-locally.
- Confirm the moderator script, stop conditions, and support escalation path.

### 2. Standard introduction

Tell the participant:

- the tool is a candidate and may fail;
- the product, not the participant, is being evaluated;
- they may stop or skip any task;
- they should think aloud only if they consented to that collection;
- the moderator will not provide hidden technical steps unless assistance is explicitly requested and recorded.

### 3. Task execution

Start from the declared state and ask the participant to complete one representative governance task. Record:

- start/end time and any pauses excluded from duration;
- commands or visible actions and exit codes;
- whether completion was unassisted, assisted, failed, blocked, or withdrawn;
- every moderator intervention using a predeclared assistance category;
- observed confusion, recovery, abandonment, and safety/privacy events;
- governance structure, project command, business/surface evidence, and real-client state as separate results.

Do not repair the product or application during the session and then count the same attempt as unassisted success. If a safety, privacy, destructive-action, or credential risk appears, stop the session and preserve only the minimum authorized diagnostic.

### 4. Negative and recovery evidence

Each task pre-registers at least one realistic failure condition and a recovery path. Record the expected failure, actual diagnostic, recovery action, and recovery result. The moderator may trigger a controlled failure only in a disposable fixture or explicitly authorized environment.

Missing negative evidence, unexpected success on a dangerous path, or failure without demonstrated recovery prevents a production-readiness claim. A simulation or synthetic fixture cannot be promoted to real-project evidence merely because a real participant operated it.

### 5. Post-session questions

Collect the same bounded 1–5 dimensions used by the pilot where applicable: installation, clarity, next step, recovery, and confidence. Ask open questions about the hardest step, misleading claims, required help, and whether the participant would choose the tool for the declared context. Label all quotations as anonymized participant feedback and preserve withdrawal linkage; do not call feedback “customer adoption” without an actual customer relationship and authorized claim.

### 6. Independent review

The independent reviewer checks:

- consent scope, privacy flags, and withdrawal state;
- the independently recomputed candidate digest;
- task start state and exact assistance log;
- outcome and negative/recovery evidence;
- whether the participant, moderator, implementation owner, and reviewer roles are properly separated;
- whether a synthetic fixture was kept distinct from real-project evidence;
- whether findings and scores match the retained sanitized evidence.

Disagreement remains visible in the receipt and report. The Project Manager cannot waive reviewer concerns or reclassify a blocked session as passed.

## Withdrawal and deletion

A participant may stop a session immediately or request withdrawal through the recorded channel. On withdrawal:

1. stop collection and do not ask for a reason;
2. mark the receipt `withdrawn` and exclude it from all scores, counts, quotations, eligibility, and claims;
3. notify the Privacy custodian to delete identity mappings and raw artifacts according to the consent terms;
4. retain only a minimal anonymized tombstone with receipt ID and withdrawal time if the participant allowed it;
5. remove already drafted quotations or case descriptions that could identify the participant;
6. require fresh consent and a new receipt ID for any later participation.

If aggregate publication has made removal technically irreversible, that limit must have been disclosed before consent. It does not authorize retaining raw or identifiable evidence beyond the agreed period.

## Expiry and staleness

Every receipt requires `observedAt` and `expiresAt`. Evidence becomes stale immediately when:

- the candidate fingerprint changes;
- the evaluated task, client entrypoint, governance contract, or relevant project state changes materially;
- the consent or project authorization expires or is withdrawn;
- reviewer independence is disproved;
- retained evidence can no longer support audit of the result;
- `expiresAt` is reached.

Stale sessions stay out of current scores and claims. Historical retention is allowed only when consent and the retention policy permit it and the status is visibly `stale`.

## Reporting rules

Report denominators and exclusions explicitly. Separate:

- recruited, consented, started, completed, blocked, failed, and withdrawn participants;
- unassisted and assisted outcomes;
- synthetic-project and authorized real-project sessions;
- real-user usability, real-client loading, cross-OS behavior, production readiness, and certification.

Never replace missing participants with personas, generate quotations, infer customer adoption, or claim certification from averages. A passing real-project receipt with independent reviewers is only eligible for human certification review.

## Completion rule

`L3` remains `externally-blocked` until real participants consent, execute the pre-registered protocol, and independent reviewers accept candidate-bound evidence. Completion of the protocol package itself proves only that external testing is prepared; it does not change any real-user, customer, production, or certification claim.
