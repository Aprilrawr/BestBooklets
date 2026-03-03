# Booklets Website

A minimal static website starter built with plain HTML, CSS, and JavaScript.

## Run locally

You can open `index.html` directly in a browser.

For local serving (recommended), run in PowerShell from project root:

```powershell
python server.py 5500
```

Then open `http://localhost:5500`.

## Global shared state

All planner changes are saved globally in `state.json` via `POST /api/state` and loaded from `GET /api/state`.
This means everyone using the same running server sees the same latest layout/state.

## Email notification (Send to Rania)

The **Send to Rania** button calls `POST /api/notify` and sends an email through SMTP.

Set these environment variables before starting the server:

- `SMTP_HOST` (example: `smtp.gmail.com`)
- `SMTP_PORT` (example: `587`)
- `SMTP_USER` (SMTP login username)
- `SMTP_PASS` (SMTP login password / app password)
- `NOTIFY_TO` (your personal email)
- `NOTIFY_FROM` (sender address shown in email)
- `SMTP_SECURE` (`starttls` default, or `ssl`)

If these are missing, the button will show a send error and the server returns `email-not-configured`.

## Deploy from GitHub (easy path)

The app now includes `render.yaml`, so the easiest hosted option is Render:

1. Push this repository to GitHub.
2. In Render, choose **New +** → **Blueprint**.
3. Connect your GitHub repo.
4. Render reads `render.yaml` and runs `python server.py` automatically.

After deploy, open your Render URL and use the app normally.

### Important note about persistence

`state.json` lives on the server filesystem.
If your host clears ephemeral disk between restarts/deploys, state may reset.
For guaranteed long-term persistence, use a host with persistent disk enabled.

## Keep label order/layout in GitHub

Before pushing future code changes, snapshot the current live Render state into `state.json`:

```powershell
./scripts/snapshot_state_from_render.ps1
```

Then commit it:

```powershell
git add state.json
git commit -m "Snapshot live booklet state"
git push
```

This preserves current label order/placements in Git history and avoids losing changes during later deploys.
