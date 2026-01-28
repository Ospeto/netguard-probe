# NetGuard Probe

NetGuard Probe is a 24/7 monitoring dashboard for Remnawave / Marzban panels and VPS nodes, designed to:

- Continuously poll your panel and nodes
- Detect throttling / anomalies (e.g. GFW speed limits)
- Send bundled alerts to Telegram (critical nodes, high load, etc.)
- Show node status, 24‑hour history, and per‑node mini graphs
- Run as a single Docker container behind Nginx on any VPS

This guide explains how to deploy NetGuard Probe with Docker and Nginx, and how to update it from GitHub.

---

## Features

- **24/7 Monitoring**  
  Runs on a VPS and auto‑scans your panel at a configurable interval.

- **GFW / Throttling Detection**  
  Heuristics and time‑series analysis to flag suspicious speed‑limit behavior.

- **Telegram Integration**  
  - Commands: `/scan`, `/nodes`, `/status`, `/ping`  
  - Bundled alerts to avoid spam  
  - Auto‑stop polling when bot is forbidden or misconfigured

- **Node History & Mini Graphs**  
  - 1‑hour rolling average speed per node in the UI  
  - Local 24‑hour history stored in `localStorage`  
  - Sparkline mini‑charts on each node card  
  - Full chart modal with 24‑hour view

- **Optimized for VLESS / Shadowsocks Panels**  
  Wording and heuristics tailored for VLESS / Shadowsocks / Xray‑style Remnawave panels.

---

## Architecture

- **Frontend**: React + TypeScript + Vite
- **Build**: Multi‑stage Docker build (Node → Nginx)
- **Runtime**: Nginx serving static files on port 80 inside the container
- **Deployment**: Docker Compose on any VPS
- **Reverse Proxy (optional but recommended)**: Host Nginx (or any proxy) terminating HTTPS and proxying to the container

---

## Requirements

- A Linux VPS (e.g. Ubuntu 22.04) with:
  - Docker
  - Docker Compose plugin
- (Optional) Nginx on the host for HTTPS + domain
- A Remnawave / Marzban‑style panel with API token
- A Telegram bot and chat ID (for alerts)

---

## 1. Clone the Repository

On your VPS:

```bash
sudo apt update
sudo apt install -y git

cd /opt
git clone https://github.com/Ospeto/netguard-probe.git
cd netguard-probe
```

---

## 2. Docker Setup

### 2.1 Dockerfile (multi‑stage build)

NetGuard Probe uses a multi‑stage Dockerfile:

```dockerfile
# Dockerfile

########################
# 1) Build stage
########################
FROM node:20-alpine AS build

WORKDIR /app

# Install deps
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

########################
# 2) Nginx serve stage
########################
FROM nginx:stable-alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static build
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 2.2 nginx.conf (inside container)

This Nginx config serves the Vite build as a SPA:

```nginx
# nginx.conf (for container)

server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    client_max_body_size 10M;

    add_header X-Frame-Options "DENY";
    add_header X-Content-Type-Options "nosniff";
    add_header X-XSS-Protection "1; mode=block";
}
```

---

## 3. Docker Compose

A minimal `docker-compose.yml`:

```yaml
version: "3.9"

services:
  netguard-probe:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: netguard-probe
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      - NODE_ENV=production
      # If you later want to bake defaults into the build, you can add:
      # - VITE_PANEL_URL=https://your-panel-domain/api
      # - VITE_DEFAULT_CORS_PROXY=https://your-cors-proxy
      # - VITE_TELEGRAM_BOT_TOKEN=123456:ABC...
      # - VITE_TELEGRAM_CHAT_ID=123456789
```

Bring it up:

```bash
docker compose up -d --build
```

Check container:

```bash
docker ps
```

You should see `netguard-probe` with `0.0.0.0:8080->80/tcp`.

Now NetGuard Probe is reachable at:

- `http://YOUR_VPS_IP:8080`

---

## 4. Host Nginx Reverse Proxy (Domain + HTTPS)

Running the app directly on `:8080` is fine for testing. For production, you usually want:

- A domain like `netguard.your-domain.com`
- HTTPS termination
- Reverse proxy from host Nginx → Docker app (`127.0.0.1:8080`)

### 4.1 Install Nginx and Certbot (Ubuntu example)

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

Make sure the Docker container is already running on port 8080.

### 4.2 Basic HTTP reverse proxy

Create Nginx site:

```bash
sudo nano /etc/nginx/sites-available/netguard-probe
```

Content:

```nginx
server {
    listen 80;
    server_name netguard.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/netguard-probe /etc/nginx/sites-enabled/netguard-probe
sudo nginx -t
sudo systemctl reload nginx
```

Now `http://netguard.your-domain.com` should show the app.

### 4.3 Add HTTPS via Let’s Encrypt

Run Certbot:

```bash
sudo certbot --nginx -d netguard.your-domain.com
```

- Choose “redirect HTTP to HTTPS” when prompted.

Certbot will:

- Get a certificate
- Update your Nginx config with `listen 443 ssl` and SSL settings

After that, access:

- `https://netguard.your-domain.com`

---

## 5. Configuration Inside NetGuard Probe

Once the UI is reachable (either via IP or domain), open it in a browser and configure:

### 5.1 Panel API

- **Panel URL**: `https://panel.your-domain.com/api` (or your Remnawave API endpoint)
- **API Token**:
  - Use a valid admin or read‑only API token.
  - Enter the raw token (no `Bearer` prefix); the app will build `Authorization: Bearer TOKEN` internally.
- **CORS Proxy** (optional):
  - If running in a browser environment that hits cross‑origin restrictions, you can use a CORS proxy.
  - For Docker deployments where the app is served from your own domain and talks directly to the panel, you can usually **turn CORS proxy OFF**.

The app includes smart error handling:

- Stops auto‑scan on repeated `AUTH_ERROR` / invalid token.
- Falls back from CORS proxy to direct fetch when needed.

### 5.2 Telegram Bot

Steps:

1. Create a bot with `@BotFather` and get the bot token.
2. Add the bot to a group or chat where you want alerts.
3. In NetGuard Probe UI:
   - Set **Telegram Bot Token**
   - Use **AUTO-DETECT** or manually set **Telegram Chat ID**
   - Use the **Test** button to verify message delivery.

The app will:

- Poll `/getUpdates` with proper offset and cooldown.
- Stop polling when 403 “forbidden” indicates the bot is blocked/removed.
- Send bundled alerts to avoid spamming.

---

## 6. 24‑Hour History & GFW Detection

### 6.1 Local History Storage

NetGuard Probe keeps a rolling time series of node metrics:

- Samples are taken on each scan.
- History is stored in browser `localStorage` for up to 24 hours.
- Each node card can show:
  - Current throughput / users
  - 1‑hour average
  - Sparkline mini‑chart (e.g. speed vs time)

### 6.2 Time‑Series Graphs

The `SpeedChart` component provides:

- Per‑node charts
- 24‑hour view mode
- Proper time formatting

You can open a full chart for a node from the UI (e.g. “View Chart” button), which shows:

- Node throughput vs time
- Gaps from outages / zero speed
- Visual confirmation of throttling.

### 6.3 GFW / Throttling Heuristics

NetGuard Probe uses heuristics in `utils/networkUtils.ts` and analysis logic to flag suspicious behavior such as:

- **Speed “flatlining”** at very low but non‑zero Kbps with active users
- **Sudden drops** in speed with no change in user count
- **Long‑duration low variance** plateau at suspicious thresholds

Nodes that appear throttled or degraded will:

- Be flagged as **CRITICAL** or **WARNING** in the analysis
- Trigger Telegram alerts (if configured)
- Show visual indicators in the UI (e.g., color, badges)

---

## 7. Updating NetGuard Probe from GitHub

Once the repo is set up, deploying updates is simple.

### 7.1 On your dev machine

```bash
# After editing code
git add .
git commit -m "Improve GFW detection and mini charts"
git push origin main
```

### 7.2 On each VPS

```bash
cd /opt/netguard-probe
git pull
docker compose up -d --build
```

Docker will rebuild the image with the new code and restart the container.

---

## 8. Common Issues & Troubleshooting

### 8.1 Docker Build Fails (TypeScript Error)

If `npm run build` fails during Docker build:

- Check `components/MonitorView.tsx`, `types.ts`, and other TS files.
- Fix the TypeScript error locally:
  - Run `npm install`
  - Run `npm run build` on your dev machine
- Once it passes locally, commit and push, then rebuild in Docker.

### 8.2 “Fetch Error: AUTH_ERROR”

Typically means:

- Invalid / expired panel API token
- Token formatted incorrectly (e.g., “Bearer Bearer …”)
- Proxy stripping headers (if CORS proxy is enabled)

Fix:

- In the UI, enter raw API token (no “Bearer”).
- Verify panel URL is correct and includes `/api` if required.
- Turn off CORS proxy for Docker‑hosted deployments if unnecessary.

### 8.3 Telegram “403 Forbidden” & “Conflict: terminated by other getUpdates request”

- 403: Bot removed / blocked from the chat; the app will stop polling.
- `Conflict: terminated by other getUpdates request`: Another instance (or script) using the same bot token is also polling.

Fix:

- Ensure only one NetGuard Probe instance is using that bot token at a time.
- Remove old scripts or test instances using the same bot.

---

## 9. Development Workflow (Local)

If you want to develop outside Docker:

```bash
# Install deps
npm install

# Start dev server
npm run dev
```

Vite will run on `http://localhost:3000` (or as configured in `vite.config.ts`).

For production builds:

```bash
npm run build
npm run preview  # to locally preview production build
```

Once satisfied, build the Docker image again or push to GitHub and rebuild on the VPS.

---

## 10. License & Contributions

- License: [Specify your license here, e.g. MIT]
- Contributions: PRs and issues are welcome. Feel free to:
  - Improve detection heuristics
  - Add additional charts / metrics
  - Extend to other panel types or protocols
