// pi's footer with the subscription usage on its stats line.
//
// pi's built-in footer draws two lines, the path and the stats, and puts an
// extension's setStatus() text on a third. The usage belongs beside the token
// counts, in the same dim ink and the same terse form pi uses (R22k, CH98.7%,
// 2.2%/1.0M), so this replaces the footer with a copy of pi's that carries one
// more segment, `5h61% 7d9%`, coloured like the context percentage: dim, then
// warning past 70%, then error past 90%. Everything else is pi's algorithm as
// of 0.85.1 (modes/interactive/components/footer.ts): the same parts in the
// same order, the model right-aligned with the provider in front of it when
// more than one provider is available and the line has room, the model
// truncated before the stats are, and other extensions' statuses on the third
// line as before. Two of pi's parts are not reachable from an extension and
// are left out: the "(sub)" cost suffix for a subscription provider, which
// never applies to the bridge's zero-cost models, and the experimental "xp"
// marker.
//
// The right side is cut down to the same register as the left. pi writes
// `(claude-bridge) claude-fable-5-1 • high`; here it is `fable-5-1 high`: the
// `claude-` every bridge model carries says nothing, the bullet is a space,
// and the thinking level is a short word. The provider appears only when the
// active model is not the bridge's, which is the one case it carries news.
//
// The layout degrades with width in steps rather than clipping: the provider
// prefix goes first, then the reset times are never shown here at all (they
// stay in the rate-limit notices), then the model name is cut from the right,
// and only when the stats alone overflow are they truncated with an ellipsis,
// which is pi's own last resort.

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, relative, resolve, sep } from "path";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { footerUsageParts, type UsageState } from "./usage.js";

type FooterFactory = Parameters<ExtensionUIContext["setFooter"]>[0] & Function;
type Theme = Parameters<FooterFactory>[1];
type FooterData = Parameters<FooterFactory>[2];
type TUI = Parameters<FooterFactory>[0];

/** pi's own token formatter, copied so the numbers read the same. */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const rel = relative(resolve(home), resolve(cwd));
	const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

// pi keeps the auto-compaction flag on the session, out of an extension's
// reach; the setting it starts from is readable, and Daniel's is off.
function autoCompactEnabled(cwd: string): boolean {
	for (const file of [join(homedir(), ".pi", "agent", "settings.json"), join(cwd, ".pi", "settings.json")]) {
		try {
			if (!existsSync(file)) continue;
			const enabled = JSON.parse(readFileSync(file, "utf-8"))?.compaction?.enabled;
			if (typeof enabled === "boolean") return enabled;
		} catch {
			// unreadable settings: pi's default applies
		}
	}
	return true;
}

export type FooterSources = {
	/** The latest extension context, refreshed on every event the bridge sees. */
	ctx: () => ExtensionContext | null;
	usage: () => UsageState;
};

const THINKING_SHORT: Record<string, string> = {
	off: "off",
	minimal: "min",
	low: "low",
	medium: "med",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

/** `claude-fable-5-1` reads `fable-5-1`; any other id is left as it is. */
export function shortModelId(id: string): string {
	return id.startsWith("claude-") ? id.slice("claude-".length) : id;
}

export function shortThinkingLevel(level: string | undefined): string {
	const l = level || "off";
	return THINKING_SHORT[l] ?? l;
}

/** Colour a percentage the way pi colours the context percentage. */
function colourPercent(theme: Theme, pct: number, text: string): string {
	if (pct > 90) return theme.fg("error", text);
	if (pct > 70) return theme.fg("warning", text);
	return theme.fg("dim", text);
}

export function renderFooter(width: number, theme: Theme, footerData: FooterData, sources: FooterSources): string[] {
	const ctx = sources.ctx();
	if (!ctx) return [];
	const sm = ctx.sessionManager;

	// Cumulative usage over the whole session, as pi counts it.
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let latestCacheHitRate: number | undefined;
	const add = (u: any) => {
		if (!u) return;
		totals.input += u.input ?? 0;
		totals.output += u.output ?? 0;
		totals.cacheRead += u.cacheRead ?? 0;
		totals.cacheWrite += u.cacheWrite ?? 0;
		totals.cost += u.cost?.total ?? 0;
	};
	for (const entry of sm.getEntries() as any[]) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			add(entry.message.usage);
			const u = entry.message.usage;
			const prompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
			latestCacheHitRate = prompt > 0 ? ((u.cacheRead ?? 0) / prompt) * 100 : undefined;
		} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
			add(entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			add(entry.usage);
		}
	}

	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercentValue = contextUsage?.percent ?? 0;
	const contextPercent = contextUsage?.percent !== null && contextUsage?.percent !== undefined ? contextPercentValue.toFixed(1) : "?";

	let pwd = formatCwdForFooter(sm.getCwd(), process.env.HOME || process.env.USERPROFILE);
	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;
	const sessionName = sm.getSessionName();
	if (sessionName) pwd = `${pwd} • ${sessionName}`;

	// Each part carries its own colour, so a coloured part never bleeds into
	// the next and never loses the dim of the one after it.
	const dim = (s: string) => theme.fg("dim", s);
	const parts: string[] = [];
	if (totals.input) parts.push(dim(`↑${formatTokens(totals.input)}`));
	if (totals.output) parts.push(dim(`↓${formatTokens(totals.output)}`));
	if (totals.cacheRead) parts.push(dim(`R${formatTokens(totals.cacheRead)}`));
	if (totals.cacheWrite) parts.push(dim(`W${formatTokens(totals.cacheWrite)}`));
	if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
		parts.push(dim(`CH${latestCacheHitRate.toFixed(1)}%`));
	}
	if (totals.cost) parts.push(dim(`$${totals.cost.toFixed(3)}`));
	const autoIndicator = autoCompactEnabled(sm.getCwd()) ? " (auto)" : "";
	const contextDisplay = contextPercent === "?"
		? `?/${formatTokens(contextWindow)}${autoIndicator}`
		: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
	parts.push(colourPercent(theme, contextPercentValue, contextDisplay));
	for (const { label, percent } of footerUsageParts(sources.usage())) {
		parts.push(colourPercent(theme, percent, `${label}${percent}%`));
	}

	let statsLeft = parts.join(dim(" "));
	let statsLeftWidth = visibleWidth(statsLeft);
	if (statsLeftWidth > width) {
		statsLeft = truncateToWidth(statsLeft, width, dim("..."));
		statsLeftWidth = visibleWidth(statsLeft);
	}

	const minPadding = 2;
	const modelName = ctx.model ? shortModelId(ctx.model.id) : "no-model";
	const rightBare = ctx.model?.reasoning ? `${modelName} ${shortThinkingLevel(ctx.thinkingLevel)}` : modelName;
	let rightSide = rightBare;
	if (ctx.model && ctx.model.provider !== "claude-bridge" && footerData.getAvailableProviderCount() > 1) {
		rightSide = `(${ctx.model.provider}) ${rightBare}`;
		if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) rightSide = rightBare;
	}
	const rightWidth = visibleWidth(rightSide);
	let statsLine: string;
	if (statsLeftWidth + minPadding + rightWidth <= width) {
		statsLine = statsLeft + dim(" ".repeat(width - statsLeftWidth - rightWidth) + rightSide);
	} else {
		const room = width - statsLeftWidth - minPadding;
		if (room > 0) {
			const cut = truncateToWidth(rightSide, room, "");
			statsLine = statsLeft + dim(" ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(cut))) + cut);
		} else {
			statsLine = statsLeft;
		}
	}

	const lines = [truncateToWidth(dim(pwd), width, dim("...")), statsLine];
	const statuses = footerData.getExtensionStatuses();
	if (statuses.size > 0) {
		const line = Array.from(statuses.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitizeStatusText(text))
			.join(" ");
		lines.push(truncateToWidth(line, width, dim("...")));
	}
	return lines;
}

/** The factory handed to ctx.ui.setFooter(); returns the tui so the bridge can ask for a redraw. */
export function createFooterFactory(sources: FooterSources, onTui: (tui: TUI) => void): FooterFactory {
	return (tui, theme, footerData) => {
		onTui(tui);
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number) {
				return renderFooter(width, theme, footerData, sources);
			},
		};
	};
}
