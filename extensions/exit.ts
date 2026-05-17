import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function exitExtension(pi: ExtensionAPI): void {
	pi.registerCommand("exit", {
		description: "Quit pi",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});
}
