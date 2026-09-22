# Bridge API reference

Two layers, two different audiences.

- **Gatekeeper** (`bridge/proxy/`) — the only entry point consuming projects use to *create*
  new WhatsApp instances. Holds the Evolution API global key internally; never exposes it.
- **Evolution API** (`bridge/docker-compose.yml`'s `evolution-api` service) — the real
  messaging engine. Consuming projects talk to it *directly* for day-to-day send/receive,
  using the per-instance token returned when their instance was created.

Base URL for both, once deployed: `https://whatsapp.yourdomain.com` (gatekeeper under the
`/gatekeeper` path prefix, Evolution API at the root — see `bridge/Caddyfile`).

## Auth model summary

| Credential | Held by | Can do |
|---|---|---|
| `AUTHENTICATION_API_KEY` | Evolution API + gatekeeper only (one shared value, never leaves the deployment) | Everything — create/delete any instance across all projects |
| Project key (from `add-project`) | Each consuming project (e.g. Cosmopolita's backend env) | Create instances, but only named with its own prefix |
| Per-instance token (returned by instance creation) | Each consuming project, one per instance it owns | Send/receive messages for that one instance only |

## Gatekeeper endpoints (`/gatekeeper/*`)

### `POST /gatekeeper/instances`
Create a new WhatsApp instance under the caller's own prefix.

**Headers:** `X-Project-Key: <project key from add-project>`, `Content-Type: application/json`

**Body:**
```json
{ "instanceName": "cosmopolita-<propertyId>" }
```
Rejected with `403` if `instanceName` doesn't start with the project's registered prefix.

**Response:** forwards Evolution API's `POST /instance/create` response as-is — includes the
instance's own auth token and initial connection/QR data.

### `GET /gatekeeper/instances/:name/connect`
Fetch (or refresh) the pairing QR code for an existing instance.

**Headers:** `X-Project-Key: <project key>`

**Response:** forwards Evolution API's `GET /instance/connect/{instanceName}` response:
```json
{ "pairingCode": null, "code": "2@...", "base64": "data:image/png;base64,...", "count": 1 }
```
`base64` is a ready-to-render QR image data URL — scan it with the property's WhatsApp number.

## Evolution API endpoints (called directly, using the per-instance token)

These are Evolution API's own endpoints — confirmed against its official API reference
(`https://docs.evolutionfoundation.com.br`). Always cross-check the exact field names against
the live Swagger UI bundled with your deployment (`SERVER_DISABLE_DOCS=false`) before wiring up
new integrations, since Evolution API adds fields across versions.

### `GET /instance/connect/{instanceName}`
Same shape as the gatekeeper's `/connect` passthrough above — usable directly once you already
hold the per-instance token, no need to go through the gatekeeper again after initial creation.

**Headers:** `apikey: <per-instance token>`

### `POST /message/sendText/{instanceName}`
Send a plain text message. *(Verify exact field names in your deployment's Swagger UI —
Evolution API's send-message payload shape has evolved across versions.)*

**Headers:** `apikey: <per-instance token>`, `Content-Type: application/json`

**Body (typical shape):**
```json
{ "number": "<whatsapp-jid-or-phone>", "text": "Hello from Cosmopolita" }
```

### Webhooks (inbound messages)
Configured per-instance at creation time (via `webhook` fields on `POST /instance/create`, or
set afterward through the Manager UI / instance settings endpoint). Evolution API POSTs
message events to whichever URL that instance is configured with — point it at the consuming
project's own webhook route (e.g. Cosmopolita's `/api/webhooks/whatsapp`).

## Onboarding a new project (CLI)

```bash
cd bridge/proxy
npm run add-project -- --id <projectId> --prefix <prefix->
```
Prints a project key once — store it in that project's own secrets (never in this repo, never
in Evolution API's global key's location). See `bridge/proxy/src/add-project.ts`.

## Operator-only tools

- **Evolution Manager** (web UI, same domain root) — authenticated with the global key, for
  visual QR scanning, connection status, manual test sends, and instance settings. Never hand
  this login to a consuming project.
- **Swagger/OpenAPI docs** — bundled with Evolution API itself when `SERVER_DISABLE_DOCS=false`,
  the authoritative source for exact request/response shapes on your deployed version.
