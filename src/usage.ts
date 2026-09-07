// Subscription usage for the pi footer, built from the rate_limit_event frames
// Claude Code streams on every request. Pure state and formatting, split from
// index.ts so tests can import it without activating the extension.
//
// Two shapes arrive. Claude Code 2.1.263 attaches `unifiedWindows`, one entry
// per rolling window with its utilization and reset, to every event; older
// builds carry a single `rateLimitType` + `utilization` pair, and an "allowed"
// event with no utilization at all. Both are recorded; a window is shown only
// once a sample for it has arrived, so nothing is displayed as 0% for lack of
// data. `utilization` is a fraction (0.97 = 97%) in every observed frame.

import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

export type UsageWindow = {
	/** Fraction of the window used, 0..1. */
	utilization: number;
	/** Unix seconds at which the window resets, when the event carried it. */
	resetsAt?: number;
	/** Date.now() when this sample arrived. */
	capturedAt: number;
};

export type UsageWindows = Map<string, UsageWindow>;

export type UsageState = {
	windows: UsageWindows;
	isUsingOverage: boolean;
};

type UnifiedWindow = { utilization?: number; resetsAt?: number };
type RateLimitInfoWithWindows = SDKRateLimitInfo & {
	unifiedWindows?: Record<string, UnifiedWindow | undefined>;
};

const FOOTER_LABELS: Record<string, string> = {
	five_hour: "5h",
	seven_day: "week",
	seven_day_opus: "Opus week",
	seven_day_sonnet: "Sonnet week",
};
const FOOTER_ORDER = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];

export function createUsageState(): UsageState {
	return { windows: new Map(), isUsingOverage: false };
}

// Values above 1 cannot be fractions; treat them as percentages so a future
// change of unit degrades to a right number rather than 9700%.
function asFraction(value: number): number {
	const n = value > 1 ? value / 100 : value;
	return Math.max(0, Math.min(1, n));
}

/** Fold one rate_limit_event into the state. Returns true when anything changed. */
export function recordRateLimitEvent(state: UsageState, info: RateLimitInfoWithWindows | undefined, now = Date.now()): boolean {
	if (!info) return false;
	let changed = false;
	const put = (key: string, utilization: number | undefined, resetsAt: number | undefined) => {
		if (typeof utilization !== "number" || Number.isNaN(utilization)) return;
		const prev = state.windows.get(key);
		const next: UsageWindow = { utilization: asFraction(utilization), resetsAt: resetsAt ?? prev?.resetsAt, capturedAt: now };
		if (!prev || prev.utilization !== next.utilization || prev.resetsAt !== next.resetsAt) changed = true;
		state.windows.set(key, next);
	};
	if (info.unifiedWindows) {
		for (const [key, w] of Object.entries(info.unifiedWindows)) {
			if (w) put(key, w.utilization, w.resetsAt);
		}
	} else if (info.rateLimitType && info.rateLimitType !== "overage") {
		put(info.rateLimitType, info.utilization, info.resetsAt);
	}
	if (typeof info.isUsingOverage === "boolean" && info.isUsingOverage !== state.isUsingOverage) {
		state.isUsingOverage = info.isUsingOverage;
		changed = true;
	}
	return changed;
}

/** "7:00pm" inside the next 24 hours, "Sun 3:00am" beyond that. */
export function formatResetTime(resetsAt: number | undefined, now = Date.now()): string | undefined {
	if (!resetsAt) return undefined;
	const at = new Date(resetsAt * 1000);
	const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s/g, "");
	if (at.getTime() - now < 24 * 60 * 60 * 1000) return time;
	const day = at.toLocaleDateString([], { weekday: "short" });
	return `${day} ${time}`;
}

/**
 * One line for the footer, or undefined when no window has been seen yet:
 *   Claude 5h 2% (resets 7:00pm) · week 97% (resets Sun 3:00am)
 */
export function formatUsageStatus(state: UsageState, now = Date.now()): string | undefined {
	const keys = [...state.windows.keys()]
		.filter((k) => k in FOOTER_LABELS)
		.sort((a, b) => FOOTER_ORDER.indexOf(a) - FOOTER_ORDER.indexOf(b));
	if (keys.length === 0) return undefined;
	const parts = keys.map((key) => {
		const w = state.windows.get(key)!;
		const pct = Math.round(w.utilization * 100);
		const reset = formatResetTime(w.resetsAt, now);
		return `${FOOTER_LABELS[key]} ${pct}%${reset ? ` (resets ${reset})` : ""}`;
	});
	if (state.isUsingOverage) parts.push("extra usage in use");
	return `Claude ${parts.join(" · ")}`;
}
