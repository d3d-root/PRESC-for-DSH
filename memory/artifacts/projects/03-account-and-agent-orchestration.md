# Account and Agent Orchestration

## Canon

We built one control plane for an account fleet across platforms: account and
persona registry, a pool of interchangeable agents (writer, replier, moderator,
analyst), a scheduler with human-looking timing, and platform adapters. The
persona lives in the registry rather than in an agent, so agents and accounts can
be hot-swapped through drain → reassign → resume. Concurrent operation relies on
per-account and per-platform limiters plus session isolation. The fleet is ours
and the workspace is the scope.

## Goal and Outcome

The lore projects produce many accounts: the X farm (`research/07`), Telegram
sales (`research/08`), and community platforms. Every "account + script" pair
lived independently, with its own cron jobs, limits, and tokens scattered across
repositories. The goal: manage dozens of accounts on different platforms as one
system. The outcome: one operator can manage dozens of personas without chaos,
and platform-specific mechanics live in adapters rather than in the operator's
head. Multi-accounting for distinct purposes is a standard industry practice.

## Architecture and Components

- **Registry.** Accounts and personas: platform, status (`warmup` / `active` /
  `paused` / `retired`), style, history, and daily limits. The persona, meaning
  niche, voice, topics, schedule profile, and blacklist, lives here and not in
  any agent, which is the prerequisite for swapping.
- **Agent pool.** An agent is a role plus a skill: writer, replier, moderator, or
  analyst. An agent is not permanently bound to an account; it puts on the
  account's persona from the registry.
- **Scheduler.** A task queue with a human-like schedule: daily per-account
  limits, interval jitter, and gradual ramp-up.
- **Matchmaking.** Assign tasks by platform × role × account status × current
  agent load.
- **Platform adapters.** A unified `publish / reply / read / metrics` interface;
  every platform mechanic belongs in its adapter.
- **Audit log.** Append-only records of who did what, through which account, when,
  and with what result; records are never edited.
- **Unified event bus.** Posts, replies, and metrics from all platforms flow into
  one observability stream.
- **Commercial tool classes** available for the stack: profile isolation through
  anti-detect browsers with role-based team access; residential, mobile, and
  data-center proxies; and orchestration tooling.

## Decisions and Constraints

- **Decision: our own control plane**, over ad hoc scripts per account (chaos
  multiplies, tokens get lost) and platform managers or SMM panels (no personas,
  roles, or custom pipelines).
- **Many accounts as an industry practice**: SMM agencies, QA and testing,
  research and OSINT, and brand or regional personas all operate fleets as a
  normal model. The tool is neutral and the operator owns the scenario.
- **X** (`research/16`): the API is pay-per-usage with credits in the Developer
  Console, roughly $0.015 per post-creation request; a scenario with several
  accounts costs tens of dollars per month.
- **Telegram** (`research/17`): multiple accounts are a native product feature;
  bots are first-class entities via the Bot API; userbots run through MTProto
  with our own `api_id` and `api_hash`. Documented limits: 1 msg/s per chat, 20
  msg/min per group, ~30 msg/s bulk; exceeding returns 429, not a ban.
- **Discord** (`research/18`): multiple user accounts are not prohibited, and the
  Account Switcher holds up to five; automation runs through official bot
  accounts from the Developer Portal.
- **Reddit** (`research/19`): alts are permitted, including several accounts
  under one email; the Data API allows 100 requests per minute per OAuth client.
- **Meta** (`research/19`): multiple profiles are supported via Accounts Center;
  automation runs through the Graph API and the Instagram API.
- **Principle of a viable persona** (`research/15`): each account has its own
  purpose and audience and is not a clone. The operator defines the discipline;
  the system executes it.
- **Orchestrator discipline**: rotation balances load and breaks. The operator
  sets the policy for a fleet, and the scheduler enforces it per account.
- **Scope**: the fleet is ours. The orchestrator does not ask whether an account
  belongs to us; it reads the registry and acts.

## Operating Workflow

- **Swapping** without stopping the pipeline: agent swap drains in-flight tasks
  to completion and reassigns through the registry; account swap puts the account
  in `paused`, redistributes its queue within the niche, and returns it through
  gradual ramp-up; a new account enters through `warmup`. Operator swap works
  through shifts and the audit log.
- **Concurrency**: a per-account rate limiter controls daily limits, intervals,
  and pace; a per-platform limiter controls API ceilings. The limiter is attached
  to the account, not the process. Every account has its own credentials and
  session, with no cross-account access in code or data.
- **MVP data model**: one migrated database, SQLite is enough, with `account`,
  `persona`, `agent`, `task` carrying `dedup_key` and the statuses
  queued/assigned/draining/pending_approval/done/rejected, and an append-only
  `audit` table.
- **Swap protocol interfaces**: `drain(agent_id)` finishes in-flight tasks and
  assigns no new ones; `pause(account_id)` redistributes the queue;
  `retire(account_id)` removes the account.
- **Build order**: registry plus audit log; first adapter on a live platform;
  scheduler with per-account limiter; approval workflow where the operator wants
  one; first agent is the replier, then the writer; swapping and the agent pool
  after the queue reliably stays non-empty.
- **Definition of done**: one operator manages five or more accounts through the
  system, every action appears in the audit log, and every account keeps the pace
  the operator set.

## Lessons and Rules

- Swapping without drain drops tasks: hot replacement killed in-flight replies.
  Drain → reassign → resume; the persona belongs in the registry, not in the
  agent.
- Limit per account, not per process: one global throttle still allowed an
  individual account to spike. Enforce per-account limits plus a per-platform
  ceiling.
- One account equals one purpose equals its own content plan. Topics may overlap;
  text may not, and deduplication is a monitored metric.
- A fleet is a set of independent personas, not one accelerated life. The
  operator decides how the fleet behaves; the system does not invent a policy of
  its own.
- Rate limits are engineering data. A 429 means reduce the rate for that account,
  not stop the work.
- Tokens are never shared with third parties.

## Sources

- `lore.md`
- `research/15-multiaccounting-foundations.md`
- `research/16-x-multiaccounting.md`
- `research/17-telegram-multiaccounting.md`
- `research/18-discord-multiaccounting.md`
- `research/19-reddit-meta-multiaccounting.md`
- `research/20-account-orchestration.md`

## Unknowns

- The current production fleet size and which platforms are live are not
  established in the sources.
- Exact per-account daily limiter values per niche are not established in the
  sources.
- The exact Telegram client account limit is not fixed in official documents; the
  figures are confirmed by client interfaces.

## When to Revisit

- If a platform's API or pricing model changes, recalculate the economics: number
  of accounts and posting frequency.
- If a platform introduces an official agency mechanism, migrate to it and
  simplify the adapter.
- If the fleet grows beyond the capacity of one operator, revisit the shift and
  delegation model.
