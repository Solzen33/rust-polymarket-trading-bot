import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    mode: null, // "simulation" | "live"
    configPath: null,
    yesLive: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--simulation") args.mode = "simulation";
    else if (a === "--live") args.mode = "live";
    else if (a === "--yes-live") args.yesLive = true;
    else if (a === "-c" || a === "--config") args.configPath = argv[++i];
    else if (a?.startsWith("--config=")) args.configPath = a.split("=", 2)[1];
    else {
      console.error(`Unknown argument: ${a}`);
      args.help = true;
    }
  }
  return args;
}

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeFileIfMissing(target, contents) {
  if (exists(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
  return true;
}

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return String(answer ?? "").trim();
}

function printHelp() {
  console.log(`
Polymarket Trading Bot runner

Usage:
  npm run bot
  npm run bot -- --simulation
  npm run bot -- --live
  npm run bot -- --live --yes-live
  npm run bot -- -c path/to/config.json

Notes:
  - Default is simulation (safe).
  - Live trading requires confirmation unless --yes-live is provided.
`.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const nodeMajor = Number(process.versions.node.split(".")[0] || 0);
  if (Number.isFinite(nodeMajor) && nodeMajor < 18) {
    console.error(`Node.js >= 18 required. Detected: ${process.versions.node}`);
    process.exit(1);
  }

  const pkgPath = path.join(projectRoot, "package.json");
  const nodeModulesPath = path.join(projectRoot, "node_modules");
  if (!exists(pkgPath)) {
    console.error("Could not find package.json. Run this from the project root.");
    process.exit(1);
  }
  if (!exists(nodeModulesPath)) {
    console.error("Dependencies not installed. Run: npm install");
    process.exit(1);
  }

  const configPath = path.resolve(projectRoot, args.configPath ?? "config.json");
  const examplePath = path.resolve(projectRoot, "config.json.example");
  if (!exists(configPath)) {
    if (!exists(examplePath)) {
      console.error("Missing config.json and config.json.example.");
      process.exit(1);
    }
    writeFileIfMissing(configPath, fs.readFileSync(examplePath, "utf8"));
    console.log(`Created ${path.relative(projectRoot, configPath)} from config.json.example`);
  }

  // Default to simulation for safety.
  let mode = args.mode ?? "simulation";
  if (!args.mode && process.stdin.isTTY) {
    const answer = (await prompt("Run in simulation mode? (Y/n): ")).toLowerCase();
    if (answer === "n" || answer === "no") mode = "live";
  }

  if (mode === "live") {
    let hasPrivateKey = false;
    try {
      const cfg = readJson(configPath);
      const pk = cfg?.polymarket?.private_key;
      hasPrivateKey = typeof pk === "string" && pk.trim().length > 0;
    } catch {
      // If config is invalid JSON, let the underlying app surface the exact error.
    }

    if (!args.yesLive) {
      console.log("\nLIVE mode will place real orders on Polymarket.");
      if (!hasPrivateKey) {
        console.log("Warning: config.json does not appear to contain polymarket.private_key.");
      }
      const confirm = await prompt('Type "LIVE" to continue, or anything else to cancel: ');
      if (confirm !== "LIVE") {
        console.log("Cancelled.");
        process.exit(0);
      }
    }
  }

  console.log(`\nStarting bot (${mode})...\n`);

  const appArgs = ["tsx", "src/main-dual-limit-045.ts"];
  if (mode === "live") appArgs.push("--no-simulation");
  else appArgs.push("--simulation");
  if (args.configPath) appArgs.push("-c", args.configPath);

  let child;
  if (process.platform === "win32") {
    const psQuote = (s) => `'${String(s).replaceAll("'", "''")}'`;
    const cmdline = ["npx", ...appArgs].map(psQuote).join(" ");
    child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& ${cmdline}`],
      { cwd: projectRoot, stdio: "inherit", env: process.env }
    );
  } else {
    child = spawn("npx", appArgs, { cwd: projectRoot, stdio: "inherit", env: process.env });
  }

  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

