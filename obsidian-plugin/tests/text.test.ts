import test from "node:test";
import assert from "node:assert/strict";
import {
    hashText,
    markdownToPlain,
    normalizeForTyping,
    prepareText,
    truncateAtWord,
} from "../src/text.ts";

const plain = (md: string, skipCode = true) =>
    normalizeForTyping(markdownToPlain(md, { skipCode }));

test("normalizes typographic punctuation and whitespace", () => {
    assert.equal(
        normalizeForTyping(
            "\u201cHello,\u201d she said \u2014 it\u2019s fine\u2026\n\n  Really.",
        ),
        '"Hello," she said -- it\'s fine... Really.',
    );
    assert.equal(normalizeForTyping("\u201cx\u201d", false), "\u201cx\u201d");
});

test("headings, lists, quotes and tasks lose their markers", () => {
    const md =
        "# Title\n\n## Sub\n- one\n* two\n+ three\n1. first\n2) second\n- [ ] todo\n- [x] done\n> quoted\n> > nested";
    assert.equal(
        plain(md),
        "Title Sub one two three first second todo done quoted nested",
    );
});

test("links and wikilinks keep their visible text", () => {
    assert.equal(
        plain(
            "See [the docs](https://example.com) and [[Some Note|my alias]].",
        ),
        "See the docs and my alias.",
    );
    assert.equal(
        plain("Go to [[Page Name]] or [[Page#Heading]] or [[#Local heading]]."),
        "Go to Page Name or Page or Local heading.",
    );
});

test("images and embeds are removed", () => {
    assert.equal(
        plain("Before ![alt](pic.png) middle ![[photo.jpg]] after"),
        "Before middle after",
    );
});

test("inline formatting is stripped", () => {
    assert.equal(
        plain(
            "**bold** and *italic* and __bold2__ and _it2_ and ~~gone~~ and ==marked== and `code`",
        ),
        "bold and italic and bold2 and it2 and gone and marked and code",
    );
});

test("snake_case and arithmetic survive", () => {
    assert.equal(
        plain("call my_var_name and compute 2*3*4 now"),
        "call my_var_name and compute 2*3*4 now",
    );
});

test("frontmatter and comments are removed", () => {
    const md =
        "---\ntitle: X\ntags: [a, b]\n---\nBody text.\n%%hidden note%% visible <!-- html comment --> end";
    assert.equal(plain(md), "Body text. visible end");
    // a --- rule later in the note is not frontmatter
    assert.equal(plain("Intro\n\n---\n\nAfter"), "Intro After");
});

test("code blocks can be skipped or kept", () => {
    const md = "Before\n```js\nconst a = 1;\n```\nAfter";
    assert.equal(plain(md, true), "Before After");
    assert.equal(plain(md, false), "Before const a = 1; After");
});

test("footnotes and callouts", () => {
    assert.equal(
        plain("A claim.[^1] More.\n\n[^1]: The source."),
        "A claim. More.",
    );
    assert.equal(
        plain("> [!note] Title\n> Body of the callout"),
        "Title Body of the callout",
    );
});

test("tables become plain words", () => {
    const md = "| Name | Age |\n| --- | :---: |\n| Ann | 30 |";
    assert.equal(plain(md), "Name Age Ann 30");
});

test("html tags and escapes", () => {
    assert.equal(
        plain("a <b>bold</b> word and 1\\. not a list and \\*stars\\*"),
        "a bold word and 1. not a list and *stars*",
    );
});

test("escaped markers are protected from every rule", () => {
    assert.equal(
        plain("\\*not italic\\* and \\_not either\\_ and \\# not a heading"),
        "*not italic* and _not either_ and # not a heading",
    );
    assert.equal(plain("\\[not a link\\](url)"), "[not a link](url)");
    assert.equal(plain("a \\\\ backslash"), "a \\ backslash");
    // control characters in the source can't forge an escape marker
    assert.equal(plain("x\u00001234\u0001y"), "x1234y");
    // a backslash before an ordinary letter stays
    assert.equal(plain("path C:\\dir"), "path C:\\dir");
});

test("prepareText honours the options", () => {
    const raw = "# Title\n\u201cHi\u201d";
    assert.equal(
        prepareText(raw, {
            stripMarkdown: true,
            skipCode: true,
            asciiPunctuation: true,
        }),
        'Title "Hi"',
    );
    assert.equal(
        prepareText(raw, {
            stripMarkdown: false,
            skipCode: true,
            asciiPunctuation: true,
        }),
        '# Title "Hi"',
    );
    assert.equal(
        prepareText("", {
            stripMarkdown: true,
            skipCode: true,
            asciiPunctuation: true,
        }),
        "",
    );
});

test("truncateAtWord", () => {
    assert.deepEqual(truncateAtWord("short", 100), {
        text: "short",
        truncated: false,
    });
    const result = truncateAtWord("alpha beta gamma delta", 14);
    assert.equal(result.truncated, true);
    assert.equal(result.text, "alpha beta");
    // a single huge word is cut hard instead
    assert.equal(truncateAtWord("x".repeat(50), 10).text, "x".repeat(10));
});

test("hashText changes when the text changes", () => {
    assert.equal(hashText("abc"), hashText("abc"));
    assert.notEqual(hashText("abc"), hashText("abd"));
    assert.notEqual(hashText("abc"), hashText("abcd"));
    assert.match(hashText(""), /^[0-9a-f]+$/);
});
