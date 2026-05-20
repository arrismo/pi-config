import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RESTART_LOG = "/tmp/cmux-restart.log";

export default function cmuxRestart(pi: ExtensionAPI): void {
	pi.registerCommand("cmux-restart", {
		description: "Restart the cmux macOS app",
		handler: async (_args, ctx) => {
			const ok = await ctx.ui.confirm(
				"Restart cmux?",
				"This will quit cmux and may close this terminal/session. Continue?",
			);
			if (!ok) return;

			ctx.ui.notify("Restarting cmux…", "info");

			await pi.exec(
				"/bin/sh",
				[
					"-lc",
					[
						`nohup /bin/sh -c '`,
						`osascript -e "quit app \\"cmux\\"";`,
						"sleep 2;",
						"open -a cmux",
						`' >${RESTART_LOG} 2>&1 &`,
					].join(" "),
				],
				{ timeout: 5_000 },
			);

			ctx.shutdown();
		},
	});
}
