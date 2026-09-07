/**
 * Subscription usage in the footer. The state folds in whatever shape of
 * rate_limit_event Claude Code streams, unifiedWindows (2.1.263+) or the older
 * single-window frame, and the footer line names only the windows it has seen.
 * `utilization` is a fraction (0.97 = 97%), the bug PR #37 upstream and the
 * pre-fix warning both fell into.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createUsageState, recordRateLimitEvent, formatUsageStatus, formatResetTime } from "../src/usage.js";
import { QueryContext } from "../src/query-state.js";

const { __test } = await import("../src/index.js");

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0); // 2026-09-06T12:00Z
const IN_2H = Math.floor(NOW / 1000) + 2 * 3600;
const IN_3D = Math.floor(NOW / 1000) + 3 * 86400;

describe("recordRateLimitEvent", () => {
	it("takes both windows from unifiedWindows", () => {
		const s = createUsageState();
		const changed = recordRateLimitEvent(s, {
			status: "rejected",
			rateLimitType: "seven_day_overage_included",
			unifiedWindows: {
				five_hour: { utilization: 0.02, resetsAt: IN_2H },
				seven_day: { utilization: 0.97, resetsAt: IN_3D },
			},
		}, NOW);
		assert.equal(changed, true);
		assert.equal(s.windows.get("five_hour").utilization, 0.02);
		assert.equal(s.windows.get("seven_day").utilization, 0.97);
		assert.equal(s.windows.get("seven_day").resetsAt, IN_3D);
	});

	it("takes the single window of an older frame", () => {
		const s = createUsageState();
		recordRateLimitEvent(s, { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.91, resetsAt: IN_2H, surpassedThreshold: 0.9 }, NOW);
		assert.equal(s.windows.get("five_hour").utilization, 0.91);
		assert.equal(s.windows.has("seven_day"), false);
	});

	it("records nothing from an allowed frame with no utilization", () => {
		const s = createUsageState();
		const changed = recordRateLimitEvent(s, { status: "allowed", rateLimitType: "five_hour", resetsAt: IN_2H, isUsingOverage: false }, NOW);
		assert.equal(changed, false);
		assert.equal(s.windows.size, 0);
	});

	it("reports no change when the sample repeats", () => {
		const s = createUsageState();
		const frame = { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: IN_2H } } };
		assert.equal(recordRateLimitEvent(s, frame, NOW), true);
		assert.equal(recordRateLimitEvent(s, frame, NOW + 1000), false);
	});

	it("reads a value above 1 as a percentage", () => {
		const s = createUsageState();
		recordRateLimitEvent(s, { status: "allowed", unifiedWindows: { five_hour: { utilization: 34, resetsAt: IN_2H } } }, NOW);
		assert.equal(s.windows.get("five_hour").utilization, 0.34);
	});

	it("tracks the overage flag", () => {
		const s = createUsageState();
		assert.equal(recordRateLimitEvent(s, { status: "allowed", isUsingOverage: true }, NOW), true);
		assert.equal(s.isUsingOverage, true);
	});
});

describe("formatResetTime", () => {
	it("is a clock time inside 24 hours and carries the weekday beyond", () => {
		assert.match(formatResetTime(IN_2H, NOW), /^\d{1,2}:\d{2}(am|pm)?$/);
		assert.match(formatResetTime(IN_3D, NOW), /^[A-Za-z]{3} \d{1,2}:\d{2}(am|pm)?$/);
		assert.equal(formatResetTime(undefined, NOW), undefined);
	});
});

describe("formatUsageStatus", () => {
	it("is undefined before any window has been seen", () => {
		assert.equal(formatUsageStatus(createUsageState(), NOW), undefined);
	});

	it("names the windows it has, five-hour first, as percentages", () => {
		const s = createUsageState();
		recordRateLimitEvent(s, {
			status: "allowed",
			unifiedWindows: { seven_day: { utilization: 0.97, resetsAt: IN_3D }, five_hour: { utilization: 0.02, resetsAt: IN_2H } },
		}, NOW);
		const line = formatUsageStatus(s, NOW);
		assert.match(line, /^Claude 5h 2% \(resets [^)]+\) · week 97% \(resets [A-Za-z]{3} [^)]+\)$/);
	});

	it("shows one window alone and never a phantom one", () => {
		const s = createUsageState();
		recordRateLimitEvent(s, { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.91 }, NOW);
		assert.equal(formatUsageStatus(s, NOW), "Claude 5h 91%");
	});

	it("flags extra usage", () => {
		const s = createUsageState();
		recordRateLimitEvent(s, { status: "allowed", isUsingOverage: true, unifiedWindows: { five_hour: { utilization: 1 } } }, NOW);
		assert.equal(formatUsageStatus(s, NOW), "Claude 5h 100% · extra usage in use");
	});
});

describe("footer wiring through consumeQuery", () => {
	it("records the windows and asks the footer to redraw when a rate_limit_event streams in", async () => {
		let redraws = 0;
		__test.setFooterTui({ requestRender: () => { redraws += 1; } });
		const c = new QueryContext();
		c.currentPiStream = { push() {}, end() {} };
		c.resetTurnState({ api: "anthropic-messages", provider: "anthropic", id: "test-model" });
		async function* gen() {
			yield {
				type: "rate_limit_event",
				rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: IN_2H } } },
			};
		}
		await __test.consumeQuery(gen(), new Map(), { api: "anthropic-messages", provider: "anthropic", id: "test-model" }, () => false, c);
		assert.equal(redraws, 1);
		assert.equal(__test.getUsageState().windows.get("five_hour").utilization, 0.4);
		__test.setFooterTui(null);
	});
});
