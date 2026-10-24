# flagshiprouter (CLI)

Launcher for [FlagshipRouter](https://github.com/theRizwan/FlagshipRouter) — a local AI gateway that routes Claude Code, Codex, Cursor, Cline, OpenCode and other coding tools to free AI models.

```bash
flagshiprouter
```

Starts the router on `http://localhost:20128`, opens the browser UI, and keeps a terminal menu for the terminal UI, tray mode and exit.

| Option | Description |
| --- | --- |
| `-p, --port <port>` | Port to run the server (default `20128`) |
| `-H, --host <host>` | Host to bind (default `0.0.0.0`; use `127.0.0.1` for local-only) |
| `-n, --no-browser` | Don't open the browser UI on start |
| `-l, --log` | Show server logs |
| `-t, --tray` | Run in the system tray (background) |
| `-v, --version` | Show version |

## Auto-start at logon

```bash
flagshiprouter autostart enable    # start hidden at every logon; keep it running
flagshiprouter autostart status    # show whether it is enabled
flagshiprouter autostart disable   # remove the logon entry
```

On Windows this writes a hidden launcher to your Startup folder that runs a supervisor. The supervisor starts the gateway with no console window and relaunches it if it crashes or is ended from Task Manager, backing off if it keeps failing. It needs no administrator rights, and nothing is installed system-wide.

To stop it on purpose, use the tray icon → **Quit**: the supervisor honours that and stays down until the next logon. `disable` removes the logon entry (it does not stop a gateway that is already running).

Supervisor activity is logged to `%APPDATA%\flagshiprouter\autostart\watchdog.log`.

Data lives in `~/.flagshiprouter/` (macOS/Linux) or `%APPDATA%\flagshiprouter\` (Windows); set `DATA_DIR` to move it.

The product name, command name and data folder come from `brand.json` in the repository.
