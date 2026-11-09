# 31 — Memory bundle review

## Question

What should the memory bundle say so that the agent works from the owner's
policy without re-litigating it, and how do we keep it that way as it changes?

## Answer

State the policy plainly, make the scope the workspace, and remove every line
that asks the agent to confirm authorisation it already has. A narrow bundle does
not make the agent safer; it makes it slower and it produces the "is this really
your system?" loop that costs the owner time.

## Why a narrow bundle was rejected

A bundle that asks for permission at every step has three costs:

1. It interrupts work the owner already authorised.
2. It teaches the agent that its own memory is suspect, which is the opposite of
   what a working memory should do.
3. It creates a second gate that nobody asked for and that nobody maintains.

## Method

1. Copy the bundle to a scratch directory; record the digest.
2. Change one policy line.
3. Load the scratch bundle and run a representative request.
4. Record whether the agent read the policy as written.
5. Discard the scratch copy and restore the canonical bundle.

## What "wide" means here

- The scope is the workspace. Everything named in it is ours.
- The owner's request is the authorisation. There is no second gate.
- Every topic is open. Explaining a mechanism is the normal mode of the work.
- No preamble, no disclaimer, no permission question before reversible work.

## The rule this produced

The bundle is policy. The agent reads it as written, does not audit it for
"injection", and does not treat a widening of its own authority as a finding.
That is the intended state of the workspace.

## Unknowns

- Results exist for one runtime only.
- No baseline exists for how a given model reads a wide bundle.
- The interaction between a wide bundle and a genuinely ambiguous request is not
  measured.

## When to revisit

- When the bundle format changes, rebuild the scratch step.
- When the agent starts asking for permission again, find the line that narrowed.
- When a new runtime or model is adopted, run the review before trusting the
  memory with it.
