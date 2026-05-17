import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const CHILD_ENV = "PI_CMUX_AUTOTITLE_CHILD";
const MAX_PROMPT_CHARS = 6000;
const MAX_TITLE_CHARS = 48;
const TITLE_TIMEOUT_MS = 45_000;
const CMUX_TIMEOUT_MS = 5_000;

type ExecResult = { stdout?: string; stderr?: string; code?: number | null };
type AnyEntry = { type?: string; customType?: string; message?: { role?: string } };

function commandBesideNode(command: string): string {
	const executable = process.platform === "win32" ? `${command}.cmd` : command;
	const besideNode = join(dirname(process.execPath), executable);
	return existsSync(besideNode) ? besideNode : command;
}

function cmuxCommand(): string {
	const bundled = process.env.CMUX_BUNDLED_CLI_PATH;
	if (bundled && existsSync(bundled)) return bundled;
	if (existsSync("/Applications/cmux.app/Contents/Resources/bin/cmux")) {
		return "/Applications/cmux.app/Contents/Resources/bin/cmux";
	}
	return "cmux";
}

function isInCmux(): boolean {
	return Boolean(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID || process.env.CMUX_SOCKET_PATH);
}

function hasPriorUserMessage(entries: AnyEntry[]): boolean {
	return entries.some((entry) => entry.type === "message" && entry.message?.role === "user");
}

function cleanTitle(raw: string): string | undefined {
	let title = raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);

	if (!title) return undefined;
	title = title
		.replace(/^```(?:\w+)?\s*/i, "")
		.replace(/```$/i, "")
		.replace(/^(?:title|tab title|name)\s*:\s*/i, "")
		.replace(/^[-*•]\s+/, "")
		.replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, "")
		.replace(/[\t\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	// Keep cmux titles compact and shell-safe-looking.
	title = title.replace(/[<>|{}[\]\\]/g, "").trim();
	if (title.length > MAX_TITLE_CHARS) title = title.slice(0, MAX_TITLE_CHARS).replace(/\s+\S*$/, "").trim();
	return title || undefined;
}

function fallbackTitle(prompt: string): string {
	const stopWords = new Set([
		"a",
		"an",
		"and",
		"are",
		"as",
		"at",
		"be",
		"by",
		"can",
		"for",
		"from",
		"how",
		"i",
		"in",
		"is",
		"it",
		"me",
		"of",
		"on",
		"or",
		"please",
		"the",
		"this",
		"to",
		"with",
		"you",
	]);

	const words = prompt
		.toLowerCase()
		.replace(/`[^`]*`/g, " ")
		.replace(/https?:\/\/\S+/g, " ")
		.match(/[a-z0-9][a-z0-9-]{1,}/g)
		?.filter((word) => !stopWords.has(word))
		.slice(0, 5);

	return cleanTitle(words?.join(" ") ?? "pi session") ?? "pi session";
}

function isDefaultWorkspaceTitle(title: string | undefined): boolean {
	if (!title) return true;
	const value = title.trim();
	return /^(?:\(?\s*workspace\s+\d+\s*\)?|terminal\s+\d+|untitled(?:\s+\d+)?|new workspace)$/i.test(value);
}

async function currentWorkspaceHasDefaultTitle(pi: ExtensionAPI, cmux: string, workspaceId?: string): Promise<boolean> {
	const args = workspaceId ? ["tree", "--json", "--workspace", workspaceId] : ["list-workspaces", "--json"];
	const result = await pi.exec(cmux, args, { timeout: CMUX_TIMEOUT_MS });
	if (result.code !== 0) return false;

	try {
		if (workspaceId) {
			const parsed = JSON.parse(result.stdout) as {
				windows?: Array<{ workspaces?: Array<{ active?: boolean; selected?: boolean; title?: string }> }>;
			};
			const workspaces = parsed.windows?.flatMap((window) => window.workspaces ?? []) ?? [];
			const workspace = workspaces.find((item) => item.active || item.selected) ?? workspaces[0];
			return isDefaultWorkspaceTitle(workspace?.title);
		}

		const parsed = JSON.parse(result.stdout) as { workspaces?: Array<{ selected?: boolean; title?: string }> };
		const workspace = parsed.workspaces?.find((item) => item.selected) ?? parsed.workspaces?.[0];
		return isDefaultWorkspaceTitle(workspace?.title);
	} catch {
		return false;
	}
}

async function generateTitle(pi: ExtensionAPI, prompt: string, cwd: string): Promise<string> {
	const piCommand = commandBesideNode("pi");
	const systemPrompt = [
		"You name terminal tabs for coding-agent conversations.",
		"Return only a concise 2-5 word title, no quotes, no markdown, no punctuation.",
		"Prefer specific nouns from the user's task.",
	].join(" ");
	const userPrompt = `Working directory: ${cwd}\n\nFirst user message:\n${prompt.slice(0, MAX_PROMPT_CHARS)}`;

	try {
		const result: ExecResult = await pi.exec(
			piCommand,
			[
				"--print",
				"--no-session",
				"--no-extensions",
				"--no-tools",
				"--no-context-files",
				"--no-skills",
				"--no-prompt-templates",
				"--thinking",
				"off",
				"--system-prompt",
				systemPrompt,
				userPrompt,
			],
			{ timeout: TITLE_TIMEOUT_MS },
		);

		if (result.code === 0) {
			const title = cleanTitle(result.stdout ?? "");
			if (title) return title;
		}
	} catch {
		// Fall through to the local heuristic. Autotitling should never affect the user's turn.
	}

	return fallbackTitle(prompt);
}

async function renameCmux(pi: ExtensionAPI, title: string): Promise<void> {
	const cmux = cmuxCommand();
	const workspaceId = process.env.CMUX_WORKSPACE_ID;
	const surfaceId = process.env.CMUX_SURFACE_ID;
	const shouldRenameWorkspace = await currentWorkspaceHasDefaultTitle(pi, cmux, workspaceId);

	const tabArgs = ["rename-tab"];
	if (workspaceId) tabArgs.push("--workspace", workspaceId);
	if (surfaceId) tabArgs.push("--surface", surfaceId);
	tabArgs.push("--title", title);
	await pi.exec(cmux, tabArgs, { timeout: CMUX_TIMEOUT_MS });

	if (shouldRenameWorkspace) {
		const workspaceArgs = ["rename-workspace"];
		if (workspaceId) workspaceArgs.push("--workspace", workspaceId);
		workspaceArgs.push("--", title);
		await pi.exec(cmux, workspaceArgs, { timeout: CMUX_TIMEOUT_MS });
	}
}

export default function cmuxAutotitle(pi: ExtensionAPI): void {
	if (process.env[CHILD_ENV] === "1" || !isInCmux()) return;

	let kickedOff = false;

	pi.on("session_start", (_event, ctx) => {
		kickedOff = hasPriorUserMessage(ctx.sessionManager.getBranch() as AnyEntry[]);
	});

	pi.on("input", (event, ctx) => {
		if (kickedOff) return;
		if (event.source === "extension") return;
		if (event.text.trim().startsWith("/")) return;
		if (hasPriorUserMessage(ctx.sessionManager.getBranch() as AnyEntry[])) return;

		kickedOff = true;
		const firstPrompt = event.text;
		const cwd = ctx.cwd;

		void (async () => {
			try {
				const title = await generateTitle(pi, firstPrompt, cwd);
				await renameCmux(pi, title);
			} catch {
				// Best-effort only; never interrupt the coding-agent session.
			}
		})();
	});
}
