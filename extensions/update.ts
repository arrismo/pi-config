import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

function commandBesideNode(command: string): string {
	const executable = process.platform === "win32" ? `${command}.cmd` : command;
	const besideNode = join(dirname(process.execPath), executable);
	return existsSync(besideNode) ? besideNode : executable;
}

function outputText(result: { stdout?: string; stderr?: string }): string {
	const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
	if (!output) return "(no output)";
	return output.length > 4000 ? `…${output.slice(-4000)}` : output;
}

function buildUpdateArgs(rawArgs: string): string[] {
	const tokens = rawArgs.split(/\s+/).filter(Boolean);
	const force = tokens.includes("--force") || tokens.includes("-f");
	const all = tokens.includes("--all") || tokens.includes("all");
	const extensions = tokens.includes("--extensions") || tokens.includes("extensions");

	const args = ["update"];
	if (extensions) args.push("--extensions");
	else if (!all) args.push("--self");
	if (force) args.push("--force");
	return args;
}

export default function updateExtension(pi: ExtensionAPI): void {
	pi.registerCommand("pi-update", {
		description: "Update pi to the latest release",
		handler: async (args, ctx) => {
			const tokens = args.split(/\s+/).filter(Boolean);
			const assumeYes = tokens.includes("--yes") || tokens.includes("-y");
			const piCommand = commandBesideNode("pi");
			const updateArgs = buildUpdateArgs(args);
			const displayCommand = `${piCommand} ${updateArgs.join(" ")}`;

			await ctx.waitForIdle();
			ctx.ui.setStatus("pi-update", "checking pi version…");

			try {
				const current = await pi.exec(piCommand, ["--version"], { timeout: 30_000 });
				const currentVersion = current.code === 0 ? current.stdout.trim() : "unknown";

				if (!assumeYes && ctx.hasUI) {
					const ok = await ctx.ui.confirm(
						"Update pi?",
						`Current pi: ${currentVersion}\n\nRun ${displayCommand}?\n\nUse /update --all to update pi and extensions.`,
					);
					if (!ok) {
						ctx.ui.notify("pi update cancelled", "info");
						return;
					}
				}

				ctx.ui.setStatus("pi-update", "updating pi…");
				ctx.ui.notify(`Running ${displayCommand} …`, "info");

				const result = await pi.exec(piCommand, updateArgs, { timeout: UPDATE_TIMEOUT_MS });
				if (result.code !== 0) {
					ctx.ui.notify(`pi update failed (exit ${result.code})\n\n${outputText(result)}`, "error");
					return;
				}

				const after = await pi.exec(piCommand, ["--version"], { timeout: 30_000 });
				const afterVersion = after.code === 0 ? after.stdout.trim() : "updated";
				ctx.ui.notify(`pi update complete. Version: ${afterVersion}\n\n${outputText(result)}\n\nRestart pi to use the new version.`, "info");

				if (ctx.hasUI) {
					const quit = await ctx.ui.confirm("Restart needed", "Quit pi now so you can restart with the updated version?");
					if (quit) ctx.shutdown();
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`pi update failed: ${message}`, "error");
			} finally {
				ctx.ui.setStatus("pi-update", undefined);
			}
		},
	});
}
