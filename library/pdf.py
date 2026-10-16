import io
from dataclasses import dataclass

from pypdf import PdfReader

from .text import reflow_extracted_text


class PdfImportError(Exception):
    """Raised with a user-presentable message when a PDF can't be imported."""


@dataclass
class ExtractedPdf:
    text: str
    title: str = ""
    author: str = ""


def extract_pdf(raw: bytes) -> ExtractedPdf:
    try:
        reader = PdfReader(io.BytesIO(raw))
        if reader.is_encrypted and not reader.decrypt(""):
            raise PdfImportError("This PDF is password-protected.")
        # Pages are joined with a single newline so sentences that run across a
        # page break are reflowed into one paragraph.
        pages = [page.extract_text() or "" for page in reader.pages]
        meta = reader.metadata
        title = (meta.title or "").strip() if meta else ""
        author = (meta.author or "").strip() if meta else ""
    except PdfImportError:
        raise
    except Exception as exc:  # pypdf raises many different types for broken files
        raise PdfImportError(
            f"Could not read this PDF ({exc.__class__.__name__})."
        ) from exc

    text = reflow_extracted_text("\n".join(pages))
    if not text.strip():
        raise PdfImportError(
            "No text found in this PDF. It is probably scanned images, which "
            "would need OCR first."
        )
    return ExtractedPdf(text=text, title=title, author=author)
