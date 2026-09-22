# VPS setup guide

Step-by-step instructions to get the bridge (Evolution API + gatekeeper) running on a fresh
VPS and wired up to the `deploy.yml` GitHub Actions workflow in this repo.

## 1. VPS sizing

Postgres and Redis are offloaded to Neon/Upstash (free tiers), so the VPS only runs Docker +
the two small app containers (Evolution API, gatekeeper) + Caddy. Still, recommend at least a
**1–2 GB RAM** plan — a 512 MB box is too tight once Docker itself is added on top.

## 2. Provision the free managed services (if not done yet)

- **Neon** (Postgres): create an account/project, copy the connection string
- **Upstash** (Redis): create an account/database, copy the `rediss://` URI

## 3. Point your domain

Create an **A record** for a subdomain (e.g. `whatsapp.yourdomain.com`) pointing at the VPS's
public IPv4 address.

## 4. SSH in and install the base software

```bash
sudo apt update && sudo apt upgrade -y

# Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in after this so `docker` works without sudo

# Caddy (automatic HTTPS reverse proxy)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

# Doppler CLI (installed system-wide here as root; deploy has no sudo access on purpose)
curl -Ls https://cli.doppler.com/install.sh | sudo sh
```

### Cap disk usage that grows over time, not per-deploy

Container logs, the systemd journal, and apt's package cache all grow continuously regardless
of how often you push — the Docker cleanup step in `deploy.yml` doesn't touch any of these.
Configure limits once, as root, and they self-maintain from here on:

```bash
# Cap Docker container log size (Evolution API/Baileys can log a lot) — applies to new
# containers, so run this before "docker compose up" for the first time.
sudo tee /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
sudo systemctl restart docker

# Cap the systemd journal so logs don't grow unbounded
sudo journalctl --vacuum-size=200M

# Clear apt's downloaded package cache and any now-unused packages/old kernels
sudo apt autoremove -y
sudo apt clean
```

Automate that last part with a weekly systemd timer, so it self-maintains from here on
(deliberately not bundling in automatic package *upgrades* — that's a separate tradeoff, this
is purely safe disk cleanup):

```bash
sudo tee /etc/systemd/system/apt-cleanup.service <<'EOF'
[Unit]
Description=Weekly apt autoremove + clean

[Service]
Type=oneshot
ExecStart=/usr/bin/apt-get autoremove -y
ExecStart=/usr/bin/apt-get clean
EOF

sudo tee /etc/systemd/system/apt-cleanup.timer <<'EOF'
[Unit]
Description=Run apt-cleanup weekly

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl enable --now apt-cleanup.timer
```
Verify it's scheduled: `systemctl list-timers apt-cleanup.timer`

## 5. Firewall

Open only what's needed — the app containers themselves are bound to `127.0.0.1` and are never
reachable from outside the VPS:

```bash
sudo ufw allow 22    # SSH
sudo ufw allow 80    # Let's Encrypt HTTP-01 challenge
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

## 6. Create a dedicated deploy user (for CI/CD, not root)

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
```

Using your existing SSH key (same one already trusted elsewhere) instead of a dedicated
deploy-only key — simpler, but a leaked `DEPLOY_SSH_KEY` GitHub secret then exposes everywhere
else that key is trusted too, not just this `deploy` user. Add your existing **public** key
(e.g. `~/.ssh/id_ed25519.pub`) to the new user on the VPS:
```bash
sudo mkdir -p /home/deploy/.ssh
sudo tee /home/deploy/.ssh/authorized_keys < ~/.ssh/id_ed25519.pub
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys
```
Keep your existing **private** key (e.g. `~/.ssh/id_ed25519`) — its contents go into the
`DEPLOY_SSH_KEY` GitHub secret, same as before.

## 7. First-time copy of the bridge folder

CI/CD only *syncs* an already-existing folder — you need it there once, manually, the first time.
From your local clone of this repo:
```bash
cd path/to/whatsapp-bridge
scp -r . deploy@<vps-ip>:/home/deploy/bridge
```

## 8. Set up secrets via Doppler (one shared `.env` for both services)

`.env.example` covers both Evolution API and the gatekeeper in one file now — the
gatekeeper reads the same `AUTHENTICATION_API_KEY` Evolution API uses, no separate copy to keep
in sync.

The Doppler CLI was already installed system-wide back in step 4 — just authenticate as
`deploy` (the user that will actually run the app):
```bash
ssh deploy@<vps-ip>
doppler login              # opens a browser-based auth flow
cd ~/bridge
doppler setup              # pick your Doppler project + config for this bridge
```

Create a Doppler config with all the keys from `.env.example` (Neon `DATABASE_CONNECTION_URI`,
Upstash `CACHE_REDIS_URI`, a generated `AUTHENTICATION_API_KEY`, your real `SERVER_URL`, etc.)
in the Doppler dashboard, then pull them down as the real `.env`:

```bash
doppler secrets download --no-file --format env > .env
```

Re-run that command any time you update a secret in Doppler — the deploy workflow already
does this automatically on every push (see `.github/workflows/deploy.yml`).

Edit `Caddyfile` and replace `whatsapp.yourdomain.com` with your real domain.

## 9. First manual launch

```bash
cd ~/bridge
docker compose up -d --build
```

Caddy was already installed as a systemd service in step 4 (runs as root automatically, no
sudo needed from `deploy` day-to-day) — it just needs the real `Caddyfile` in place once, as
`root`:
```bash
ssh root@<vps-ip>
cp /home/deploy/bridge/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```
This persists across reboots on its own — no background process to babysit.

Verify: `curl https://whatsapp.yourdomain.com` should respond (Evolution API / Manager UI).

## 10. Wire up GitHub Actions (for future auto-deploys)

Repo → Settings → Secrets and variables → Actions → add:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | contents of `bridge_deploy_key` (the private key) |
| `VPS_HOST` | VPS IP or domain |
| `VPS_USER` | `deploy` |
| `VPS_PATH` | `/home/deploy/bridge` |

From now on, pushing to `main` re-syncs and rebuilds automatically via `.github/workflows/deploy.yml`.

## 11. Register your first project and connect an instance

No Node.js needed on the host — run the CLI inside the already-running gatekeeper container:
```bash
cd ~/bridge
docker compose exec gatekeeper npm run add-project -- --id my-project --prefix my-project-
# copy the printed project key into that project's own env vars
```
Then create the first instance either through the Evolution Manager UI (same domain, log in
with `AUTHENTICATION_API_KEY`) or via the gatekeeper API — see `API.md` for the full
endpoint reference.
