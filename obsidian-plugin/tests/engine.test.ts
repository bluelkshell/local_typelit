import test from "node:test";
import assert from "node:assert/strict";
import { TypingEngine } from "../src/engine.ts";

const IDLE = 5000;

function typeAll(engine: TypingEngine, text: string, start = 1000, gap = 100): number {
  let t = start;
  for (const ch of text) {
    engine.type(ch, t);
    t += gap;
  }
  return t;
}

test("typing the whole text completes the run", () => {
  const e = new TypingEngine("hello world", IDLE);
  assert.equal(e.complete, false);
  typeAll(e, "hello world");
  assert.equal(e.complete, true);
  assert.equal(e.accuracy(), 100);
  assert.equal(e.percent, 100);
});

test("a wrong key advances, counts as an error and blocks completion", () => {
  const e = new TypingEngine("abc", IDLE);
  assert.equal(e.type("a", 0), "correct");
  assert.equal(e.type("x", 100), "wrong");
  assert.equal(e.type("c", 200), "correct");
  assert.equal(e.index, 3);
  assert.equal(e.mistakes, 1);
  assert.equal(e.complete, false); // at the end, but with a mistake left
  assert.equal(e.type("d", 300), "ignored"); // nothing beyond the end
  assert.ok(Math.abs(e.accuracy() - (2 / 3) * 100) < 1e-9);

  e.backspace(400);
  e.backspace(500);
  assert.equal(e.mistakes, 0);
  e.type("b", 600);
  e.type("c", 700);
  assert.equal(e.complete, true);
  // the early mistake still counts against accuracy
  assert.ok(e.accuracy() < 100);
});

test("backspace at the start does nothing", () => {
  const e = new TypingEngine("abc", IDLE);
  assert.equal(e.backspace(0), false);
  assert.equal(e.running, false);
});

test("keystrokes after completion are ignored", () => {
  const e = new TypingEngine("ab", IDLE);
  typeAll(e, "ab");
  assert.equal(e.type("c", 5000), "ignored");
  assert.equal(e.keystrokes, 2);
});

test("empty text is never complete", () => {
  const e = new TypingEngine("", IDLE);
  assert.equal(e.complete, false);
  assert.equal(e.percent, 0);
  assert.equal(e.type("a", 0), "ignored");
});

test("the clock starts at the first key", () => {
  const e = new TypingEngine("abcdef", IDLE);
  assert.equal(e.elapsedMs(10_000), 0);
  e.type("a", 10_000);
  assert.equal(e.elapsedMs(12_000), 2000);
});

test("the clock stops idleMs after the last keystroke and never goes backwards", () => {
  const e = new TypingEngine("abcdef", IDLE);
  e.type("a", 0);
  e.type("b", 1000);
  assert.equal(e.elapsedMs(3000), 3000); // still within the idle limit
  assert.equal(e.elapsedMs(6000), 6000); // exactly lastKey + idle
  assert.equal(e.elapsedMs(60_000), 6000); // frozen, no matter how long you wait

  assert.equal(e.tick(5000), false); // not idle yet
  assert.equal(e.tick(7000), true); // now it stops
  assert.equal(e.idle, true);
  assert.equal(e.running, false);
  assert.equal(e.elapsedMs(99_000), 6000);
  assert.equal(e.tick(99_000), false); // already stopped
});

test("typing again after idling restarts the clock without counting the gap", () => {
  const e = new TypingEngine("abcdef", IDLE);
  e.type("a", 0);
  e.type("b", 1000);
  e.tick(10_000);
  e.type("c", 50_000);
  assert.equal(e.idle, false);
  assert.equal(e.running, true);
  assert.equal(e.elapsedMs(52_000), 6000 + 2000);
});

test("backspace also resumes the clock", () => {
  const e = new TypingEngine("abcdef", IDLE);
  e.type("a", 0);
  e.tick(10_000);
  e.backspace(20_000);
  assert.equal(e.running, true);
});

test("wpm is net of mistakes and uses at least one second", () => {
  const e = new TypingEngine("a".repeat(100), IDLE);
  // 100 correct characters in 60 seconds = 20 wpm
  for (let i = 0; i < 100; i++) e.type("a", (i * 60_000) / 99 - 0);
  // type() only records the last key time; ask at the moment of the last key
  const now = e.lastKeyAt;
  assert.ok(Math.abs(e.wpm(now) - 20) < 0.5, String(e.wpm(now)));

  const f = new TypingEngine("abcde", IDLE);
  f.type("a", 0);
  f.type("x", 100); // wrong
  // 1 correct char (2 typed - 1 mistake), under a second elapsed -> measured over 1 s
  assert.ok(Math.abs(f.wpm(100) - (1 / 5) / (1 / 60)) < 1e-9);
  assert.equal(new TypingEngine("abc", IDLE).wpm(1000), 0);
});

test("accuracy with no keystrokes is 100", () => {
  assert.equal(new TypingEngine("abc", IDLE).accuracy(), 100);
});

test("astral characters count as one", () => {
  const e = new TypingEngine("a\u{1F600}b", IDLE);
  assert.equal(e.total, 3);
  e.type("a", 0);
  assert.equal(e.type("\u{1F600}", 100), "correct");
  e.type("b", 200);
  assert.equal(e.complete, true);
});

test("snapshot and restore round-trip", () => {
  const text = "hello world";
  const e = new TypingEngine(text, IDLE);
  e.type("h", 0);
  e.type("e", 100);
  e.type("x", 200); // mistake
  const snap = e.snapshot(300);
  assert.equal(snap.typed, "hex");
  assert.equal(snap.keystrokes, 3);
  assert.equal(snap.errors, 1);

  const r = TypingEngine.restore(text, snap, IDLE);
  assert.equal(r.index, 3);
  assert.equal(r.mistakes, 1);
  assert.deepEqual(r.state.slice(0, 4), [1, 1, 2, 0]);
  assert.equal(r.elapsedMs(99_999), snap.bankedMs); // not running until you type
  assert.equal(r.running, false);
  r.type("l", 1_000_000);
  assert.equal(r.running, true);
  assert.equal(r.elapsedMs(1_000_500), snap.bankedMs + 500);
});

test("restore ignores snapshots that don't fit the text", () => {
  const tooLong = TypingEngine.restore("abc", { typed: "abcdef", bankedMs: 5, keystrokes: 6, errors: 0 }, IDLE);
  assert.equal(tooLong.index, 0);
  const empty = TypingEngine.restore("abc", { typed: "", bankedMs: 5, keystrokes: 0, errors: 0 }, IDLE);
  assert.equal(empty.index, 0);
  const negative = TypingEngine.restore("abc", { typed: "a", bankedMs: -50, keystrokes: 0, errors: 0 }, IDLE);
  assert.equal(negative.bankedMs, 0);
  assert.equal(negative.keystrokes, 1); // at least what was typed
});
