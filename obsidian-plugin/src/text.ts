// Turning a note into text you can actually type. Pure functions: no Obsidian API.

export interface PrepareOptions {
    stripMarkdown: boolean;
    skipCode: boolean;
    asciiPunctuation: boolean;
}

const REPLACEMENTS: Record<string, string> = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201a": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u201e": '"',
    "\u2013": "-",
    "\u2014": "--",
    "\u2026": "...",
    "\u00a0": " ",
    "\ufeff": "",
};

/** Collapse whitespace and (optionally) swap typographic punctuation for
 *  characters that exist on a normal keyboard. */
export function normalizeForTyping(
    text: string,
    asciiPunctuation = true,
): string {
    if (asciiPunctuation) {
        text = text.replace(
            /[\u2018\u2019\u201a\u201c\u201d\u201e\u2013\u2014\u2026\u00a0\ufeff]/g,
            (c) => REPLACEMENTS[c] ?? c,
        );
    }
    return text.split(/\s+/).filter(Boolean).join(" ");
}

/** Strip Markdown / Obsidian syntax and keep the prose. */
export function markdownToPlain(
    markdown: string,
    options: { skipCode: boolean },
): string {
    let text = markdown.replace(/\r\n?/g, "\n");

    text = text.replace(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/, ""); // YAML frontmatter
    text = text.replace(/%%[\s\S]*?%%/g, ""); // Obsidian comments
    text = text.replace(/<!--[\s\S]*?-->/g, ""); // HTML comments

    // Fenced code blocks: dropped, or kept without their fences.
    text = text.replace(
        /^(```|~~~)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm,
        (_m, _fence, body: string) => (options.skipCode ? "" : body),
    );

    // Hide backslash-escaped characters (\*, \_ ...) from the rules below, so they
    // are not mistaken for formatting; they are put back, without the backslash, at
    // the end. Control characters never occur in notes, so they make safe markers.
    text = text.replace(/[\u0000\u0001]/g, "");
    text = text.replace(
        /\\([\\`*_{}[\]()#+\-.!|>~=])/g,
        (_m, ch: string) => `\u0000${ch.charCodeAt(0)}\u0001`,
    );

    text = text.replace(/!\[\[[^\]]*\]\]/g, ""); // embeds ![[file]]
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images
    text = text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2"); // [[page|alias]]
    text = text.replace(/\[\[([^\]]*)\]\]/g, (_m, target: string) => {
        const parts = target.split(/[#^]/);
        return parts[0] || parts[1] || "";
    });
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // [text](url)

    text = text.replace(/^\[\^[^\]]*\]:.*$/gm, ""); // footnote definitions
    text = text.replace(/\[\^[^\]]*\]/g, ""); // footnote references

    text = text.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, ""); // horizontal rules
    text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ""); // headings
    text = text.replace(/^(?:[ \t]*>[ \t]?)+/gm, ""); // blockquotes
    text = text.replace(/\[![A-Za-z-]+\][+-]?[ \t]*/g, ""); // callout markers [!note]
    text = text.replace(
        /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm,
        "",
    ); // lists, tasks

    // Tables: drop the separator row, turn the pipes into spaces.
    text = text.replace(
        /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm,
        "",
    );
    text = text.replace(/^[ \t]*\|(.*)$/gm, (_m, rest: string) =>
        rest.replace(/\|/g, " "),
    );

    // Inline formatting. The lookarounds keep snake_case and 2*3*4 intact.
    text = text.replace(/`([^`\n]+)`/g, "$1");
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "$1");
    text = text.replace(/(?<!\w)__([^_\n]+)__(?!\w)/g, "$1");
    text = text.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1");
    text = text.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");
    text = text.replace(/~~([^~\n]+)~~/g, "$1");
    text = text.replace(/==([^=\n]+)==/g, "$1");
    text = text.replace(/<\/?[A-Za-z][^>\n]*>/g, ""); // HTML tags

    return text.replace(/\u0000(\d+)\u0001/g, (_m, code: string) =>
        String.fromCharCode(Number(code)),
    );
}

export function prepareText(raw: string, options: PrepareOptions): string {
    const plain = options.stripMarkdown
        ? markdownToPlain(raw, { skipCode: options.skipCode })
        : raw;
    return normalizeForTyping(plain, options.asciiPunctuation);
}

/** Cut a very long text at a word boundary. */
export function truncateAtWord(
    text: string,
    max: number,
): { text: string; truncated: boolean } {
    if (text.length <= max) return { text, truncated: false };
    const cut = text.lastIndexOf(" ", max);
    return {
        text: text.slice(0, cut > max * 0.5 ? cut : max),
        truncated: true,
    };
}

/** A short fingerprint, used to notice that a note changed since progress was saved. */
export function hashText(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0") + text.length.toString(16);
}
