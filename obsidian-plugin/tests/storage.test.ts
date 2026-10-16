import test from "node:test";
import assert from "node:assert/strict";
import {
    addResult,
    bestWpm,
    DEFAULT_SETTINGS,
    MAX_PROGRESS,
    MAX_RESULTS,
    normalizeData,
    normalizeSettings,
    pruneProgress,
    summarize,
    type RunResult,
    type SavedProgress,
} from "../src/storage.ts";

const run = (key: string, wpm: number, accuracy = 95): RunResult => ({
    key,
    title: key,
    wpm,
    accuracy,
    seconds: 30,
    at: 1,
});

test("missing or garbage data gives defaults", () => {
    for (const raw of [undefined, null, 5, "x", [], {}]) {
        const data = normalizeData(raw);
        assert.deepEqual(data.settings, DEFAULT_SETTINGS);
        assert.deepEqual(data.progress, {});
        assert.deepEqual(data.results, []);
    }
});

test("settings are clamped and typed", () => {
    const s = normalizeSettings({
        textSize: 500,
        idleSeconds: 0,
        normalizePunctuation: "yes",
        stripMarkdown: false,
        maxChars: -1,
        unknown: 1,
    });
    assert.equal(s.textSize, 48);
    assert.equal(s.idleSeconds, 2);
    assert.equal(s.normalizePunctuation, true); // not a boolean -> default
    assert.equal(s.stripMarkdown, false);
    assert.equal(s.maxChars, 1000);
    assert.equal("unknown" in s, false);
    assert.equal(
        normalizeSettings({ textSize: NaN }).textSize,
        DEFAULT_SETTINGS.textSize,
    );
});

test("damaged progress and result entries are dropped, good ones kept", () => {
    const data = normalizeData({
        progress: {
            good: {
                typed: "abc",
                textHash: "h",
                bankedMs: 100,
                keystrokes: 3,
                errors: 0,
                updatedAt: 5,
            },
            noHash: { typed: "abc" },
            notObject: 7,
            weird: {
                typed: "x",
                textHash: "h",
                bankedMs: "lots",
                keystrokes: -4,
                errors: Infinity,
            },
        },
        results: [
            run("a", 40),
            { key: "b" },
            "nope",
            { ...run("c", 50), wpm: 99999, accuracy: -5 },
        ],
    });
    assert.deepEqual(Object.keys(data.progress).sort(), ["good", "weird"]);
    assert.equal(data.progress.weird.bankedMs, 0);
    assert.equal(data.progress.weird.keystrokes, 0);
    assert.deepEqual(
        data.results.map((r) => r.key),
        ["a", "c"],
    );
    assert.equal(data.results[1].wpm, 1000);
    assert.equal(data.results[1].accuracy, 0);
});

test("old progress is pruned, newest kept", () => {
    const progress: Record<string, SavedProgress> = {};
    for (let i = 0; i < MAX_PROGRESS + 25; i++) {
        progress[`k${i}`] = {
            typed: "a",
            textHash: "h",
            bankedMs: 0,
            keystrokes: 1,
            errors: 0,
            updatedAt: i,
        };
    }
    const pruned = pruneProgress(progress);
    assert.equal(Object.keys(pruned).length, MAX_PROGRESS);
    assert.ok("k" + (MAX_PROGRESS + 24) in pruned);
    assert.equal("k0" in pruned, false);
    // under the limit it is returned untouched
    const small = { a: progress.k0 };
    assert.equal(pruneProgress(small), small);
});

test("results are capped, oldest dropped", () => {
    let results: RunResult[] = [];
    for (let i = 0; i < MAX_RESULTS + 10; i++)
        results = addResult(results, run("a", i));
    assert.equal(results.length, MAX_RESULTS);
    assert.equal(results[0].wpm, 10);
    assert.equal(results[results.length - 1].wpm, MAX_RESULTS + 9);
});

test("best wpm per source", () => {
    const results = [run("a", 40), run("b", 90), run("a", 55), run("a", 30)];
    assert.equal(bestWpm(results, "a"), 55);
    assert.equal(bestWpm(results, "b"), 90);
    assert.equal(bestWpm(results, "none"), null);
});

test("summary", () => {
    assert.deepEqual(summarize([]), {
        runs: 0,
        avgWpm: 0,
        bestWpm: 0,
        avgAccuracy: 0,
    });
    const s = summarize([run("a", 40, 90), run("b", 60, 100)]);
    assert.equal(s.runs, 2);
    assert.equal(s.avgWpm, 50);
    assert.equal(s.bestWpm, 60);
    assert.equal(s.avgAccuracy, 95);
});
