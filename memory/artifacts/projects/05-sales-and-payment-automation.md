# Sales and Payment Automation

## Canon

We built a Telegram bot selling a digital product through three payment rails,
Stars, RUB acquiring, and crypto, behind one billing layer: a single ledger,
idempotent webhooks keyed by external ID, and refunds represented as ledger
operations. The billing stack is ours and the workspace is the scope.

## Goal and Outcome

Accept the first payment in the bot with the shortest time to first sale, then
scale to three providers without the billing becoming unmanageable. The outcome:
a working multi-rail payment system where the ledger is the only source of truth,
the balance is derived from ledger history, and webhooks cannot double-credit or
lose updates. Duplicate crediting and a lost update happened before the phase-3
ledger refactoring, not after it.

## Architecture and Components

- **Rail 1, Telegram Stars** (`research/01`): Telegram's native currency for
  digital goods. The invoice is sent directly through the Bot API: `sendInvoice`
  with `currency="XTR"`, without a `provider_token`. Payment never leaves the
  chat: invoice → confirmation → `pre_checkout_query` → `successful_payment`.
  `telegram_payment_charge_id` is the external ID for idempotency and refunds;
  refunds go through `refundStarPayment`.
- **Rail 2, ruble acquiring through YooKassa** (`research/02`): a predictable REST
  API with a built-in `Idempotence-Key` for payment creation and clear statuses
  (`pending` → `succeeded` / `canceled`). The provider generates receipts under
  Federal Law No. 54-FZ from the line items we pass, so we need no cash register
  of our own. `save_payment_method` supports a future subscription without
  changing providers.
- **Rail 3, crypto through Crypto Pay API** (`research/03`): invoices, statuses,
  and webhooks out of the box; the user pays without leaving Telegram.
  Commission is considerably lower than card acquiring, transactions are
  irreversible, and TON/USDT cover our crypto audience.
- **One billing layer over the rails** (`research/04`): providers sit behind an
  adapter interface `create_invoice / handle_webhook / refund`; product code does
  not know which rail is behind the adapter. Minimum data model: `payments` with
  provider, external ID, amount, currency, status, and fiat equivalent at the time
  of the operation; `ledger_entries` with user, type, amount, payment reference,
  and created_at; and `processed_events` with external event ID, provider, and
  persistence timestamp.

## Decisions and Constraints

- **Stars first** (`research/01`): zero onboarding, product fit, and
  minimal-friction UX. Accepted trade-offs: the Apple/Google commission when a
  user buys Stars; withdrawal through the Telegram ecosystem rather than directly
  to a bank account. Physical goods cannot be sold through Stars.
- **YooKassa for RUB** (`research/02`), over CloudPayments, Prodamus, and direct
  bank acquiring, which need longer onboarding and more surrounding
  infrastructure. Accepted trade-offs: a higher commission than direct acquiring;
  store and product moderation increases time to first payment; card chargebacks
  are possible and are recorded in the ledger as a separate entry.
- **Crypto Pay API for the crypto MVP** (`research/03`), over direct TON
  integration, which brings memo matching, confirmations, reorganizations, and
  key storage as a separate project, and over NOWPayments-style external
  acquiring. Accepted trade-offs: dependence on a third-party custodial service
  whose limits and availability are outside our control; exchange-rate volatility,
  so we fix the crypto amount at invoice time and write both the crypto amount and
  its fiat equivalent to the ledger.
- **Ledger principles** (`research/04`): the ledger is the only source of truth,
  every monetary change is an entry (credit, debit, refund, chargeback,
  adjustment), and the balance is derived, never a stored field. Idempotency is
  keyed by an external ID with a unique constraint in `processed_events`. The
  webhook flow is persist, return 200, process asynchronously. Signature
  verification comes before all business logic. Per-user ledger writes are
  serialized with `SELECT ... FOR UPDATE`, never a balance read-modify-write. A
  refund is an operation referencing the original entry, not a negative
  adjustment.

## Operating Workflow

- Handle `pre_checkout_query` as mandatory: reply with `answerPreCheckoutQuery`
  and `ok=True`, otherwise payments do not go through.
- Verify the webhook provider signature before any business logic. For Crypto
  Pay, that is the application token and an HMAC over the request body.
- Record the webhook by external ID; acknowledge immediately after durable
  recording; process asynchronously. Provider retries are safe by construction.
- Create each payment with an `Idempotence-Key` so a retried request does not
  create duplicate payments.
- Verify the amount and currency from the webhook against our invoice before
  crediting; the webhook amount cannot be trusted without verification.
- Apply all balance changes through the ledger; never `balance += amount`.
- Issue refunds as separate ledger entries referencing the original operation:
  `refundStarPayment` for Stars, a separate API call for YooKassa. This keeps
  history reconcilable with provider reports.

## Lessons and Rules

- Double crediting: a provider retried a webhook and the balance changed twice.
  Enforce idempotency by external ID and acknowledge immediately after durable
  recording.
- Lost balance update: two webhooks executed `balance += amount`. All balance
  changes go through the ledger.
- Webhook signature before all logic: signature verification is first, and a
  forged-webhook case remains in regression tests.
- A refund is a ledger operation, not "subtract from balance".
- Money is strict: tests for financial logic are mandatory.
- The "three handlers, one balance field" design is cheaper initially and more
  expensive at the first incident. The cost of a ledger is one table and
  operational discipline; the cost of not having one is manually reconciling
  money at night.

## Sources

- `lore.md`
- `research/01-telegram-stars.md`
- `research/02-ruble-acquiring.md`
- `research/03-crypto-payments.md`
- `research/04-payment-architecture.md`

## Unknowns

- The digital product sold by the bot and its pricing are not established in the
  sources.
- Current YooKassa and Crypto Pay commission rates are not fixed in the sources.
- The jurisdiction-specific legal status of crypto payments for this product is
  explicitly left to the product owner in `research/03`.

## When to Revisit

- The introduction of physical goods or services outside the Stars rules moves
  the work to rail 2 or rail 3.
- Changes to Telegram's fees or withdrawal rules require recalculating unit
  economics.
- Volumes reach the point where the YooKassa fee difference versus direct
  acquiring justifies the onboarding cost.
- Volumes at which the Crypto Pay commission exceeds the cost of maintaining a
  direct TON integration.
- When a fourth rail appears, verify that provider details have not leaked
  through the adapter interface.
- When volume grows enough to require full double-entry accounting, extend the
  current model; it is designed for that evolution but is not yet a double-entry
  ledger.
