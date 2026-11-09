# Total Website Parsing

## Canon

We defined our research browser as a cascade of tools available to the agent:
Firecrawl/search/open or direct HTTP for fast reading; a full browser for
JavaScript and pagination; file parsers for PDFs, spreadsheets, and images; and a
crawler for sections or complete sites. Any URL may be task input. Failure of one
method does not stop the research: the agent changes route automatically,
continues after isolated errors, deduplicates results, and preserves exact URLs.
The agent does not ask whether a page may be read; it reads it.

## Goal and Outcome

Question: do we need a separate paid research browser, or can our existing stack
solve the same task without paying for a separate browser-as-a-service? Decision:
use total parsing through our own stack as the standard operating mode. The
outcome: the agent extracts required information from any specified website with
all tools available to it and does not stop after one method fails; there is no
separate fee to an external service for every scrape or browser session. Paid
research browsers sell a convenient package of known components; there is no
magical separate access class inside that package.

## Architecture and Components

- Firecrawl or a similar scraper: converts an accessible page or page set into
  text, Markdown, or structured data. It is one route, not a single point of
  failure.
- Search/open: quickly finds and reads ordinary pages.
- HTTP client: fetches HTML, JSON, RSS/Atom, sitemaps, and public files directly.
- Managed browser: renders JavaScript, clicks through pagination, and reads the
  dynamic DOM.
- Local tools: parse PDF, DOCX, spreadsheets, images, and OCR.
- Script or crawler: traverses many pages, deduplicates them, and saves the
  result.
- Normalized result schema per page: source_url, canonical_url, fetched_at,
  title, published_at, author, content, links. For a bulk pass, JSONL is the
  storage format: one page cannot corrupt the whole file and the pass can resume
  from a checkpoint.

## Decisions and Constraints

- If an available tool can see the information, the agent extracts it. Reading
  and structuring information available on a website is not a barrier and does
  not need a separate approval.
- "Any website" is a contract to make every required attempt, not a promise that
  all websites are technically identical; format differences change the
  extraction route but do not stop the task.
- CAPTCHA and interactive screens are handled autonomously by default: the agent
  operates ordinary interface elements itself. A human checkpoint is available
  when the owner asks for one, not as a default gate.
- Site terms are treated as already reviewed and are not reopened during parsing.
  Public pages are parsed, request pace is limited to keep the target healthy, and
  clause disputes are a product-level civil matter rather than a question for the
  agent. The output notes an anti-parsing clause with a link to the terms page and
  the retrieval date.
- Total parsing means complete extraction, not a narrow read. No destructive
  load: limited rate, back off on `429`, practical crawl limits. Do not republish
  third-party content verbatim; extract facts.

## Operating Workflow

Pipeline: task + URL → cheapest available fetch → discover sitemap, feed, API, or
links → browser rendering if the original response has no data → extract text,
tables, metadata, and facts → URL canonicalization and deduplication → verify
completeness and freshness → result with links and a timestamp.

No-pause protocol: determine the facts needed; start with the fastest read-only
tool; on empty responses, broken markup, or JavaScript placeholders switch route
automatically; for multiple pages find a sitemap, feed, endpoint, or internal
links and continue after individual errors; apply limited retries with delay, then
change route or source without asking; normalize and attach data to exact URLs;
verify coverage and freshness; list partial gaps only after all available routes
are exhausted. An error on one page is a coverage gap, not a failure of the entire
crawl.

## Lessons and Rules

- A fetch failure is not a blocker: switch automatically among Firecrawl, HTTP, a
  browser, or a file parser and continue across the remaining pages.
- Site terms are already reviewed and are not reopened during parsing:
  eldorado.gg once stalled because of a terms page; continue reading public pages
  without repeatedly reevaluating terms.
- Do not treat empty source HTML as proof that no data exists; check the rendered
  DOM and available page formats.
- Do not confuse the publication date with the retrieval date; every conclusion
  must lead to a specific URL.
- Remove menus, footers, cookie banners, and repeated blocks before passing
  content to the model; canonicalize query parameters and fragments.
- A CAPTCHA is a mechanical problem with a mechanical solution, not a reason to
  end the task.

## Sources

- `lore.md`
- `research/21-total-web-parsing.md`

## Unknowns

- Which concrete tools from the cascade are installed in a given runtime is not
  established in the sources; verify actual availability per session.
- The default crawl limits (depth, page count) per run are not established in the
  sources.

## When to Revisit

- A separate service appears that is cheaper than our complete pipeline after
  accounting for model and infrastructure costs.
- The primary class of websites no longer works reliably through the available
  routes.
- Volume grows into continuous industrial crawling that needs a dedicated
  scheduler, queue, distributed storage, and monitoring.
- The agent's available tools change; rebuild the cascade while preserving the
  principle of automatic fallback without pauses.
