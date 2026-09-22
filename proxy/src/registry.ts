import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { createHash } from "crypto";

export interface ProjectEntry {
  projectId: string;
  keyHash: string;
  instancePrefix: string;
}

const REGISTRY_PATH = process.env.REGISTRY_PATH ?? "data/registry.json";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function loadRegistry(): ProjectEntry[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as ProjectEntry[];
}

export function saveRegistry(entries: ProjectEntry[]): void {
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2));
}

export function findProjectByKey(providedKey: string): ProjectEntry | undefined {
  const hash = hashKey(providedKey);
  return loadRegistry().find((entry) => entry.keyHash === hash);
}
