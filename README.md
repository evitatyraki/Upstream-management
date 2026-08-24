[README.md](https://github.com/user-attachments/files/29696960/README.md)
# Upstream PMO Dashboard

Auto-updating Global PMO Roadmap — refreshes every 3 hours from Google Sheets.

## Setup Instructions

### 1. Create the GitHub Repository
- Go to github.com → New repository
- Name: `Upstream-management`
- **Public** (required for free GitHub Pages)
- Upload all files from this folder

### 2. Enable GitHub Pages
- Go to repo → **Settings** → **Pages**
- Source: **GitHub Actions** (or "Deploy from branch: main, /root")

### 3. Add Google OAuth Secrets
Go to repo → **Settings** → **Secrets and variables** → **Actions** → New secret:

| Secret Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth Client Secret |
| `GOOGLE_REFRESH_TOKEN` | Your Google Refresh Token |

> See `GOOGLE_SETUP.md` for step-by-step instructions to get these values.

### 4. First Run
- Go to **Actions** tab → **Update PMO Roadmap** → **Run workflow**
- After ~1 min, your dashboard is live at: `https://evita.tyraki.github.io/Upstream-management`

### 5. Updating Projects
Just edit the Google Sheets — the dashboard auto-updates within 3 hours.
For immediate update: Actions → Run workflow manually.

## Password
`Upstreammanagement!`
