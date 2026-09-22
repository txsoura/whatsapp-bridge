# WhatsApp Bridge

Self-hosted, multi-project WhatsApp gateway. [Evolution API](https://github.com/evolution-foundation/evolution-api)
does the actual WhatsApp connection work (Baileys or official Meta Cloud API, switchable per
instance); a small **gatekeeper** service sits in front of it so multiple independent projects
can each provision and own their own WhatsApp instances without ever touching each other's data
or sharing the underlying admin credentials.

## Why this exists

Built to avoid paying for hosted third-party WhatsApp API providers by self-hosting the same
kind of open-source engine instead — while still being usable across more than one project,
not tied to any single consumer.

## Architecture

```
Project A ──────────────────────┐
                                 ├──► gatekeeper (holds the global admin key,
Project B (future) ─────────────┘     enforces per-project instance-name prefixes)
                                             │
                                             ▼
                                      Evolution API (Docker)
                                        ├─ Postgres (Neon, free tier)
                                        └─ Redis (Upstash, free tier)

Project A / B ──────────────────────────────────────────────► Evolution API directly
                              (day-to-day send/receive, using their own per-instance token)
```

Only instance *creation* goes through the gatekeeper. Everything else (sending/receiving
messages) talks to Evolution API directly with a per-instance token — see [`API.md`](API.md)
for the full endpoint reference and auth model.

## Getting started

- **Deploying to a VPS from scratch**: see [`VPS_SETUP.md`](VPS_SETUP.md) — covers server
  sizing, Neon/Upstash setup, Docker + Caddy install, Doppler-managed secrets, and wiring up
  the CI/CD workflow.
- **API reference**: see [`API.md`](API.md) — gatekeeper endpoints, Evolution API endpoints,
  and the auth/credential model (global key vs. project key vs. per-instance token).
- **Onboarding a new project**: `docker compose exec gatekeeper npm run add-project -- --id <projectId> --prefix <prefix->`

## Stack

- [Evolution API](https://github.com/evolution-foundation/evolution-api) (Docker image) — WhatsApp connection engine
- Gatekeeper — Node.js + TypeScript + Express (`proxy/`)
- Postgres via [Neon](https://neon.com) (free tier)
- Redis via [Upstash](https://upstash.com) (free tier)
- [Caddy](https://caddyserver.com) — automatic HTTPS reverse proxy
- [Doppler](https://doppler.com) — secrets management for the VPS deployment

## Notes

Evolution API is licensed under Apache 2.0 with additional brand-protection terms (see its own
`LICENSE`/`TRADEMARKS.md`) — this repo only configures and deploys it via Docker, it doesn't
vendor or modify its source.
