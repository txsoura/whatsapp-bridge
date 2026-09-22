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

  const { instanceName } = req.body as { instanceName?: string };
  if (!instanceName || !ownsInstanceName(instanceName, project.instancePrefix)) {
    res.status(403).json({ error: `instanceName must start with '${project.instancePrefix}'` });
    return;
  }

  const response = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_GLOBAL_KEY },
    body: JSON.stringify({ instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
  });

  const data = await response.json();
  res.status(response.status).json(data);
});

app.get("/instances/:name/connect", async (req, res) => {
  const project = authenticateProject(req, res);
  if (!project) return;

  const instanceName = req.params.name;
  if (!ownsInstanceName(instanceName, project.instancePrefix)) {
    res.status(403).json({ error: "not your instance" });
    return;
  }

  const response = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
    headers: { apikey: EVOLUTION_API_GLOBAL_KEY },
  });

  const data = await response.json();
  res.status(response.status).json(data);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Gatekeeper listening on 127.0.0.1:${PORT}`);
});
