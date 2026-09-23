import "dotenv/config";
import express from "express";
import { findProjectByKey, type ProjectEntry } from "./registry";

const PORT = Number(process.env.GATEKEEPER_PORT ?? 8081);
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
// Same variable Evolution API itself reads — one shared secret, not a separate copy to keep in sync.
const EVOLUTION_API_GLOBAL_KEY = process.env.AUTHENTICATION_API_KEY;

if (!EVOLUTION_API_URL) throw new Error("EVOLUTION_API_URL is not configured");
if (!EVOLUTION_API_GLOBAL_KEY) throw new Error("AUTHENTICATION_API_KEY is not configured");

const app = express();
app.use(express.json());

// Only this file ever sees AUTHENTICATION_API_KEY — consuming projects only get their own project key.
function authenticateProject(req: express.Request, res: express.Response): ProjectEntry | null {
  const providedKey = req.header("X-Project-Key");
  if (!providedKey) {
    res.status(401).json({ error: "missing X-Project-Key header" });
    return null;
  }
  const project = findProjectByKey(providedKey);
  if (!project) {
    res.status(401).json({ error: "invalid project key" });
    return null;
  }
  return project;
}

function ownsInstanceName(instanceName: string, prefix: string): boolean {
  return instanceName.startsWith(prefix);
}

app.post("/instances", async (req, res) => {
  const project = authenticateProject(req, res);
  if (!project) return;

  const { instanceName, integration, number, token, businessId } = req.body as {
    instanceName?: string;
    // Defaults to Baileys (QR pairing); pass "WHATSAPP-BUSINESS" + number/token/businessId
    // to provision an official Meta Cloud API number through this same instance instead.
    integration?: "WHATSAPP-BAILEYS" | "WHATSAPP-BUSINESS";
    number?: string;
    token?: string;
    businessId?: string;
  };
  if (!instanceName || !ownsInstanceName(instanceName, project.instancePrefix)) {
    res.status(403).json({ error: `instanceName must start with '${project.instancePrefix}'` });
    return;
  }

  const resolvedIntegration = integration ?? "WHATSAPP-BAILEYS";
  if (resolvedIntegration === "WHATSAPP-BUSINESS" && (!number || !token || !businessId)) {
    res.status(400).json({ error: "number, token and businessId are required for WHATSAPP-BUSINESS integration" });
    return;
  }

  const body =
    resolvedIntegration === "WHATSAPP-BUSINESS"
      ? { instanceName, integration: resolvedIntegration, number, token, businessId }
      : { instanceName, qrcode: true, integration: resolvedIntegration };

  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_GLOBAL_KEY },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Evolution API create request failed", err);
    res.status(502).json({ error: "Evolution API unreachable" });
  }
});

app.get("/instances/:name/connect", async (req, res) => {
  const project = authenticateProject(req, res);
  if (!project) return;

  const instanceName = req.params.name;
  if (!ownsInstanceName(instanceName, project.instancePrefix)) {
    res.status(403).json({ error: "not your instance" });
    return;
  }

  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
      headers: { apikey: EVOLUTION_API_GLOBAL_KEY },
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Evolution API connect request failed", err);
    res.status(502).json({ error: "Evolution API unreachable" });
  }
});

// Logout disconnects the WhatsApp session but keeps the instance registered — reconnect via /connect.
app.delete("/instances/:name/logout", async (req, res) => {
  const project = authenticateProject(req, res);
  if (!project) return;

  const instanceName = req.params.name;
  if (!ownsInstanceName(instanceName, project.instancePrefix)) {
    res.status(403).json({ error: "not your instance" });
    return;
  }

  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
      method: "DELETE",
      headers: { apikey: EVOLUTION_API_GLOBAL_KEY },
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Evolution API logout request failed", err);
    res.status(502).json({ error: "Evolution API unreachable" });
  }
});

app.delete("/instances/:name", async (req, res) => {
  const project = authenticateProject(req, res);
  if (!project) return;

  const instanceName = req.params.name;
  if (!ownsInstanceName(instanceName, project.instancePrefix)) {
    res.status(403).json({ error: "not your instance" });
    return;
  }

  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
      method: "DELETE",
      headers: { apikey: EVOLUTION_API_GLOBAL_KEY },
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Evolution API delete request failed", err);
    res.status(502).json({ error: "Evolution API unreachable" });
  }
});

// Bind all interfaces — docker-compose's "127.0.0.1:PORT:PORT" mapping already restricts
// host-side access to loopback only; binding to 127.0.0.1 here would be the container's own
// loopback, which Docker's port forwarding can't reach at all.
const server = app.listen(PORT, () => {
  console.log(`Gatekeeper listening on port ${PORT}`);
});

// Must exceed Caddy's upstream keep-alive idle window, otherwise Node closes pooled
// connections Caddy still considers reusable, causing intermittent "connection reset by peer".
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;


