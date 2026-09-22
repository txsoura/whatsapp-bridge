import { randomBytes } from "crypto";
import { hashKey, loadRegistry, saveRegistry } from "./registry";

/** Usage: npm run add-project -- --id my-project --prefix my-project- */
function parseArgs(): { projectId: string; instancePrefix: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };

  const projectId = get("--id");
  const instancePrefix = get("--prefix");

  if (!projectId || !instancePrefix) {
    console.error("Usage: npm run add-project -- --id <projectId> --prefix <instance-prefix->");
    process.exit(1);
  }

  return { projectId, instancePrefix };
}

function main(): void {
  const { projectId, instancePrefix } = parseArgs();
  const registry = loadRegistry();

  if (registry.some((entry) => entry.projectId === projectId)) {
    console.error(`Project '${projectId}' already exists in the registry.`);
    process.exit(1);
  }

  const plaintextKey = randomBytes(32).toString("hex");
  registry.push({ projectId, keyHash: hashKey(plaintextKey), instancePrefix });
  saveRegistry(registry);

  console.log(`Project '${projectId}' added — instances must be named '${instancePrefix}*'.`);
  console.log("Project key (copy this now, it is never stored in plaintext anywhere):");
  console.log(plaintextKey);
}

main();
