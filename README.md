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

This repo also includes `cmux/cmux.json`.

Install it with:

```bash
mkdir -p ~/.config/cmux
cp cmux/cmux.json ~/.config/cmux/cmux.json
```

## Notes

- `cmux-autotitle` only does anything inside cmux.
- `notification` currently uses macOS notifications.
- `clipboard-notify` uses `pbpaste` on macOS and `wl-paste`/`xclip` on Linux.
- `web-tools` can use `EXA_API_KEY` or `PARALLEL_API_KEY`.
- No auth or session files are exported here.
