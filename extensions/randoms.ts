import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const SPIN_DURATION_MS = 2200;
const SPIN_INTERVAL_MS = 60;

function randomItem<T>(items: readonly T[]): T | undefined {
	return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: readonly T[]): T[] {
	const shuffled = [...items];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortId(model: Model<any>): string {
	const id = model.id;
	if (id.length <= 20) return id;
	return id.slice(0, 19) + "…";
}

function shortProvider(model: Model<any>): string {
	const p = model.provider;
	return p.length <= 12 ? p : p.slice(0, 11) + "…";
}

async function spinModels(
	ctx: {
		hasUI: boolean;
		ui: {
			setStatus(key: string, value: string | undefined): void;
			setWidget(key: string, value: string[] | undefined): void;
		};
	},
	models: readonly Model<any>[],
): Promise<{ model: Model<any>; thinkingLevel: (typeof THINKING_LEVELS)[number] }> {
	let index = Math.floor(Math.random() * models.length);
	let thinkingLevel = randomItem(THINKING_LEVELS) ?? "off";

	if (!ctx.hasUI) {
		return { model: models[index], thinkingLevel };
	}

	const ticks = Math.max(models.length * 3, Math.ceil(SPIN_DURATION_MS / SPIN_INTERVAL_MS));

	for (let tick = 0; tick < ticks; tick++) {
		index = (index + 1) % models.length;
		thinkingLevel = randomItem(THINKING_LEVELS) ?? "off";

		const progress = tick / Math.max(1, ticks - 1);
		const barLen = Math.floor(10 * progress);
		const bar = "[" + "=".repeat(barLen) + " ".repeat(10 - barLen) + "]";

		const selected = models[index];
		const above = models[(index - 1 + models.length) % models.length];
		const below = models[(index + 1) % models.length];

		const widget = [
			"/randoms — rolling...",
			"",
			`  ${shortId(above)}`,
			`> ${shortId(selected)}`,
			`  ${shortId(below)}`,
			"",
			`${bar} ${shortProvider(selected)}`,
			`  thinking level: ${thinkingLevel}`,
		];

		ctx.ui.setWidget("randoms", widget);
		ctx.ui.setStatus("randoms", `🎰 ${shortId(selected)} • ${thinkingLevel}`);

		const delay = Math.floor(SPIN_INTERVAL_MS * (1 - progress * 0.75));
		await sleep(delay);
	}

	return { model: models[index], thinkingLevel };
}

export default function randomsExtension(pi: ExtensionAPI): void {
	pi.registerCommand("randoms", {
		description: "Choose a random available model and thinking level",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			ctx.modelRegistry.refresh();

			let models: Model<any>[];
			try {
				models = await ctx.modelRegistry.getAvailable();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to load models: ${message}`, "error");
				return;
			}

			if (models.length === 0) {
				ctx.ui.notify("No available models found. Use /login to add providers.", "warning");
				return;
			}

			const spinResult = await spinModels(ctx, models);
			const fallbackModels = shuffle(models.filter((model) => model !== spinResult.model));
			const candidateModels = [spinResult.model, ...fallbackModels];

			let selectedModel: Model<any> | undefined;
			for (const model of candidateModels) {
				const success = await pi.setModel(model);
				if (success) {
					selectedModel = model;
					break;
				}
			}

			if (!selectedModel) {
				ctx.ui.setStatus("randoms", undefined);
				ctx.ui.setWidget("randoms", undefined);
				ctx.ui.notify("No random model could be selected because none had usable credentials.", "error");
				return;
			}

			const requestedThinkingLevel = spinResult.thinkingLevel;
			pi.setThinkingLevel(requestedThinkingLevel);
			const actualThinkingLevel = pi.getThinkingLevel();
			const thinkingText =
				actualThinkingLevel === requestedThinkingLevel
					? actualThinkingLevel
					: `${actualThinkingLevel} (requested ${requestedThinkingLevel}, clamped by model)`;

			const confetti = Array.from({ length: 3 }, () =>
				Array.from({ length: 4 }, () => randomItem(["✨", "🎉", "🌟", "💫"]) ?? "✨").join(" "),
			);

			ctx.ui.setWidget("randoms", [
				...confetti,
				"",
				"/randoms — landed!",
				"",
				`> ${shortId(selectedModel)}`,
				`  ${shortProvider(selectedModel)}`,
				`  thinking level: ${actualThinkingLevel}`,
			]);
			ctx.ui.setStatus("randoms", `✅ ${shortId(selectedModel)} • ${actualThinkingLevel}`);

			ctx.ui.notify(
				`Randomized: ${selectedModel.provider}/${selectedModel.id}\nThinking: ${thinkingText}`,
				"info",
			);

			await sleep(1500);
			ctx.ui.setStatus("randoms", undefined);
			ctx.ui.setWidget("randoms", undefined);
		},
	});
}
