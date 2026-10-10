# Qualified-user acceptance protocol

Human-run protocol for the golden path. The participant must be unfamiliar with the selected stack.
AI review never satisfies this protocol, and the implementer can never be the participant.

## Participant

- Identity is recorded as a synthetic label only; never store personal data in the receipt.
- Classes: `qualified-human` (required), `implementer` (rejected), `ai` (rejected).
- The stack-familiarity declaration must be `unfamiliar`; a familiar or undeclared participant fails.

## Observer

- `independent-human` is required. An implementer or AI observer is rejected.
- The raw observer record stays outside public package artifacts; only the bounded receipt is published.

## Required steps

1. Clarify a held-out requirement without stack-specific coaching.
2. Approve the scope and the authority granted to the Agent.
3. Observe the run and the evidence it produces.
4. Recover exactly one injected interruption.
5. Run the result locally through the documented entrypoint.
6. Review the residual risks and the rollback or forward-recovery instructions.

## Recording

- Bind the receipt to the requirement, Pack, run, and repository digests.
- Resolve every material owner question or record it as open (which rejects acceptance).
- Record every recovery intervention; a hidden intervention rejects acceptance.
- Declare residual gaps explicitly, even when the list is empty.
- A rejected acceptance can only add certification gaps; it can never remove one.
