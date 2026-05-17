import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 900;
const MAX_CLIPBOARD_BYTES = 10 * 1024 * 1024;

async function readClipboard(): Promise<string | undefined> {
	try {
		if (process.platform === "darwin") {
			const { stdout } = await execFileAsync("pbpaste", [], { maxBuffer: MAX_CLIPBOARD_BYTES });
			return stdout;
		}

		if (process.env.WAYLAND_DISPLAY) {
			const { stdout } = await execFileAsync("wl-paste", ["--no-newline"], { maxBuffer: MAX_CLIPBOARD_BYTES });
			return stdout;
		}

		if (process.env.DISPLAY) {
			const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-out"], {
				maxBuffer: MAX_CLIPBOARD_BYTES,
			});
			return stdout;
		}
	} catch {
		return undefined;
	}

	return undefined;
}

export default function clipboardNotify(pi: ExtensionAPI): void {
	let timer: ReturnType<typeof setInterval> | undefined;
	let lastClipboard: string | undefined;
	let polling = false;

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI || timer) return;

		lastClipboard = await readClipboard();
		timer = setInterval(() => {
			if (polling) return;
			polling = true;

			void (async () => {
				try {
					const current = await readClipboard();
					if (current === undefined) return;

					if (lastClipboard !== undefined && current !== lastClipboard) {
						ctx.ui.notify("Copied selection to clipboard", "info");
					}

					lastClipboard = current;
				} finally {
					polling = false;
				}
			})();
		}, POLL_INTERVAL_MS);
	});

	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	});
}
