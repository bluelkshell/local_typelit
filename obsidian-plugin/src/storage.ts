// What the plugin keeps in its data.json: settings, saved progress and run history.
// Pure functions so the (untrusted) file contents can be validated and tested.

export interface Settings {
    textSize: number; // px
    idleSeconds: number;
    normalizePunctuation: boolean;
    stripMarkdown: boolean;
    skipCode: boolean;
    showLiveStats: boolean;
    maxChars: number;
}

export const DEFAULT_SETTINGS: Settings = {
    textSize: 22,
    idleSeconds: 5,
    normalizePunctuation: true,
    stripMarkdown: true,
    skipCode: true,
    showLiveStats: true,
    maxChars: 20000,
};

export interface SavedProgress {
    typed: string;
    bankedMs: number;
    keystrokes: number;
    errors: number;
    textHash: string;
    updatedAt: number;
}

export interface RunResult {
    key: string;
    title: string;
    wpm: number;
    accuracy: number;
    seconds: number;
    at: number;
}

export interface PluginData {
    settings: Settings;
    progress: Record<string, SavedProgress>;
    results: RunResult[];
}

export const MAX_RESULTS = 500;
// data.json is rewritten on every autosave, so keep the number of saved places modest.
export const MAX_PROGRESS = 100;

function num(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
): number {
    const n =
        typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
}

function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSettings(raw: unknown): Settings {
    const r = isRecord(raw) ? raw : {};
    const d = DEFAULT_SETTINGS;
    return {
        textSize: Math.round(num(r.textSize, d.textSize, 12, 48)),
        idleSeconds: Math.round(num(r.idleSeconds, d.idleSeconds, 2, 30)),
        normalizePunctuation: bool(
            r.normalizePunctuation,
            d.normalizePunctuation,
        ),
        stripMarkdown: bool(r.stripMarkdown, d.stripMarkdown),
        skipCode: bool(r.skipCode, d.skipCode),
        showLiveStats: bool(r.showLiveStats, d.showLiveStats),
        maxChars: Math.round(num(r.maxChars, d.maxChars, 1000, 200000)),
    };
}

/** Accept whatever is in data.json (missing, old or damaged) and return clean data. */
export function normalizeData(raw: unknown): PluginData {
    const r = isRecord(raw) ? raw : {};
    const progress: Record<string, SavedProgress> = {};
    if (isRecord(r.progress)) {
        for (const [key, value] of Object.entries(r.progress)) {
            if (
                !isRecord(value) ||
                typeof value.typed !== "string" ||
                typeof value.textHash !== "string"
            ) {
                continue;
            }
            progress[key] = {
                typed: value.typed,
                textHash: value.textHash,
                bankedMs: num(value.bankedMs, 0, 0, 1e10),
                keystrokes: num(value.keystrokes, 0, 0, 1e9),
                errors: num(value.errors, 0, 0, 1e9),
                updatedAt: num(value.updatedAt, 0, 0, 1e15),
            };
        }
    }
    const results: RunResult[] = [];
    if (Array.isArray(r.results)) {
        for (const value of r.results) {
            if (
                !isRecord(value) ||
                typeof value.key !== "string" ||
                typeof value.title !== "string"
            )
                continue;
            results.push({
                key: value.key,
                title: value.title,
                wpm: num(value.wpm, 0, 0, 1000),
                accuracy: num(value.accuracy, 0, 0, 100),
                seconds: num(value.seconds, 0, 0, 1e7),
                at: num(value.at, 0, 0, 1e15),
            });
        }
    }
    return {
        settings: normalizeSettings(r.settings),
        progress: pruneProgress(progress),
        results: results.slice(-MAX_RESULTS),
    };
}

/** Keep only the most recently updated saved places. */
export function pruneProgress(
    progress: Record<string, SavedProgress>,
    max = MAX_PROGRESS,
): Record<string, SavedProgress> {
    const entries = Object.entries(progress);
    if (entries.length <= max) return progress;
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    return Object.fromEntries(entries.slice(0, max));
}

export function addResult(
    results: RunResult[],
    result: RunResult,
    max = MAX_RESULTS,
): RunResult[] {
    const next = [...results, result];
    return next.length > max ? next.slice(next.length - max) : next;
}

export function bestWpm(results: RunResult[], key: string): number | null {
    let best: number | null = null;
    for (const r of results) {
        if (r.key === key && (best === null || r.wpm > best)) best = r.wpm;
    }
    return best;
}

export interface Summary {
    runs: number;
    avgWpm: number;
    bestWpm: number;
    avgAccuracy: number;
}

export function summarize(results: RunResult[]): Summary {
    if (results.length === 0)
        return { runs: 0, avgWpm: 0, bestWpm: 0, avgAccuracy: 0 };
    const sum = (f: (r: RunResult) => number) =>
        results.reduce((total, r) => total + f(r), 0);
    return {
        runs: results.length,
        avgWpm: sum((r) => r.wpm) / results.length,
        bestWpm: Math.max(...results.map((r) => r.wpm)),
        avgAccuracy: sum((r) => r.accuracy) / results.length,
    };
}
