# orangery.pro Build Notes

## Overview

This repo is the standalone `orangery.pro` site for leadership coaching aimed at professionals who are newer to people leadership or moving from individual contribution into leadership.

It is separate from `orangery.solutions`, which remains focused on church culture.

## What Was Built

### Main site

- `index.html`
  - root entrypoint for GitHub Pages
- `orangery-pro.html`
  - main landing page for `orangery.pro`
- `ORANGE.png`
  - shared brand icon/logo asset

### Native relational tool

- `relationship-dynamic-orangery.html`
  - fully native Orangery relational dynamics tool frontend
  - no longer uses the external iframe wrapper
  - designed as a workplace coaching mirror, not an advice engine

### Worker

- `worker/src/index.js`
  - Cloudflare Worker backend for relational-dynamics analysis
- `worker/wrangler.toml`
  - worker config
- `worker/.dev.vars.example`
  - example local secret file
- `worker/package.json`
  - minimal module config
- `worker/README.md`
  - worker-specific setup and deployment notes

### Repo support files

- `README.md`
  - repo-level overview and deployment notes
- `.gitignore`
  - ignores local worker secrets and Wrangler state

## Site Direction

The site is written for:

- newer people leaders
- professionals leading down, sideways, and up
- practical leadership growth
- communication, tension, politics, maturity, and workplace dynamics

The tone is:

- broad corporate/professional
- practical
- coaching-led
- direct, calm, and non-fluffy

## Native Relational Tool Design

The tool was redesigned around three relationship directions:

- `leadDown`
  - someone you lead or manage
- `peer`
  - colleague or peer
- `leadUp`
  - someone who leads or manages you

### Inputs

The tool currently accepts:

- your frameworks/types
- how you tend to show up at work
- their frameworks/types
- how they tend to show up at work
- optional live workplace context, friction, or politics

### Output shape

The frontend expects structured JSON with:

- `pairingTitle`
- `snapshotSummary`
- `relationshipDirection`
- `powerDynamics`
- `theyMayNeed`
- `youMayNeed`
- `frictionPoints`
- `politicalWatchouts`
- `reflectionQuestions`
- `doMoreOf`
- `avoidDoing`
- `nextConversationSteps`
- `coachingReminder`

### Coaching stance

The tool is intentionally framed as:

- a mirror
- a coaching reflection engine
- a workplace dynamics guide

It is intentionally **not**:

- therapy
- legal advice
- HR advice
- personality certainty
- a manipulation engine

## Worker Naming And Settings

### Worker name

Use:

`orangery-relational-dynamics`

### Endpoints

- `GET /ping`
- `POST /relational-dynamics`
- `POST /partner-dynamic` (compatibility alias)

### Required secret

- `ANTHROPIC_API_KEY`

### Environment variables

- `ANTHROPIC_MODEL`
  - recommended value:
  - `claude-sonnet-4-20250514`

- `ALLOWED_ORIGINS`
  - recommended value:
  - `https://orangery.pro,https://www.orangery.pro,https://lilbirdlifecoaching.github.io`

## Frontend Worker Hookup

The relational tool frontend reads the worker URL from the meta tag in:

- `relationship-dynamic-orangery.html`

Current pattern:

```html
<meta name="orangery-worker-url" content="https://orangery-relational-dynamics.YOUR-SUBDOMAIN.workers.dev">
```

After deploying the Cloudflare Worker, replace that placeholder with the real worker URL or a custom domain such as `https://api.orangery.pro`.

## Hosting Model

### Static site

- hosted on GitHub Pages
- custom domain intended: `orangery.pro`

### API

- hosted separately on Cloudflare Workers

This keeps the public site static while the API securely holds the Anthropic key.

## DNS Notes For `orangery.pro`

For GitHub Pages, the root domain should use:

### A records for `@`

- `185.199.108.153`
- `185.199.109.153`
- `185.199.110.153`
- `185.199.111.153`

### CNAME for `www`

- `lilbirdlifecoaching.github.io`

### Squarespace Domain Connect

- keep `_domainconnect` if present
- remove/replace conflicting Squarespace records for `@` and `www`

## Important Content Notes

- `orangery.solutions` remains the church-culture site
- `orangery.pro` is a distinct stream for workplace leadership coaching
- broader team/workshop/company development can later live under `orangery.team`

## Current Key Files To Review

- `orangery-pro.html`
- `relationship-dynamic-orangery.html`
- `worker/src/index.js`
- `worker/README.md`
- `README.md`

## Suggested Next Steps

1. Test the live relational tool end-to-end against the deployed worker.
2. Review the tone of outputs for:
   - coaching quality
   - political awareness
   - practical usefulness
   - non-prescriptive language
3. Refine prompt wording if outputs feel too generic or too advice-heavy.
4. Optionally move the worker from `workers.dev` to a custom API domain later.
