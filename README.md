# One vs Party

Web app for a hosted live quiz duel with separate presentation, player, guest, and admin views.

## Features
- Master admin area to create/manage games
- Quiz editor with multiple question types:
  - Single/multi choice
  - Estimate
  - Order
  - Image/audio/video identity
  - Risk question (+2 / -2)
- Separate links/tokens for:
  - Admin
  - Presentation
  - Player
  - Guest live
  - Guest async
  - Shared results
- Live updates via WebSocket
- Result page and shareable PNG
- Per-quiz UI language (`en`, `de`, extensible)

## Internationalization (i18n)
- Source language is English.
- Translation files are CSV pairs in `backend/src/i18n/translations/`.
- Naming convention: `en_XX.csv` (example: `en_DE.csv`, `en_ES.csv`).
- CSV format: first column = English source text, second column = translated text.
- Variable placeholders are supported: `{playerName}`, `{rank}`, `{total}`, etc.
- Add a new language by adding a new CSV file; it is picked up automatically.
- The app does not auto-translate quiz questions/answers. Admins manage content language.

## Tech Stack
- Frontend: Vue 3 + Vite
- Backend: Node.js + Express + Socket.IO + Sequelize
- Database: MariaDB
- Runtime: Docker Compose

## Quick Start
1. Create local config:
```bash
cp .env.example .env
```

2. Start the stack:
```bash
docker compose up --build
```

3. Open:
- Frontend: `http://localhost:8080`
- Admin entry: `http://localhost:8080/#/admin`

## Configuration
See `.env.example` for the main variables:
- `FRONTEND_PORT`
- `BACKEND_PORT`
- `PUBLIC_BASE_URL`
- `ADMIN_TOKEN`
- `APP_SECRET`

## Production behind host NGINX
1. Create server config:
```bash
cp .env.example .env
```

2. Set at least these values in `.env`:
- `APP_SECRET` (strong random value)
- `ADMIN_TOKEN` (strong random value)
- `PUBLIC_BASE_URL=https://quiz.example.com`

3. Start containers (bound to localhost only):
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

4. Install NGINX vhost:

- Set the NGINX Proxy settings

6. Issue certificates with Certbot (if missing):
```bash
sudo certbot --nginx -d quiz.example.com
```

7. Open:
- `https://quiz.example.com`
- `https://quiz.example.com/#/admin`

## Project Structure
- `backend/`: API, game logic, DB models
- `frontend/`: Vue app
- `docker-compose.yml`: local multi-container stack
- `docker-compose.prod.yml`: production compose for host NGINX reverse proxy
- `deploy/nginx/quizduell.conf`: NGINX vhost template (TLS + API/media/socket proxy)

## E2E Test (short)
Run Playwright in the dedicated e2e container:
```bash
docker compose --profile e2e up --build --abort-on-container-exit --exit-code-from e2e e2e
```

If the stack is already running:
```bash
docker compose --profile e2e run --rm e2e
```

## Notes
- Do not commit secrets (`.env` stays local).
- Replace `ADMIN_TOKEN` and `APP_SECRET` before deployment.
