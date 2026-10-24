# Changelog

## Unreleased

### Added
- `flagshiprouter autostart <enable|disable|status>`: start the gateway automatically at every logon, hidden, and keep it running. The logon entry launches a supervisor (`cli/src/cli/tray/watchdog.js`) that runs the gateway with no console window and relaunches it after a crash or an End task, with backoff if it keeps failing. `tray → Quit` still stops it deliberately, and it returns at the next logon. No administrator rights required.

### Fixed
- The CLI's startup kill sweep matched any node process whose command line mentioned the brand slug, which included the supervisor that launched it — so a supervised gateway killed its own supervisor. Ancestors of the running CLI (and the CLI itself) are now excluded from that sweep.

## 1.1.0 — 2026-10-20

### Fixed
- OpenCode Free models work again: requests use OpenCode's new free-tier endpoint and client identity.

### Changed
- Routing engine update: newer provider fixes (OpenCode Zen/Go, Claude, Codex, Qoder and more), per-key model access controls on the Endpoint page, Hermes profile support, and the `connect` / `show` CLI commands for pointing local tools at a remote router.

## 1.0.0 — 2026-09-27

First FlagshipRouter release.

### Added
- `brand.json`: single source for the product name, CLI command, data folder, the provider key tools show on models, repository links and the provider policy. `npm run brand:sync` stamps it into both `package.json` files.
- Free-provider policy: only providers with a free offer (`free` / `freeTier` categories and `hasFree` entries) appear in the dashboard, can be connected, or receive routed traffic.
- Models screen (`/dashboard/models`, API `/api/models/catalog`): every model from the free providers with ready/connect status, filters and one-click test. It replaces the provider list.
- New dashboard design: signal-indigo palette, navy command rail with grouped navigation and live router status, copyable endpoint chip, new logo and icons.
- The CLI opens the browser UI as soon as the server is ready (`--no-browser` to skip).
- `npm run launch`: one command from a fresh clone — installs dependencies, builds the CLI bundle when missing or stale, and starts the CLI.

### Removed
- Gemini, Gemini CLI and Antigravity providers (`brand.json` → `providers.exclude`) and the Antigravity IDE card in CLI Tools. Their Google OAuth clients and Windsurf's Firebase key are no longer embedded in the code; they are read from `ANTIGRAVITY_OAUTH_CLIENT_*`, `GEMINI_CLI_OAUTH_CLIENT_*` and `WINDSURF_FIREBASE_API_KEY` if you re-enable those providers.
- Third-party promos, the Donate button, Google Analytics, the marketing landing page and docs site, and the default cloud-sync URL.
- Usage and Quota Tracker from the navigation (pages remain at their URLs).
- npm update checks until the package is published (`brand.json` → `updateCheck`).
