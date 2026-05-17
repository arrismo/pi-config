import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const YEET_PROMPT = `Commit and push the current repository changes.

Important Safety Rules:
1. NEVER commit .env files or any files containing secrets, API keys, passwords, or credentials.
2. NEVER commit files that are listed in .gitignore - the user chose to ignore them for a reason.
3. NEVER commit node_modules/, vendor/, build/, dist/, or other dependency/generated directories.
4. If unsure whether to commit a specific file or folder (e.g., config files, local overrides, sensitive data), ask the user before committing.

Commit Steps:
1. Run \`git status\` to see all unstaged changes.
2. Run \`git diff --cached\` or examine each file to verify its contents are safe to commit.
3. Explicitly add only the files/folders that are appropriate:
   - Source code changes ✓
   - Config files (if intentional) ✓
   - Documentation ✓
   - Tests ✓
   - Package lock files (package-lock.json, yarn.lock, etc.) ✓
   - But NOT: .env, .env.*, secrets, credentials, node_modules/, vendor/, .gitignore'd files ✗
4. Write a concise commit message that accurately summarizes the staged changes.
5. Commit the changes with that message.
6. Push the commit to the current branch's remote.
   - If the current branch does not have an upstream remote branch, create one by pushing with upstream tracking.
   - If this repository has no git remotes configured, do not push.
7. After pushing, output the remote URL for what was pushed if the repository has a remote.
   - If the current branch is \`main\`, output the normal remote repository URL.
   - If the current branch is not \`main\`, output a URL to create a pull request from the pushed branch into \`main\`.
   - Convert SSH git remotes like \`git@github.com:owner/repo.git\` to HTTPS URLs when printing.

Keep the commit message concise.`;

export default function (pi: ExtensionAPI) {
	pi.registerCommand("yeet", {
		description: "Add, commit, and push the current repo changes",
		handler: async (args, ctx) => {
			const prompt = args?.trim()
				? `${YEET_PROMPT}\n\nAdditional instructions from the user:\n${args.trim()}`
				: YEET_PROMPT;

			if (ctx.isIdle()) {
				pi.sendUserMessage(prompt);
			} else {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
				ctx.ui.notify("Queued /yeet as a follow-up", "info");
			}
		},
	});
}
