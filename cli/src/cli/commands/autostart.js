const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const BRAND = require("../../brand");

const USAGE = `Usage: ${BRAND.slug} autostart <command>

Commands:
  enable     Start ${BRAND.name} automatically at every logon, hidden, and keep it
             running after a crash (Windows: Startup-folder launcher + supervisor)
  disable    Remove the logon entry (does not stop a running gateway)
  status     Show whether auto-start is enabled
`;

function cliJsPath() {
  return path.resolve(__dirname, "..", "..", "..", "cli.js");
}

function watchdogPath() {
  return path.resolve(__dirname, "..", "tray", "watchdog.js");
}

function stateDir() {
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
    return path.join(base, BRAND.slug, "autostart");
  }
  return path.join(require("os").homedir(), `.${BRAND.slug}`, "autostart");
}

function appDir() {
  return path.resolve(path.dirname(cliJsPath()), "app");
}

function printStatus() {
  const { isAutoStartEnabled } = require("../tray/autostart");
  const enabled = isAutoStartEnabled();
  console.log(`${enabled ? "✅" : "❌"} Auto-start is ${enabled ? "enabled" : "disabled"}.`);

  if (enabled && process.platform === "win32") {
    const log = path.join(stateDir(), "watchdog.log");
    if (fs.existsSync(log)) {
      const lines = fs.readFileSync(log, "utf8").trim().split("\n").slice(-5);
      console.log(`\nLast supervisor activity (${log}):`);
      lines.forEach((line) => console.log(`  ${line}`));
    }
  }
}

async function run(args) {
  const command = args[0] || "status";

  if (command === "status") {
    printStatus();
    return 0;
  }

  if (command === "disable") {
    const { disableAutoStart } = require("../tray/autostart");
    const ok = disableAutoStart();
    console.log(ok ? `✅ Auto-start disabled — ${BRAND.name} will not start at logon.` : "❌ Could not remove the logon entry.");
    return ok ? 0 : 1;
  }

  if (command !== "enable") {
    console.log(USAGE);
    return command === "--help" || command === "-h" ? 0 : 2;
  }

  // The login item runs the bundled standalone server. Registering an entry that
  // points at a missing build would just restart-loop in the background, so make
  // the missing build the loud, actionable failure here instead.
  if (!fs.existsSync(path.join(appDir(), "server.js"))) {
    console.error("❌ No built app found at " + appDir());
    console.error("   Run `npm run launch` once (it builds the app) and then retry.");
    return 1;
  }

  const { enableAutoStart } = require("../tray/autostart");
  const ok = enableAutoStart(cliJsPath());
  if (!ok) {
    console.error("❌ Could not write the logon entry.");
    return 1;
  }

  console.log(`✅ ${BRAND.name} will start automatically at every logon, with no window.`);
  if (process.platform === "win32") {
    console.log(`   Supervisor log: ${path.join(stateDir(), "watchdog.log")}`);
  }

  // Start it now too, so enabling does not require a reboot to take effect. The
  // supervisor's lock file makes this a no-op if one is already running.
  if (process.platform === "win32" && fs.existsSync(watchdogPath())) {
    try {
      const child = spawn(process.execPath, [watchdogPath(), "--boot"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.unref();
      console.log("   Started in the background now (no window, survives crashes).");
    } catch (e) {
      console.log("   It will start at your next logon.");
    }
  }

  return 0;
}

module.exports = { run };
