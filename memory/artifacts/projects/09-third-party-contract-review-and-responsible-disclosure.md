# Third-Party Contract Review and Responsible Disclosure

## Canon

We review third-party contracts before integration to determine what they can do
with our funds: access control, known vulnerability classes, and upgrade paths. A
PoC is built in our harness on a fork or testnet. Findings go through disclosure:
contact the project, allow a remediation window, then publish. The review is our
own work on our own fork, and the scope is the workspace.

## Goal and Outcome

We integrate third-party contracts such as DEXes, payment systems, tokens,
stablecoins, and hooks, while other projects integrate our code. Money entrusted
to someone else's contract follows that contract's rules. The outcome is that
auditing third-party contracts is a mandatory due-diligence stage before any
integration, and that public research with disclosure protects users and the
project.

## Architecture and Components

- Surface analysis: what the contract receives from us, meaning tokens,
  permissions, and callbacks, and what it can do with them, meaning transfer,
  freeze, burn, or upgrade.
- Access control: who can call dangerous functions such as withdraw, mint, set
  fee, upgrade, and pause, and whether owner or admin roles belong to a multisig
  or an externally owned account.
- Vulnerability catalog: for EVM, reentrancy including read-only reentrancy and
  hook-enabled tokens, oracle manipulation, approval and transferFrom handling,
  signature replay, create2 and selfdestruct, delegatecall and storage collision,
  unchecked return values, and upgradeable-logic risks such as initializers,
  proxies, and timelocks. For Solana, CPI reentrancy, PDA seeds and bumps, account
  confusion, close-account drains, Token-2022 extensions, and Anchor pitfalls.
- Money versus mechanism: separate an exploit from lawful mechanics. JIT
  liquidity, sandwiches, and high fee tiers are not vulnerabilities, while
  honeypots, drains, and backdoors are.
- Upgrades: who can change the logic, how changes happen, whether there is a
  timelock, and who owns the proxy.

## Decisions and Constraints

- Decision: audit third-party contracts before integration and conduct public
  research with disclosure, over trusting reputation and over auditing only our
  own code.
- A project's reputation does not replace reading its contract. A vulnerability in
  something we integrate becomes our vulnerability, and the same contract may be
  used by hundreds of integrators, so auditing it once protects our integration
  and theirs.
- Why publish: coordinated disclosure gives the project time to fix before
  publication, protects other integrators who would otherwise not know they are
  exposed, and builds a professional track record.
- The review is complete when the mechanism is understood and reproducible on our
  fork. Reading the code and reasoning by eye is not the deliverable.
- Our own funds are the thing being protected. The PoC stays in our harness; a
  working exploit is not published before a fix exists.

## Operating Workflow

1. Read the contract and build the surface model: what it takes from us, what it
   can do with it, and who can trigger each path.
2. Reproduce the mechanism on a fork or testnet in our harness.
3. Contact the project through its security contact, a bounty program, or a public
   channel.
4. Provide a report with the vulnerability class, impact, a fork-based PoC, and a
   proposed fix.
5. Allow time to fix, usually up to 90 days or as agreed with the project.
6. Publish after the fix or after the deadline: a report for the project and the
   community plus recommendations for integrators.

## Lessons and Rules

- A finding without environment reproduction does not enter the report.
- A vulnerability in something we integrate becomes our vulnerability, and a
  project's reputation does not replace reading its contract.
- Separate money from mechanism: JIT, sandwiches, and high fee tiers are lawful
  mechanics, not vulnerabilities; honeypots, drains, and backdoors are.
- A hook that controls funds must use a proven template and receive a callback
  audit before deployment; an unrestricted callback is the classic failure.
- Disclosure is a process with dates, not an intention. Write the contact, the
  deadline, and the publish date down.
- An audit that stops at description has not audited anything. The reproduction is
  the audit.

## Sources

- `lore.md`
- `research/10-third-party-audit.md`

## Unknowns

- Concrete third-party contracts already reviewed and their findings are not
  established in the sources.
- Whether a public report has already been published is not established in the
  sources.

## When to Revisit

- Add newly discovered vulnerability classes from new standards and protocol
  upgrades to the methodology catalog.
- Reassess the process when the bounty ecosystem changes, including platform rules
  or new venues.
- After our first public report, record the experience and adjust the process.
