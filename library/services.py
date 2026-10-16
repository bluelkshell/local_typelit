from dataclasses import dataclass

from django.db import transaction

from .models import Book, Chapter
from .pdf import PdfImportError, extract_pdf  # noqa: F401  (PdfImportError re-exported)
from .text import split_into_chapters


@dataclass
class ExtractedText:
    text: str
    title: str = ""
    author: str = ""


def decode_upload(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def extract_text(raw: bytes, filename: str = "") -> ExtractedText:
    """Turn an uploaded .txt or .pdf into plain text (plus metadata if known).

    Raises PdfImportError for unreadable PDFs."""
    if filename.lower().endswith(".pdf") or raw.startswith(b"%PDF-"):
        pdf = extract_pdf(raw)
        return ExtractedText(text=pdf.text, title=pdf.title, author=pdf.author)
    return ExtractedText(text=decode_upload(raw))


@transaction.atomic
def create_book_from_text(
    *, title, author="", language="en", description="", text, words_per_chapter=300
) -> Book:
    book = Book.objects.create(
        title=title, author=author, language=language, description=description
    )
    chunks = split_into_chapters(text, words_per_chapter)
    Chapter.objects.bulk_create(
        Chapter(book=book, order=i, title=f"Part {i}", text=chunk)
        for i, chunk in enumerate(chunks, start=1)
    )
    return book
