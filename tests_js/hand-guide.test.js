// Run with: node --test tests_js/
const test = require("node:test");
const assert = require("node:assert/strict");
const guide = require("../library/static/library/hand-guide.js");

const fingers = (ch) => guide.lookup(ch).fingers;

test("home row fingering", () => {
    assert.deepEqual("asdf".split("").map((c) => fingers(c)[0]), ["lp", "lr", "lm", "li"]);
    assert.deepEqual("jkl;".split("").map((c) => fingers(c)[0]), ["ri", "rm", "rr", "rp"]);
    // the index fingers also cover g and h
    assert.equal(fingers("g")[0], "li");
    assert.equal(fingers("h")[0], "ri");
});

test("index fingers cover two columns", () => {
    for (const c of "rtfgvb45") assert.equal(fingers(c)[0], "li", c);
    for (const c of "yuhjnm67") assert.equal(fingers(c)[0], "ri", c);
});

test("number row and punctuation", () => {
    assert.equal(fingers("1")[0], "lp");
    assert.equal(fingers("0")[0], "rp");
    assert.equal(fingers(",")[0], "rm");
    assert.equal(fingers(".")[0], "rr");
    assert.equal(fingers("/")[0], "rp");
    assert.equal(fingers("'")[0], "rp");
});

test("every printable ASCII character has a fingering", () => {
    for (let code = 33; code < 127; code++) {
        const ch = String.fromCharCode(code);
        assert.notEqual(guide.lookup(ch), null, "no fingering for " + ch);
    }
});

test("capitals use the opposite pinky for shift", () => {
    // A is typed by the left pinky, so shift is held by the right pinky
    assert.deepEqual(guide.lookup("A"), {
        key: "a", fingers: ["lp", "rp"], shift: true, shiftKey: "shift-r",
    });
    // J is typed by the right index finger, so shift is held by the left pinky
    assert.deepEqual(guide.lookup("J"), {
        key: "j", fingers: ["ri", "lp"], shift: true, shiftKey: "shift-l",
    });
});

test("shifted symbols map to their base key", () => {
    assert.equal(guide.lookup("!").key, "1");
    assert.equal(guide.lookup("!").shiftKey, "shift-r"); // 1 is a left-hand key
    assert.equal(guide.lookup('"').key, "'");
    assert.equal(guide.lookup('"').shiftKey, "shift-l");
    assert.equal(guide.lookup("?").key, "/");
    assert.equal(guide.lookup("<").key, ",");
    assert.deepEqual(guide.lookup("_").fingers, ["rp", "lp"]);
});

test("space uses a thumb", () => {
    assert.deepEqual(guide.lookup(" ").fingers, ["lt", "rt"]);
    assert.equal(guide.lookup(" ").shift, false);
});

test("unknown characters have no fingering", () => {
    for (const c of ["\u00e9", "\u00fc", "\u2014", "\u4e2d", "\n"]) {
        assert.equal(guide.lookup(c), null, c);
    }
    // inherited object keys must not leak through the shift table
    assert.equal(guide.lookup("constructor".charAt(0)).key, "c");
});

test("descriptions", () => {
    assert.equal(guide.describe("f"), "\u201cf\u201d \u2014 left index finger");
    assert.equal(
        guide.describe("T"),
        "\u201cT\u201d \u2014 left index finger, hold Shift with your right pinky",
    );
    assert.equal(guide.describe(" "), "Space \u2014 either thumb");
    assert.match(guide.describe("\u00e9"), /no standard fingering/);
    assert.equal(guide.describe(null), "");
});
