#!/usr/bin/env node
// make-company CLI — thin Node wrapper that dispatches to the Bash scripts
// shipped inside the npm package. The real work lives in install.sh / vc-launch.sh.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const TEMPLATE_DIR = join(PKG_ROOT, "template");
const INSTALL_SH = join(PKG_ROOT, "install.sh");
const LAUNCH_SH = join(PKG_ROOT, "vc-launch.sh");

const PKG = JSON.parse(
  readFileSync(join(PKG_ROOT, "package.json"), "utf8")
);

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const VIOLET = "\x1b[38;5;141m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

function log(...args) {
  console.log(...args);
}

function fail(msg, code = 1) {
  console.error(`${RED}✗${RESET} ${msg}`);
  process.exit(code);
}

function checkDeps() {
  const missing = [];
  for (const cmd of ["bash", "tmux", "python3"]) {
    const r = spawnSync(cmd, ["--version"], { stdio: "ignore" });
    if (r.error || r.status !== 0) missing.push(cmd);
  }
  if (missing.length) {
    fail(
      `Missing required commands: ${missing.join(", ")}\n` +
        `  macOS: brew install ${missing.join(" ")}\n` +
        `  Linux: apt install ${missing.join(" ")}`
    );
  }
}

function runBash(script, args = [], opts = {}) {
  if (!existsSync(script)) {
    fail(`Script not found: ${script}`);
  }
  const r = spawnSync("bash", [script, ...args], {
    stdio: "inherit",
    cwd: opts.cwd ?? process.cwd(),
    env: {
      ...process.env,
      VC_TEMPLATE: PKG_ROOT,
      ...opts.env,
    },
  });
  if (r.error) fail(String(r.error));
  process.exit(r.status ?? 0);
}

function showHelp() {
  log(`${BOLD}${VIOLET}make-company${RESET} ${DIM}v${PKG.version}${RESET}`);
  log("");
  log("  Spin up an entire AI company in your terminal.");
  log("");
  log(`${BOLD}USAGE${RESET}`);
  log(`  ${VIOLET}make-company${RESET} ${DIM}[command]${RESET}`);
  log(`  ${VIOLET}vc${RESET} ${DIM}[command]${RESET}              ${DIM}# short alias${RESET}`);
  log("");
  log(`${BOLD}COMMANDS${RESET}`);
  log(`  ${GREEN}(none)${RESET}              Install if missing, then launch tmux + claude`);
  log(`  ${GREEN}init${RESET}                Install template into ./.claude/company`);
  log(`  ${GREEN}start${RESET}               Start tmux session for an existing company`);
  log(`  ${GREEN}stop${RESET}                Stop the running tmux session`);
  log(`  ${GREEN}kickoff${RESET} ${DIM}<task>${RESET}      Send a task to the Orchestrator`);
  log(`  ${GREEN}dashboard${RESET}           Open dashboard in your browser`);
  log(`  ${GREEN}where${RESET}               Print the package install path`);
  log(`  ${GREEN}--version${RESET}, ${GREEN}-v${RESET}      Show version`);
  log(`  ${GREEN}--help${RESET}, ${GREEN}-h${RESET}         Show this help`);
  log("");
  log(`${BOLD}EXAMPLES${RESET}`);
  log(`  ${DIM}# Install + launch in current project (interactive preset menu)${RESET}`);
  log(`  ${VIOLET}npx make-company${RESET}`);
  log("");
  log(`  ${DIM}# Or globally${RESET}`);
  log(`  ${VIOLET}npm install -g make-company${RESET}`);
  log(`  ${VIOLET}make-company${RESET}`);
  log("");
  log(`  ${DIM}# Send a task${RESET}`);
  log(`  ${VIOLET}vc kickoff${RESET} ${DIM}'Stripe checkout 페이지 만들기'${RESET}`);
  log("");
  log(`${BOLD}DOCS${RESET}  ${PKG.homepage}`);
}

function showVersion() {
  log(`make-company ${PKG.version}`);
}

function getCompanyDir() {
  return join(process.cwd(), ".claude", "company");
}

function readSessionName(companyDir) {
  const cfg = join(companyDir, "config.json");
  if (!existsSync(cfg)) return null;
  try {
    const data = JSON.parse(readFileSync(cfg, "utf8"));
    return data.session_name || "company";
  } catch {
    return null;
  }
}

function cmdInit() {
  checkDeps();
  runBash(INSTALL_SH, [getCompanyDir()]);
}

function cmdStart() {
  checkDeps();
  const dir = getCompanyDir();
  if (!existsSync(join(dir, "config.json"))) {
    fail(
      `No company found at .claude/company. Run ${VIOLET}make-company init${RESET} first.`
    );
  }
  runBash(join(dir, "run.sh"));
}

function cmdStop() {
  const dir = getCompanyDir();
  const stop = join(dir, "stop.sh");
  if (!existsSync(stop)) fail("No company found.");
  runBash(stop);
}

function cmdKickoff(args) {
  const dir = getCompanyDir();
  const kickoff = join(dir, "kickoff.sh");
  if (!existsSync(kickoff)) {
    fail(`No company found. Run ${VIOLET}make-company${RESET} first.`);
  }
  if (args.length === 0) {
    fail("Usage: make-company kickoff '<task description>'");
  }
  runBash(kickoff, [args.join(" ")]);
}

function cmdDashboard() {
  const dir = getCompanyDir();
  if (!existsSync(join(dir, "config.json"))) {
    fail(`No company found. Run ${VIOLET}make-company init${RESET} first.`);
  }
  let port = 7777;
  try {
    const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    port = cfg.dashboard_port || 7777;
  } catch {}
  const url = `http://localhost:${port}`;
  log(`${VIOLET}▸${RESET} Opening ${url}`);
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawnSync(opener, [url], { stdio: "ignore", detached: true });
}

function cmdLaunch() {
  checkDeps();
  runBash(LAUNCH_SH);
}

function cmdWhere() {
  log(PKG_ROOT);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd) return cmdLaunch();

  switch (cmd) {
    case "-h":
    case "--help":
    case "help":
      return showHelp();
    case "-v":
    case "--version":
    case "version":
      return showVersion();
    case "init":
      return cmdInit();
    case "start":
    case "run":
      return cmdStart();
    case "stop":
      return cmdStop();
    case "kickoff":
      return cmdKickoff(argv.slice(1));
    case "dashboard":
    case "open":
      return cmdDashboard();
    case "where":
      return cmdWhere();
    default:
      fail(`Unknown command: ${cmd}\n  Run ${VIOLET}make-company --help${RESET}`);
  }
}

main();
