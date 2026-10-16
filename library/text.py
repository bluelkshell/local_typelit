import re

_REPLACEMENTS = {
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
}
_TRANSLATION = str.maketrans(_REPLACEMENTS)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def normalize_for_typing(text: str, ascii_punctuation: bool = True) -> str:
    """Collapse whitespace and (optionally) replace typographic punctuation
    with characters that exist on a normal keyboard."""
    if ascii_punctuation:
        text = text.translate(_TRANSLATION)
    return " ".join(text.split())


_LIGATURES = str.maketrans(
    {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl"}
)
_HYPHEN_BREAK = re.compile(r"(?<=[a-z])-\n\s*(?=[a-z])")
_PAGE_NUMBER = re.compile(r"\d{1,4}")


def reflow_extracted_text(text: str) -> str:
    """Clean up text extracted from a PDF: undo hard line wraps and hyphenated
    line breaks, drop bare page numbers and keep blank lines as paragraph breaks."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = text.translate(_LIGATURES)
    text = _HYPHEN_BREAK.sub("", text)

    paragraphs: list[str] = []
    current: list[str] = []

    def flush():
        if current:
            paragraphs.append(" ".join(current))
            current.clear()

    for line in text.split("\n"):
        line = line.strip()
        if not line:
            flush()
        elif _PAGE_NUMBER.fullmatch(line):
            continue
        else:
            current.append(line)
    flush()
    return "\n\n".join(paragraphs)


def split_into_chapters(text: str, words_per_chapter: int = 300) -> list[str]:
    """Split a long text into chunks of roughly ``words_per_chapter`` words,
    breaking at paragraph (and, for huge paragraphs, sentence) boundaries."""
    words_per_chapter = max(20, words_per_chapter)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

    pieces: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph.split()) > words_per_chapter * 1.5:
            pieces.extend(s for s in _SENTENCE_SPLIT.split(paragraph) if s.strip())
        else:
            pieces.append(paragraph)

    chapters: list[str] = []
    current: list[str] = []
    count = 0
    for piece in pieces:
        words = len(piece.split())
        if current and count + words > words_per_chapter * 1.25:
            chapters.append("\n\n".join(current))
            current, count = [], 0
        current.append(piece)
        count += words
        if count >= words_per_chapter:
            chapters.append("\n\n".join(current))
            current, count = [], 0
    if current:
        chapters.append("\n\n".join(current))
    return chapters
