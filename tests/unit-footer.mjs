/**
 * The footer is pi's own with the usage on the stats line. These render it
 * against a fake context, theme and footer data and check the parts, their
 * order, the colours, the right-aligned model and how the line gives way as
 * the width shrinks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderFooter, formatTokens, shortModelId, shortThinkingLevel } from "../src/footer.js";
import { createUsageState, recordRateLimitEvent } from "../src/usage.js";

// A theme whose colours are readable tags rather than escape codes.
const theme = {
	fg: (color, text) => (color === "dim" ? text : `<${color}>${text}</${color}>`),
	bold: (t) => t,
};

function fakeCtx({ entries = [], model, thinkingLevel, context } = {}) {
	return {
		sessionManager: { getEntries: () => entries, getCwd: () => "/tmp/x", getSessionName: () => undefined },
		getContextUsage: () => context,
		model,
		thinkingLevel,
	};
}
const footerData = (over = {}) => ({
	getGitBranch: () => "main",
	getExtensionStatuses: () => new Map(),
	getAvailableProviderCount: () => 1,
	onBranchChange: () => () => {},
	...over,
});
const assistant = (usage) => ({ type: "message", message: { role: "assistant", usage } });
const model = { id: "claude-fable-5-1", provider: "claude-bridge", contextWindow: 1000000, reasoning: true };

function usageWith(five, seven) {
	const s = createUsageState();
	recordRateLimitEvent(s, { status: "allowed", unifiedWindows: { five_hour: { utilization: five }, seven_day: { utilization: seven } } });
	return s;
}

describe("formatTokens", () => {
	it("reads as pi's", () => {
		assert.equal(formatTokens(292), "292");
		assert.equal(formatTokens(2200), "2.2k");
		assert.equal(formatTokens(22000), "22k");
		assert.equal(formatTokens(1000000), "1.0M");
	});
});

describe("the right side", () => {
	it("drops the claude- prefix and shortens the thinking level", () => {
		assert.equal(shortModelId("claude-fable-5-1"), "fable-5-1");
		assert.equal(shortModelId("gpt-5"), "gpt-5");
		assert.equal(shortThinkingLevel("medium"), "med");
		assert.equal(shortThinkingLevel("minimal"), "min");
		assert.equal(shortThinkingLevel(undefined), "off");
		assert.equal(shortThinkingLevel("xhigh"), "xhigh");
	});
});

describe("renderFooter", () => {
	const entries = [assistant({ input: 2, output: 33, cacheRead: 22000, cacheWrite: 292, cost: { total: 0 } })];
	const ctx = fakeCtx({ entries, model, thinkingLevel: "high", context: { tokens: 22000, contextWindow: 1000000, percent: 2.2 } });

	it("puts the usage on the stats line after the context, terse, five-hour first", () => {
		const lines = renderFooter(120, theme, footerData(), { ctx: () => ctx, usage: () => usageWith(0.61, 0.09) });
		assert.equal(lines.length, 2);
		assert.equal(lines[0], "/tmp/x (main)");
		assert.match(lines[1], /^↑2 ↓33 R22k W292 CH98\.7% 2\.2%\/1\.0M 5h61% 7d9% +fable-5-1 high$/);
	});

	it("colours a window like pi colours the context percentage", () => {
		const lines = renderFooter(120, theme, footerData(), { ctx: () => ctx, usage: () => usageWith(0.75, 0.97) });
		assert.match(lines[1], /<warning>5h75%<\/warning> <error>7d97%<\/error>/);
		const calm = renderFooter(120, theme, footerData(), { ctx: () => ctx, usage: () => usageWith(0.1, 0.2) });
		assert.doesNotMatch(calm[1], /<warning>|<error>/);
	});

	it("shows no usage segment before a sample has arrived", () => {
		const lines = renderFooter(120, theme, footerData(), { ctx: () => ctx, usage: () => createUsageState() });
		assert.match(lines[1], /2\.2%\/1\.0M +fable-5-1 high$/);
	});

	it("names the provider only when the model is not the bridge's, when there is room, and drops it first", () => {
		const two = footerData({ getAvailableProviderCount: () => 2 });
		const onBridge = renderFooter(120, theme, two, { ctx: () => ctx, usage: () => usageWith(0.61, 0.09) });
		assert.match(onBridge[1], / {2,}fable-5-1 high$/);
		assert.doesNotMatch(onBridge[1], /\(claude-bridge\)/);
		const other = fakeCtx({ entries, model: { ...model, provider: "anthropic" }, thinkingLevel: "high", context: { tokens: 22000, contextWindow: 1000000, percent: 2.2 } });
		const wide = renderFooter(120, theme, two, { ctx: () => other, usage: () => usageWith(0.61, 0.09) });
		assert.match(wide[1], /\(anthropic\) fable-5-1 high$/);
		const narrow = renderFooter(66, theme, two, { ctx: () => other, usage: () => usageWith(0.61, 0.09) });
		assert.doesNotMatch(narrow[1], /\(anthropic\)/);
		assert.match(narrow[1], /5h61% 7d9% +fable-5-1 high$/);
	});

	it("cuts the model from the right before touching the stats, then the stats last", () => {
		// pi's truncation appends a reset code; compare what is visible.
		const at = (w) => renderFooter(w, theme, footerData(), { ctx: () => ctx, usage: () => usageWith(0.61, 0.09) })[1].replace(/\x1b\[0m/g, "");
		// The stats are 45 columns; at 55 the model has 8 left and is cut to fit.
		assert.equal(at(55), "↑2 ↓33 R22k W292 CH98.7% 2.2%/1.0M 5h61% 7d9%  fable-5-");
		assert.equal(at(45), "↑2 ↓33 R22k W292 CH98.7% 2.2%/1.0M 5h61% 7d9%");
		assert.match(at(30), /\.\.\.$/);
		assert.ok(at(30).length <= 30);
	});

	it("keeps other extensions' statuses on the third line", () => {
		const fd = footerData({ getExtensionStatuses: () => new Map([["b", "second"], ["a", "first\nline"]]) });
		const lines = renderFooter(120, theme, fd, { ctx: () => ctx, usage: () => usageWith(0.61, 0.09) });
		assert.equal(lines[2], "first line second");
	});
});
