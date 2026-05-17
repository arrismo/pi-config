import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Typebox string-enum helper (Union of Literals) */
function StrEnum<T extends readonly string[]>(values: T, opts?: { description?: string }) {
	return Type.Union(values.map((v) => Type.Literal(v)) as any, opts as any);
}

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB, matching opencode
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const SEARCH_TIMEOUT_MS = 25_000;
const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

const WEBFETCH_DESCRIPTION = `- Fetches content from a specified URL
- Takes a URL and optional format as input
- Fetches the URL content, converts to requested format (markdown by default)
- Returns the content in the specified format
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: if another tool is present that offers better web fetching capabilities, is more targeted to the task, or has fewer restrictions, prefer using that tool instead of this one.
  - The URL must be a fully-formed valid URL
  - Format options: "markdown" (default), "text", or "html"
  - This tool is read-only and does not modify any files
  - Results are truncated to ${formatSize(DEFAULT_MAX_BYTES)} or ${DEFAULT_MAX_LINES} lines, whichever comes first, with full output saved to a temp file when truncated`;

const WEBSEARCH_DESCRIPTION = `- Search the web using an opencode-style MCP web search provider - performs real-time web searches and can scrape content from relevant URLs
- Provides up-to-date information for current events and recent data
- Supports configurable result counts and returns content from the most relevant websites
- Use this tool for accessing information beyond knowledge cutoff
- Searches are performed automatically within a single API call

Usage notes:
  - Supports live crawling modes when available: 'fallback' (backup if cached unavailable) or 'preferred' (prioritize live crawling)
  - Search types when available: 'auto' (balanced), 'fast' (quick results), 'deep' (comprehensive search)
  - Configurable context length for optimal LLM integration
  - Set OPENCODE_WEBSEARCH_PROVIDER or PI_WEBSEARCH_PROVIDER to 'exa' or 'parallel' to force a provider
  - Set EXA_API_KEY and/or PARALLEL_API_KEY for authenticated provider access

The current year is ${new Date().getFullYear()}. You MUST use this year when searching for recent information or current events.`;

type WebSearchProvider = "exa" | "parallel";

type McpToolTextResponse = {
	result?: { content?: Array<{ type?: string; text?: string }> };
	error?: { message?: string };
};

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
	const abort = () => controller.abort(signal?.reason);
	signal?.addEventListener("abort", abort, { once: true });
	controller.signal.addEventListener(
		"abort",
		() => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		},
		{ once: true },
	);
	return controller.signal;
}

function acceptHeader(format: "text" | "markdown" | "html"): string {
	switch (format) {
		case "markdown":
			return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
		case "text":
			return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
		case "html":
			return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
	}
}

function decodeEntities(input: string): string {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
	};
	return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
		if (entity[0] === "#") {
			const code = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
		}
		return named[entity.toLowerCase()] ?? _match;
	});
}

function stripUnsafeHtml(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
		.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
		.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
		.replace(/<embed\b[^>]*>[\s\S]*?<\/embed>/gi, "");
}

function extractTextFromHtml(html: string): string {
	return decodeEntities(
		stripUnsafeHtml(html)
			.replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6])>/gi, "\n")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
			.replace(/[ \t]+/g, " ")
			.replace(/\n\s+/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
	);
}

function htmlToMarkdown(html: string): string {
	let out = stripUnsafeHtml(html);
	out = out.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, text: string) => {
		return `\n${"#".repeat(Number(level))} ${extractTextFromHtml(text)}\n`;
	});
	out = out.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
		const label = extractTextFromHtml(text) || href;
		return `[${label}](${href})`;
	});
	out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, text: string) => `\n- ${extractTextFromHtml(text)}`);
	out = out.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, text: string) => `\n\n\`\`\`\n${decodeEntities(text.replace(/<[^>]+>/g, ""))}\n\`\`\`\n`);
	return extractTextFromHtml(out).replace(/\n{3,}/g, "\n\n");
}

function contentForFormat(content: string, contentType: string, format: "text" | "markdown" | "html"): string {
	const isHtml = contentType.toLowerCase().includes("text/html") || /<html[\s>]/i.test(content);
	if (format === "html") return content;
	if (!isHtml) return content;
	return format === "markdown" ? htmlToMarkdown(content) : extractTextFromHtml(content);
}

async function readResponseLimited(response: Response): Promise<ArrayBuffer> {
	const contentLength = response.headers.get("content-length");
	if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
		throw new Error("Response too large (exceeds 5MB limit)");
	}
	const buffer = await response.arrayBuffer();
	if (buffer.byteLength > MAX_RESPONSE_SIZE) throw new Error("Response too large (exceeds 5MB limit)");
	return buffer;
}

async function formatToolOutput(label: string, text: string): Promise<{ text: string; details: Record<string, unknown> }> {
	const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	const details: Record<string, unknown> = {
		truncated: truncation.truncated,
		totalLines: truncation.totalLines,
		totalBytes: truncation.totalBytes,
	};
	if (!truncation.truncated) return { text: truncation.content, details };

	const dir = await mkdir(join(tmpdir(), "pi-web-tools"), { recursive: true }).then(() => join(tmpdir(), "pi-web-tools"));
	const file = join(dir, `${Date.now()}-${label.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40)}.txt`);
	await writeFile(file, text, "utf8");
	details.fullOutputFile = file;
	return {
		text: `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(
			truncation.outputBytes,
		)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${file}]`,
		details,
	};
}

function checksum(input: string): number {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) hash = (hash * 33) ^ input.charCodeAt(i);
	return Math.abs(hash >>> 0);
}

function selectWebSearchProvider(ctx: ExtensionContext): WebSearchProvider {
	const override = process.env.PI_WEBSEARCH_PROVIDER ?? process.env.OPENCODE_WEBSEARCH_PROVIDER;
	if (override === "exa" || override === "parallel") return override;
	if (process.env.PARALLEL_API_KEY && !process.env.EXA_API_KEY) return "parallel";
	if (process.env.EXA_API_KEY && !process.env.PARALLEL_API_KEY) return "exa";
	const session = ctx.sessionManager.getSessionFile() ?? ctx.cwd;
	return checksum(session) % 2 === 0 ? "exa" : "parallel";
}

function providerUrl(provider: WebSearchProvider): string {
	if (provider === "parallel") return "https://search.parallel.ai/mcp";
	const key = process.env.EXA_API_KEY;
	return key ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(key)}` : "https://mcp.exa.ai/mcp";
}

function parseMcpPayload(payload: string): string | undefined {
	const trimmed = payload.trim();
	if (!trimmed.startsWith("{")) return undefined;
	const data = JSON.parse(trimmed) as McpToolTextResponse;
	if (data.error?.message) throw new Error(data.error.message);
	return data.result?.content?.find((item) => item.text)?.text;
}

function parseMcpResponse(body: string): string | undefined {
	const direct = body.trim() ? parseMcpPayload(body) : undefined;
	if (direct) return direct;
	for (const line of body.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const parsed = parseMcpPayload(line.slice(6));
		if (parsed) return parsed;
	}
	return undefined;
}

async function callWebSearchProvider(
	provider: WebSearchProvider,
	params: { query: string; numResults?: number; livecrawl?: "fallback" | "preferred"; type?: "auto" | "fast" | "deep"; contextMaxCharacters?: number },
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
): Promise<string> {
	const headers: Record<string, string> = { Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
	let body: unknown;

	if (provider === "parallel") {
		headers["User-Agent"] = "pi-coding-agent/opencode-websearch";
		if (process.env.PARALLEL_API_KEY) headers.Authorization = `Bearer ${process.env.PARALLEL_API_KEY}`;
		body = {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "web_search",
				arguments: {
					objective: params.query,
					search_queries: [params.query],
					session_id: ctx.sessionManager.getSessionFile() ?? ctx.cwd,
					model_name: typeof ctx.model?.id === "string" ? ctx.model.id.slice(0, 100) : undefined,
				},
			},
		};
	} else {
		body = {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "web_search_exa",
				arguments: {
					query: params.query,
					type: params.type ?? "auto",
					numResults: params.numResults ?? 8,
					livecrawl: params.livecrawl ?? "fallback",
					contextMaxCharacters: params.contextMaxCharacters,
				},
			},
		};
	}

	const response = await fetch(providerUrl(provider), {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal: withTimeout(signal, SEARCH_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`${provider} web search failed: ${response.status} ${response.statusText}`);
	return parseMcpResponse(await response.text()) ?? "No search results found. Please try a different query.";
}

export default function webTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "webfetch",
		label: "Web Fetch",
		description: WEBFETCH_DESCRIPTION,
		promptSnippet: "Fetch content from a URL and return text, markdown, or HTML.",
		promptGuidelines: [
			"Use webfetch when the user gives a specific URL and asks for current web content from that URL.",
			"Use webfetch only with fully formed http:// or https:// URLs.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch content from" }),
			format: Type.Optional(StrEnum(["text", "markdown", "html"] as const, { description: "Return format. Defaults to markdown." })),
			timeout: Type.Optional(Type.Number({ description: "Optional timeout in seconds (max 120)" })),
		}),
		async execute(_toolCallId, params, signal) {
			const url = params.url;
			if (!url.startsWith("http://") && !url.startsWith("https://")) throw new Error("URL must start with http:// or https://");

			const format = params.format ?? "markdown";
			const timeoutSeconds = Math.min(Math.max(params.timeout ?? DEFAULT_TIMEOUT_SECONDS, 1), MAX_TIMEOUT_SECONDS);
			const headers = {
				"User-Agent": USER_AGENT,
				Accept: acceptHeader(format),
				"Accept-Language": "en-US,en;q=0.9",
			};

			let response = await fetch(url, { headers, signal: withTimeout(signal, timeoutSeconds * 1000) });
			if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
				response = await fetch(url, {
					headers: { ...headers, "User-Agent": "pi-coding-agent" },
					signal: withTimeout(signal, timeoutSeconds * 1000),
				});
			}
			if (!response.ok) throw new Error(`webfetch request failed: ${response.status} ${response.statusText}`);

			const contentType = response.headers.get("content-type") ?? "";
			const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
			const buffer = await readResponseLimited(response);

			if (mime.startsWith("image/")) {
				return {
					content: [{ type: "text", text: `Image fetched successfully from ${url} (${contentType || mime})` }],
					details: { url, contentType, bytes: buffer.byteLength, image: true },
				};
			}

			const raw = new TextDecoder().decode(buffer);
			const output = contentForFormat(raw, contentType, format);
			const formatted = await formatToolOutput("webfetch", output);
			return {
				content: [{ type: "text", text: formatted.text }],
				details: { ...formatted.details, url, format, contentType, bytes: buffer.byteLength },
			};
		},
	});

	pi.registerTool({
		name: "websearch",
		label: "Web Search",
		description: WEBSEARCH_DESCRIPTION,
		promptSnippet: "Search the web for current or external information via Exa or Parallel MCP search.",
		promptGuidelines: [
			"Use websearch when the user asks for current, recent, or external web information beyond the model knowledge cutoff.",
			`When using websearch for recent information, include the current year (${new Date().getFullYear()}) in the query.`,
		],
		parameters: Type.Object({
			query: Type.String({ description: "Web search query" }),
			numResults: Type.Optional(Type.Number({ description: "Number of search results to return (default: 8)" })),
			livecrawl: Type.Optional(StrEnum(["fallback", "preferred"] as const, { description: "Live crawl mode" })),
			type: Type.Optional(StrEnum(["auto", "fast", "deep"] as const, { description: "Search type" })),
			contextMaxCharacters: Type.Optional(Type.Number({ description: "Maximum characters for LLM-optimized context" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const provider = selectWebSearchProvider(ctx);
			const output = await callWebSearchProvider(provider, params, ctx, signal);
			const formatted = await formatToolOutput("websearch", output);
			return {
				content: [{ type: "text", text: formatted.text }],
				details: { ...formatted.details, provider, query: params.query },
			};
		},
	});
}
