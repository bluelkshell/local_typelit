from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from library.services import PdfImportError, create_book_from_text, extract_text


class Command(BaseCommand):
    help = "Import a plain-text or PDF file as a book, split into chapters."

    def add_arguments(self, parser):
        parser.add_argument("file", type=Path, help=".txt or .pdf file")
        parser.add_argument(
            "--title", help="Defaults to the PDF's title, then the file name."
        )
        parser.add_argument("--author", default="")
        parser.add_argument("--language", default="en")
        parser.add_argument("--words-per-chapter", type=int, default=300)

    def handle(self, *args, **options):
        path: Path = options["file"]
        if not path.is_file():
            raise CommandError(f"File not found: {path}")
        try:
            extracted = extract_text(path.read_bytes(), path.name)
        except PdfImportError as exc:
            raise CommandError(str(exc))
        if not extracted.text.strip():
            raise CommandError("File is empty.")
        book = create_book_from_text(
            title=options["title"]
            or extracted.title
            or path.stem.replace("_", " ").title(),
            author=options["author"] or extracted.author,
            language=options["language"],
            text=extracted.text,
            words_per_chapter=options["words_per_chapter"],
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Imported '{book.title}' with {book.chapters.count()} chapters."
            )
        )
