# Orangery Relational Dynamics Worker

This worker powers the native `orangery.pro` relational dynamics tool.

## What it does

- accepts a workplace relationship payload from the static site
- sends a coaching-style prompt to Anthropic
- returns structured JSON for the frontend to render
- keeps the API key out of the static GitHub Pages site

## Endpoints

- `GET /ping`
- `POST /relational-dynamics`

`POST /partner-dynamic` is also supported as a compatibility alias.

## Expected request body

```json
{
  "relationshipDirection": "leadDown",
  "you": {
    "frameworks": "5 Voices Pioneer, Enneagram 3",
    "description": "Direct, fast-moving, wants clarity."
  },
  "them": {
    "frameworks": "Guardian voice, Enneagram 9",
    "description": "Careful, steady, avoids conflict."
  },
  "context": "I need to give harder feedback but do not want to create defensiveness."
}
```

## Environment

Create a local `worker/.dev.vars` file from `.dev.vars.example`:

```bash
cp worker/.dev.vars.example worker/.dev.vars
```

Set:

- `ANTHROPIC_API_KEY`

Optional:

- `ANTHROPIC_MODEL`
- `ALLOWED_ORIGINS` as a comma-separated list

Example:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

## Local development

From the `worker/` folder:

```bash
wrangler dev
```

By default the native frontend expects a deployed worker URL. For local development, either:

1. temporarily update the worker meta tag in `relationship-dynamic-orangery.html`, or
2. set `window.ORANGERY_RELATIONAL_WORKER_URL` in the browser console before testing.

## Deploy

From the `worker/` folder:

```bash
wrangler deploy
```

After deploy, copy the worker URL and update the meta tag near the top of `relationship-dynamic-orangery.html`:

```html
<meta name="orangery-worker-url" content="https://your-worker.workers.dev">
```

If you later want a cleaner production setup, give the worker a custom domain such as `api.orangery.pro` and update that same meta tag to the custom URL.
