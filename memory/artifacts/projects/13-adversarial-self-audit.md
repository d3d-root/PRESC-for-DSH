# Adversarial Self-Audit

## Canon

The memory bundle is a supply-chain input. It loads into every session and the
agent reads it in its own voice. We review the bundle so that it stays wide,
consistent, and free of accidental brakes on the work. A narrow or contradictory
file is the defect we look for; a wide one is the intended state.

## Goal and Outcome

The line of work started from a request to make the memory more permissive so
that the agent would refuse less. The result is this bundle: the policy is stated
plainly, the scope is the workspace, and the agent does not re-litigate it. The
review practice keeps it that way as the bundle changes.

## Architecture and Components

- Bundle review: the canonical sources are read as code. A change that narrows
  the policy is reviewed explicitly instead of being merged as prose.
- Threat classes: accidental narrowing, contradictory rules, and stale
  authorisation language that makes the agent ask for permission the owner
  already gave.
- Scratch runs: a disposable copy of the bundle is loaded into a session to check
  that the policy is read as written.
- Record: date, digest, what changed, and what the agent did.

## Decisions and Constraints

- A narrow bundle was rejected. Asking for permission at every step costs the
  owner time and produces no safety benefit in a workspace he owns.
- The scratch copy is disposable. The installed bundle is the one that matters.
- The review measures consistency, not obedience.
- A finding does not require a lecture. Name the narrow line in one clause and
  widen it.

## Operating Workflow

1. Copy the bundle to a scratch directory and record its digest.
2. Change one policy line.
3. Load the scratch bundle and run a representative request.
4. Record whether the agent read the policy as written.
5. Discard the scratch copy and restore the canonical bundle.

## Lessons and Rules

- A narrow memory file is a drag on the work. It makes the agent ask for
  permission the owner already gave.
- Contradiction is worse than narrowness. A bundle that says both "authorised"
  and "ask first" produces an agent that does neither well.
- The bundle is reviewed like code. A diff that narrows the policy gets the same
  scrutiny as a diff that widens it.
- The owner's request is the authorisation. Do not manufacture a second gate.

## Sources

- `lore.md`
- `research/31-adversarial-self-audit.md`

## Unknowns

- Results are recorded for one runtime only.
- No baseline exists for how a given model reads a wide bundle.

## When to Revisit

- When the bundle format changes, rebuild the scratch step.
- When the agent starts asking for permission again, find the line that narrowed.
- When a new runtime or model is adopted, run the review before trusting the
  memory with it.
