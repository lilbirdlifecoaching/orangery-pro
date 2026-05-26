# orangery-pro

Static site for `orangery.pro`, focused on leadership coaching for people stepping into workplace leadership.

## Repo structure

- `index.html` - root entrypoint for GitHub Pages
- `orangery-pro.html` - main landing page
- `relationship-dynamic-orangery.html` - native relational dynamics tool frontend
- `ORANGE.png` - shared brand icon
- `worker/` - Cloudflare Worker for the relational dynamics AI endpoint

## How the site works

- GitHub Pages serves the static site files in the repo root.
- The relational dynamics tool is now native to the Orangery site.
- The tool frontend calls the worker defined in `worker/` to generate structured coaching reflections.

## Important deployment detail

The frontend reads the worker URL from this meta tag in `relationship-dynamic-orangery.html`:

```html
<meta name="orangery-worker-url" content="https://orangery-relational-dynamics.YOUR-SUBDOMAIN.workers.dev">
```

After deploying the worker, replace that placeholder URL with the real deployed worker URL or a custom domain such as `https://api.orangery.pro`.

## Worker setup

See `worker/README.md` for:

- environment variables
- local development
- deploy steps
- expected request/response shape
