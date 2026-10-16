import json
import tempfile
from io import StringIO
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from .models import Book, Chapter, ChapterProgress, PomodoroSession, TypingResult
from .pdf import PdfImportError, extract_pdf
from .text import normalize_for_typing, reflow_extracted_text, split_into_chapters


def make_pdf(pages, title=None, author=None):
    """Build a minimal valid text PDF. ``pages`` is a list of lists of lines."""

    def esc(s):
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    objects = {}
    page_ids = []
    next_id = 5  # 1 catalog, 2 pages, 3 font, 4 info
    for lines in pages:
        content = (
            "BT /F1 12 Tf 14 TL 50 750 Td\n"
            + "".join(f"({esc(line)}) '\n" for line in lines)
            + "ET"
        )
        page_id, content_id = next_id, next_id + 1
        next_id += 2
        objects[content_id] = (
            f"<< /Length {len(content)} >>\nstream\n{content}\nendstream"
        )
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Contents {content_id} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
        )
        page_ids.append(page_id)
    kids = " ".join(f"{i} 0 R" for i in page_ids)
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>"
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    info = ""
    if title:
        info += f"/Title ({esc(title)}) "
    if author:
        info += f"/Author ({esc(author)}) "
    objects[4] = f"<< {info}>>"

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for obj_id in sorted(objects):
        offsets[obj_id] = len(out)
        out += f"{obj_id} 0 obj\n{objects[obj_id]}\nendobj\n".encode("latin-1")
    xref = len(out)
    count = max(objects) + 1
    out += f"xref\n0 {count}\n0000000000 65535 f \n".encode()
    for obj_id in range(1, count):
        out += f"{offsets[obj_id]:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {count} /Root 1 0 R /Info 4 0 R >>\n"
        f"startxref\n{xref}\n%%EOF\n"
    ).encode()
    return bytes(out)


class TextTests(TestCase):
    def test_normalize(self):
        raw = "\u201cHello,\u201d she said \u2014 it\u2019s fine\u2026\n\n  Really."
        self.assertEqual(
            normalize_for_typing(raw), '"Hello," she said -- it\'s fine... Really.'
        )

    def test_split_respects_paragraphs(self):
        paragraph = " ".join(["word"] * 100)
        text = "\n\n".join([paragraph] * 6)
        chapters = split_into_chapters(text, words_per_chapter=200)
        self.assertEqual(len(chapters), 3)
        self.assertTrue(all(len(c.split()) == 200 for c in chapters))

    def test_split_huge_paragraph_by_sentence(self):
        text = " ".join(["This is a sentence of eight words in total."] * 100)
        chapters = split_into_chapters(text, words_per_chapter=100)
        self.assertGreater(len(chapters), 1)
        self.assertEqual(sum(len(c.split()) for c in chapters), 900)


class PdfTests(TestCase):
    def sample_pdf(self):
        return make_pdf(
            [
                [
                    "It was a bright cold day in April, and the",
                    "clocks were strik-",
                    "ing thirteen.",
                    "",
                    "Second paragraph here.",
                ],
                ["12", "continues on the next page."],
            ],
            title="Sample PDF",
            author="A. Writer",
        )

    def test_reflow(self):
        raw = "Hello wor-\nld, this is\na \ufb01ne day.\n\n7\nNew para."
        self.assertEqual(
            reflow_extracted_text(raw), "Hello world, this is a fine day.\n\nNew para."
        )

    def test_extract_pdf(self):
        pdf = extract_pdf(self.sample_pdf())
        self.assertEqual(pdf.title, "Sample PDF")
        self.assertEqual(pdf.author, "A. Writer")
        self.assertIn("clocks were striking thirteen.", pdf.text)
        self.assertIn("Second paragraph here. continues on the next page.", pdf.text)
        self.assertNotIn("12", pdf.text)

    def test_pdf_without_text(self):
        with self.assertRaises(PdfImportError):
            extract_pdf(make_pdf([[]]))

    def test_garbage_pdf(self):
        with self.assertRaises(PdfImportError):
            extract_pdf(b"%PDF-1.4 this is not a pdf")

    def test_import_pdf_via_form_uses_metadata(self):
        response = self.client.post(
            reverse("library:book_import"),
            {
                "language": "en",
                "words_per_chapter": 20,
                "file": SimpleUploadedFile("whatever.pdf", self.sample_pdf()),
            },
        )
        self.assertEqual(response.status_code, 302)
        book = Book.objects.get(title="Sample PDF")
        self.assertEqual(book.author, "A. Writer")
        self.assertGreaterEqual(book.chapters.count(), 1)

    def test_import_bad_pdf_shows_error(self):
        response = self.client.post(
            reverse("library:book_import"),
            {
                "language": "en",
                "words_per_chapter": 20,
                "file": SimpleUploadedFile("bad.pdf", b"%PDF- nope"),
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Could not read this PDF")
        self.assertEqual(Book.objects.count(), 0)

    def test_import_command_with_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "my_book.pdf"
            path.write_bytes(make_pdf([["Just some words to type."]]))
            out = StringIO()
            call_command("import_book", str(path), stdout=out)
        self.assertIn("Imported 'My Book'", out.getvalue())


class ViewTests(TestCase):
    def setUp(self):
        self.book = Book.objects.create(title="Test Book", author="Me")
        self.ch1 = Chapter.objects.create(book=self.book, order=1, text="Hello world.")
        self.ch2 = Chapter.objects.create(book=self.book, order=2, text="Second one.")

    def test_pages_render(self):
        for url in [
            reverse("library:book_list"),
            reverse("library:stats"),
            reverse("library:book_create"),
            reverse("library:book_import"),
            self.book.get_absolute_url(),
            reverse("library:book_edit", args=[self.book.pk]),
            reverse("library:chapter_create", args=[self.book.pk]),
            reverse("library:chapter_edit", args=[self.ch1.pk]),
            reverse("library:chapter_type", args=[self.ch1.pk]),
        ]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_typing_page_links_next_chapter(self):
        response = self.client.get(self.ch1.get_absolute_url())
        self.assertEqual(response.context["next_url"], self.ch2.get_absolute_url())
        response = self.client.get(self.ch2.get_absolute_url())
        self.assertEqual(response.context["next_url"], "")

    def test_edit_chapter_text(self):
        url = reverse("library:chapter_edit", args=[self.ch1.pk])
        self.client.post(url, {"order": 1, "title": "Intro", "text": "Rewritten."})
        self.ch1.refresh_from_db()
        self.assertEqual(self.ch1.text, "Rewritten.")
        self.assertEqual(self.ch1.display_title, "Intro")

    def test_create_chapter_gets_next_order(self):
        url = reverse("library:chapter_create", args=[self.book.pk])
        self.client.post(url, {"order": 3, "title": "", "text": "Third."})
        self.assertEqual(self.book.chapters.count(), 3)

    def test_delete_book_cascades(self):
        self.client.post(reverse("library:book_delete", args=[self.book.pk]))
        self.assertEqual(Chapter.objects.count(), 0)

    def test_import_from_upload(self):
        body = "\n\n".join(["Para %d. " % i + "word " * 60 for i in range(6)])
        response = self.client.post(
            reverse("library:book_import"),
            {
                "title": "Imported",
                "author": "Anon",
                "language": "en",
                "words_per_chapter": 100,
                "file": SimpleUploadedFile("b.txt", body.encode()),
            },
        )
        self.assertEqual(response.status_code, 302)
        book = Book.objects.get(title="Imported")
        self.assertGreaterEqual(book.chapters.count(), 3)

    def test_import_requires_text(self):
        response = self.client.post(
            reverse("library:book_import"),
            {"title": "Empty", "language": "en", "words_per_chapter": 100},
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Book.objects.filter(title="Empty").exists())

    def test_save_result(self):
        url = reverse("library:save_result", args=[self.ch1.pk])
        payload = json.dumps({"wpm": 55.5, "accuracy": 97.2, "seconds": 12})
        response = self.client.post(url, payload, content_type="application/json")
        self.assertEqual(response.json(), {"ok": True, "new_best": True})
        self.assertEqual(TypingResult.objects.count(), 1)
        response = self.client.post(
            url,
            json.dumps({"wpm": 40, "accuracy": 90, "seconds": 20}),
            content_type="application/json",
        )
        self.assertFalse(response.json()["new_best"])

    def post_progress(self, chapter, **overrides):
        payload = {"typed": "Hello", "elapsed": 4.5, "keystrokes": 6, "errors": 1}
        payload.update(overrides)
        return self.client.post(
            reverse("library:save_progress", args=[chapter.pk]),
            json.dumps(payload),
            content_type="application/json",
        )

    def test_save_progress_and_resume(self):
        self.assertEqual(
            self.post_progress(self.ch1).json(), {"ok": True, "saved": True}
        )
        progress = ChapterProgress.objects.get(chapter=self.ch1)
        self.assertEqual(
            (progress.typed, progress.position, progress.total), ("Hello", 5, 12)
        )

        response = self.client.get(self.ch1.get_absolute_url())
        saved = response.context["saved"]
        self.assertEqual(saved["typed"], "Hello")
        self.assertEqual(saved["elapsed"], 4.5)
        self.assertEqual(saved["percent"], 42)
        self.assertContains(response, "saved-progress")

        # A second save updates the same row.
        self.post_progress(self.ch1, typed="Hello wo")
        self.assertEqual(ChapterProgress.objects.count(), 1)
        self.assertEqual(ChapterProgress.objects.get().position, 8)

    def test_progress_keeps_mistakes(self):
        self.post_progress(self.ch1, typed="Hxllo")
        saved = self.client.get(self.ch1.get_absolute_url()).context["saved"]
        self.assertEqual(saved["typed"], "Hxllo")

    def test_empty_or_complete_progress_is_cleared(self):
        self.post_progress(self.ch1)
        self.assertEqual(self.post_progress(self.ch1, typed="").json()["saved"], False)
        self.assertEqual(ChapterProgress.objects.count(), 0)
        self.post_progress(self.ch1)
        self.post_progress(self.ch1, typed="Hello world.")
        self.assertEqual(ChapterProgress.objects.count(), 0)

    def test_progress_rejects_bad_data(self):
        self.assertEqual(self.post_progress(self.ch1, typed="x" * 50).status_code, 400)
        self.assertEqual(self.post_progress(self.ch1, elapsed=-1).status_code, 400)
        self.assertEqual(self.post_progress(self.ch1, typed=None).status_code, 400)
        url = reverse("library:save_progress", args=[self.ch1.pk])
        self.assertEqual(
            self.client.post(url, "nope", content_type="application/json").status_code,
            400,
        )
        self.assertEqual(self.client.get(url).status_code, 405)
        self.assertEqual(ChapterProgress.objects.count(), 0)

    def test_finishing_clears_progress(self):
        self.post_progress(self.ch1)
        self.client.post(
            reverse("library:save_result", args=[self.ch1.pk]),
            json.dumps({"wpm": 50, "accuracy": 99, "seconds": 10}),
            content_type="application/json",
        )
        self.assertEqual(ChapterProgress.objects.count(), 0)

    def test_editing_text_discards_progress(self):
        self.post_progress(self.ch1)
        url = reverse("library:chapter_edit", args=[self.ch1.pk])
        # Changing only the title keeps progress.
        self.client.post(
            url, {"order": 1, "title": "New title", "text": "Hello world."}
        )
        self.assertEqual(ChapterProgress.objects.count(), 1)
        self.client.post(
            url, {"order": 1, "title": "New title", "text": "Different text now."}
        )
        self.assertEqual(ChapterProgress.objects.count(), 0)

    def test_stale_progress_ignored_when_text_changes_elsewhere(self):
        self.post_progress(self.ch1)
        Chapter.objects.filter(pk=self.ch1.pk).update(text="Totally changed via admin.")
        response = self.client.get(self.ch1.get_absolute_url())
        self.assertIsNone(response.context["saved"])
        self.assertEqual(ChapterProgress.objects.count(), 0)

    def test_book_detail_shows_in_progress(self):
        self.post_progress(self.ch1)
        response = self.client.get(self.book.get_absolute_url())
        self.assertContains(response, "in progress: 42%")
        self.assertContains(response, "Continue")

    # --- continue card on the library page -------------------------------

    def test_library_has_no_resume_card_when_nothing_typed(self):
        response = self.client.get(reverse("library:book_list"))
        self.assertIsNone(response.context["resume"])

    def test_library_resumes_chapter_in_progress(self):
        self.post_progress(self.ch2, typed="Sec")
        response = self.client.get(reverse("library:book_list"))
        resume = response.context["resume"]
        self.assertEqual(resume["chapter"], self.ch2)
        self.assertTrue(resume["resume"])
        self.assertContains(response, "Continue where you left off")

    def test_library_resumes_most_recently_updated(self):
        self.post_progress(self.ch1)
        self.post_progress(self.ch2, typed="Sec")
        self.post_progress(self.ch1, typed="Hello w")
        resume = self.client.get(reverse("library:book_list")).context["resume"]
        self.assertEqual(resume["chapter"], self.ch1)

    def test_library_suggests_next_chapter_after_last_result(self):
        TypingResult.objects.create(chapter=self.ch1, wpm=50, accuracy=99, seconds=10)
        response = self.client.get(reverse("library:book_list"))
        resume = response.context["resume"]
        self.assertEqual(resume["chapter"], self.ch2)
        self.assertFalse(resume["resume"])
        self.assertContains(response, "Up next")

    def test_library_no_suggestion_after_last_chapter(self):
        TypingResult.objects.create(chapter=self.ch2, wpm=50, accuracy=99, seconds=10)
        self.assertIsNone(
            self.client.get(reverse("library:book_list")).context["resume"]
        )

    def test_library_ignores_stale_progress(self):
        self.post_progress(self.ch1)
        Chapter.objects.filter(pk=self.ch1.pk).update(text="Rewritten elsewhere.")
        self.assertIsNone(
            self.client.get(reverse("library:book_list")).context["resume"]
        )
        self.assertEqual(ChapterProgress.objects.count(), 0)

    # --- pomodoro ----------------------------------------------------------

    def post_pomodoro(self, **overrides):
        payload = {"key": 1760000000000, "minutes": 25, "date": "2026-10-16"}
        payload.update(overrides)
        return self.client.post(
            reverse("library:pomodoro_complete"),
            json.dumps(payload),
            content_type="application/json",
        )

    def test_pomodoro_complete_is_idempotent(self):
        first = self.post_pomodoro().json()
        self.assertEqual(
            (first["created"], first["today"], first["minutes"]), (True, 1, 25)
        )
        again = self.post_pomodoro().json()
        self.assertEqual((again["created"], again["today"]), (False, 1))
        self.assertEqual(PomodoroSession.objects.count(), 1)
        second = self.post_pomodoro(key=1760000001000, minutes=30).json()
        self.assertEqual((second["today"], second["minutes"]), (2, 55))

    def test_pomodoro_today_filters_by_date(self):
        self.post_pomodoro()
        url = reverse("library:pomodoro_today")
        self.assertEqual(
            self.client.get(url, {"date": "2026-10-16"}).json()["today"], 1
        )
        self.assertEqual(
            self.client.get(url, {"date": "2026-10-17"}).json()["today"], 0
        )
        self.assertEqual(self.client.get(url, {"date": "nonsense"}).status_code, 400)
        self.assertEqual(self.client.get(url).status_code, 400)

    def test_pomodoro_rejects_bad_data(self):
        for bad in [
            {"minutes": 0},
            {"minutes": 500},
            {"key": -5},
            {"key": "abc"},
            {"date": "16/10/2026"},
        ]:
            with self.subTest(bad=bad):
                self.assertEqual(self.post_pomodoro(**bad).status_code, 400)
        url = reverse("library:pomodoro_complete")
        self.assertEqual(
            self.client.post(url, "nope", content_type="application/json").status_code,
            400,
        )
        self.assertEqual(self.client.get(url).status_code, 405)
        self.assertEqual(PomodoroSession.objects.count(), 0)

    def test_stats_show_pomodoros(self):
        self.post_pomodoro()
        self.post_pomodoro(key=2, date="2026-10-15")
        response = self.client.get(reverse("library:stats"))
        self.assertEqual(response.context["pomodoro_totals"]["sessions"], 2)
        self.assertEqual(response.context["pomodoro_totals"]["minutes"], 50)
        self.assertEqual(len(response.context["pomodoro_days"]), 2)

    def test_pages_include_timer_widget(self):
        for url in [reverse("library:book_list"), self.ch1.get_absolute_url()]:
            response = self.client.get(url)
            self.assertContains(response, 'id="pomodoro"')
            self.assertContains(response, "pomodoro.js")

    def test_save_result_rejects_bad_data(self):
        url = reverse("library:save_result", args=[self.ch1.pk])
        response = self.client.post(url, "nope", content_type="application/json")
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            url,
            json.dumps({"wpm": 10, "accuracy": 500, "seconds": 5}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get(url).status_code, 405)
