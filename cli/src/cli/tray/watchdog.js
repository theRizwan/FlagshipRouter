#!/usr/bin/env node

/**
 * Background supervisor for the Windows login item.
 *
 * `autostart.js` registers a hidden VBS launcher, which starts this file at every
 * logon. The supervisor then owns the gateway: it runs `cli.js --tray` (no console,
 * no browser) and relaunches it whenever it disappears — a crash, an OOM kill, or
 * an End task from Task Manager. Logon is the only time it starts on its own.
 *
 * A deliberate stop is signalled by writing the stop file (tray → Quit calls
 * requestStop()), so the supervisor does not fight the user. A single-instance
 * lock file prevents two supervisors from respawning over each other in a loop.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const BRAND = require("../../brand");

const CLI_JS = path.resolve(__dirname, "..", "..", "..", "cli.js");
const APP_DIR = path.resolve(path.dirname(CLI_JS), "app");

const RESTART_DELAY_MS = 5000;
// Ceiling for the crash backoff below; also long enough to be harmless if a
// broken build never starts at all.
const MAX_RESTART_DELAY_MS = 5 * 60 * 1000;
// A run that survives this long is treated as healthy, resetting the backoff.
const HEALTHY_RUN_MS = 60000;
// While another process owns the port (a dev session, another build) we wait quietly.
const PORT_BUSY_RECHECK_MS = 15000;
const MAX_LOG_BYTES = 512 * 1024;
// Matches the CLI's default; FLAGSHIPROUTER_PORT lets a custom port be supervised.
const PORT = parseInt(process.env.FLAGSHIPROUTER_PORT, 10) || 20128;

function autostartDir() {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming")
      : path.join(require("os").homedir(), `.${BRAND.slug}`);
  return path.join(base, BRAND.slug, "autostart");
}

const STATE_DIR = autostartDir();
const LOCK_FILE = path.join(STATE_DIR, "watchdog.lock");
const STOP_FILE = path.join(STATE_DIR, "watchdog.stop");
const LOG_FILE = path.join(STATE_DIR, "watchdog.log");

function ensureStateDir() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch {
    /* logging degrades to a no-op below */
  }
}

function log(message) {
  const line = `${new Date().toISOString()} [watchdog ${process.pid}] ${message}\n`;
  try {
    ensureStateDir();
    // Keep the log bounded — this file lives forever on the user's machine.
    try {
      if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) fs.truncateSync(LOG_FILE, 0);
    } catch {
      /* no log yet */
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* never let logging fail the supervisor */
  }
}

function isProcessAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim the single-instance lock. `wx` is an atomic exclusive create, so two
 * supervisors racing at logon cannot both win. A lock left by a dead PID (hard
 * reboot, Task Manager) is reclaimed instead of blocking startup forever.
 */
function acquireLock() {
  ensureStateDir();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") return false;
      let owner = 0;
      try {
        owner = parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10) || 0;
      } catch {
        /* unreadable lock is treated as stale */
      }
      if (owner && isProcessAlive(owner)) return false;
      try {
        fs.unlinkSync(LOCK_FILE);
      } catch {
        /* lost the race to another cleaner-up — retry once */
      }
    }
  }
  return false;
}

function releaseLock() {
  try {
    const owner = parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10);
    if (owner === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {
    /* already gone */
  }
}

function isStopRequested() {
  return fs.existsSync(STOP_FILE);
}

function clearStopRequest() {
  try {
    fs.unlinkSync(STOP_FILE);
  } catch {
    /* nothing to clear */
  }
}

const isBoot = process.argv.includes("--boot");

// A previous session may have ended with a deliberate stop (tray → Quit). Logon is
// a fresh start, so the marker is cleared there and only there.
if (isBoot) clearStopRequest();

if (!acquireLock()) {
  log("another supervisor owns the gateway — exiting");
  process.exit(0);
}

// The tray mode runs the bundled standalone server; without the bundle it would
// exit immediately and we would spin on a 5s restart loop forever.
if (!fs.existsSync(path.join(APP_DIR, "server.js"))) {
  log(`no standalone build at ${APP_DIR} — run "npm run launch" to build it; exiting`);
  releaseLock();
  process.exit(1);
}

let child = null;
let stopping = false;
let portHeldByOther = false;
let restartCount = 0;
let childStartedAt = 0;

/**
 * Is something already serving the gateway's port?
 *
 * `cli.js --tray` waits for the port to answer and does not displace a server that
 * already holds it — so launching over an occupied port leaves this gateway with no
 * server of its own while whatever held the port keeps running. That is a normal
 * state, not an error: a dev session, an older build, or a tray instance whose
 * supervisor died. We do not kill it. Killing a process we did not start could take
 * down work the user is running, so the supervisor defers instead and re-checks
 * until the port is free.
 */
function isPortServing(port) {
  return new Promise((resolve) => {
    const socket = require("net").connect({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1500, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function stopChild() {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    // child.kill() terminates the CLI outright on Windows, so its own cleanup never
    // runs and the standalone server it spawned detached would keep the port. Kill
    // the whole tree instead.
    try {
      require("child_process").execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 8000
      });
      return;
    } catch {
      /* fall through to the portable path */
    }
  }
  try {
    child.kill();
  } catch {
    /* already gone */
  }
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`received ${signal} — stopping gateway`);
  stopChild();
  releaseLock();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => shutdown(signal));

function startGateway() {
  log("starting gateway (--tray)");
  childStartedAt = Date.now();
  child = spawn(
    process.execPath,
    ["--dns-result-order=ipv4first", CLI_JS, "--tray", "--skip-update", "-p", String(PORT)],
    {
      cwd: path.dirname(CLI_JS),
      // No console: this process only ever runs from the hidden logon launcher.
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"]
    }
  );

  child.on("error", (err) => {
    log(`spawn failed: ${err.message}`);
    scheduleRestart();
  });

  child.on("exit", (code, signal) => {
    child = null;
    log(`gateway exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (stopping) return;
    // A run that lasted a while was healthy — next crash deserves a fast retry.
    if (Date.now() - childStartedAt >= HEALTHY_RUN_MS) restartCount = 0;
    if (isStopRequested()) {
      // Tray → Quit: the user asked for this, so honour it until next logon.
      clearStopRequest();
      log("stop requested — supervisor exiting");
      releaseLock();
      process.exit(0);
    }
    scheduleRestart();
  });
}

/**
 * Restart the gateway, backing off when it fails repeatedly.
 *
 * A gateway that dies instantly (a broken build, a port it cannot claim) would
 * otherwise respawn every few seconds for the whole uptime of the machine. Each
 * quick failure doubles the delay up to a ceiling; a run that stayed up long
 * enough to count as healthy resets it, so ordinary crashes still recover fast.
 */
function scheduleRestart() {
  if (stopping) return;
  const delay = Math.min(RESTART_DELAY_MS * 2 ** restartCount, MAX_RESTART_DELAY_MS);
  restartCount++;
  if (delay > RESTART_DELAY_MS) {
    log(`restarting in ${Math.round(delay / 1000)}s (after ${restartCount} quick failure(s))`);
  } else {
    log(`restarting in ${delay / 1000}s`);
  }
  setTimeout(() => {
    if (!stopping) attemptStart();
  }, delay);
}

/**
 * Resolve whether the port is currently served, then launch (or defer). The probe
 * runs before every start attempt so a later free-up is picked up automatically.
 */
function attemptStart() {
  if (stopping) return;
  isPortServing(PORT).then((serving) => {
    if (stopping) return;
    if (serving) {
      // Log the state change once, not on every poll — this can last all session.
      if (!portHeldByOther) {
        portHeldByOther = true;
        log(`port ${PORT} already served by another process — leaving it alone until it frees up`);
      }
      return setTimeout(attemptStart, PORT_BUSY_RECHECK_MS);
    }
    if (portHeldByOther) {
      portHeldByOther = false;
      log(`port ${PORT} is free — taking over`);
    }
    startGateway();
  });
}

log(`supervisor started${isBoot ? " at logon" : ""}`);
attemptStart();
