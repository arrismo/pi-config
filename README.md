# pi-config

My shared pi extensions plus a cmux config.

## Install the pi extensions

Install from a local clone:

```bash
pi install .
```

Or from GitHub:

```bash
pi install https://github.com/mmoise/pi-config
```

Use `-l` to install into project settings instead of your global pi settings:

```bash
pi install -l https://github.com/mmoise/pi-config
```

You can also copy files from `extensions/` into `~/.pi/agent/extensions/` manually.

## Included extensions

- `clipboard-notify`
- `cmux-autotitle`
- `exit`
- `learn-codebase`
- `notification`
- `plan-mode`
- `update`
- `web-tools`
- `yeet`

## cmux config

`cmux/cmux.json` is a [cmux](https://manaflow.ai/cmux) config file using JSONC (JSON with comments). Uncomment any setting to override the cmux UI defaults.

Install it with:

```bash
mkdir -p ~/.config/cmux
cp cmux/cmux.json ~/.config/cmux/cmux.json
```

Reload cmux config with **Cmd+Shift+,** or restart cmux.

### Configured features

- **cmux-autotitle** — auto-rename cmux tabs and workspaces from your first pi prompt
- **Agent session auto-resume** — restore previous agent sessions on launch
- **Claude Code / Cursor / Gemini integration** — coding agent sidebar panels
- **Terminal link interception** — open URLs from terminal output in the embedded browser
- **Embedded browser** — system-theme browser with local host allowlist and React Grab
- **Workspace colors** — 16 named presets with left-rail indicators
- **Notification hooks** — custom sounds, pane flash, dock badge, menu bar display
- **Custom shortcuts** — full keybinding overrides for splits, panes, browser, and more

## Inspiration

- [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup)
- [mohak34/opencode-notifier](https://github.com/mohak34/opencode-notifier)

