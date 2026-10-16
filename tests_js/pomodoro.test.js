// Run with: node --test tests_js/
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../library/static/library/pomodoro.js");

const settings = core.sanitizeSettings({});
const MIN = 60000;

test("defaults and sanitising", () => {
  assert.deepEqual(
    { f: settings.focus, s: settings.short, l: settings.long, n: settings.longEvery },
    { f: 25, s: 5, l: 15, n: 4 }
  );
  const s = core.sanitizeSettings({ focus: "abc", short: 999, long: -3, longEvery: 1, sound: false });
  assert.equal(s.focus, 25); // not a number -> default
  assert.equal(s.short, 60); // clamped
  assert.equal(s.long, 1);
  assert.equal(s.longEvery, 2);
  assert.equal(s.sound, false);
  assert.equal(s.notify, false);
});

test("start, pause and resume keep the remaining time", () => {
  let st = core.initialState(settings, "focus", 0);
  assert.equal(core.remaining(st, 1000), 25 * MIN);

  st = core.start(st, 1000);
  assert.equal(st.running, true);
  assert.equal(core.remaining(st, 1000 + 10 * MIN), 15 * MIN);

  st = core.pause(st, 1000 + 10 * MIN);
  assert.equal(st.running, false);
  assert.equal(st.remaining, 15 * MIN);
  // time passing while paused changes nothing
  assert.equal(core.remaining(st, 1000 + 99 * MIN), 15 * MIN);

  st = core.start(st, 5000000);
  assert.equal(st.endsAt, 5000000 + 15 * MIN);
});

test("expiry", () => {
  let st = core.start(core.initialState(settings, "focus", 0), 0);
  assert.equal(core.isExpired(st, 25 * MIN - 1), false);
  assert.equal(core.isExpired(st, 25 * MIN), true);
  assert.equal(core.remaining(st, 30 * MIN), 0);
  assert.equal(core.isExpired(core.pause(st, 10), 99 * MIN), false);
});

test("four focus sessions lead to a long break", () => {
  let st = core.initialState(settings, "focus", 0);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    st = core.advance(st, settings, true);
    seen.push(st.phase);
  }
  assert.deepEqual(seen, ["short", "focus", "short", "focus", "short", "focus", "long", "focus"]);
  assert.equal(st.cycle, 0);
  assert.equal(st.running, false);
});

test("skipping a focus session doesn't count towards the long break", () => {
  let st = core.initialState(settings, "focus", 3);
  st = core.advance(st, settings, false);
  assert.equal(st.phase, "short");
  assert.equal(st.cycle, 3);
  st = core.advance(st, settings, false);
  assert.equal(st.phase, "focus");
  // the next completed session is the 4th -> long break
  st = core.advance(st, settings, true);
  assert.equal(st.phase, "long");
  assert.equal(st.cycle, 0);
  assert.equal(st.remaining, 15 * MIN);
});

test("changing settings only affects phases that haven't been started", () => {
  const custom = core.sanitizeSettings({ focus: 50 });
  let fresh = core.initialState(settings, "focus", 0);
  assert.equal(core.applySettings(fresh, custom).remaining, 50 * MIN);

  let used = core.pause(core.start(fresh, 0), 5 * MIN);
  assert.equal(core.applySettings(used, custom).remaining, 20 * MIN);

  let running = core.start(fresh, 0);
  assert.equal(core.applySettings(running, custom), running);
});

test("formatTime", () => {
  assert.equal(core.formatTime(25 * MIN), "25:00");
  assert.equal(core.formatTime(61 * 1000), "01:01");
  assert.equal(core.formatTime(59001), "01:00"); // rounds up so it never shows 00:00 early
  assert.equal(core.formatTime(0), "00:00");
});
