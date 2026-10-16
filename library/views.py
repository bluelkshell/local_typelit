import json
from datetime import date

from django.db.models import Avg, Count, F, Max, Sum
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import BookForm, ChapterForm, ImportBookForm
from .models import (
    Book,
    Chapter,
    ChapterProgress,
    PomodoroSession,
    TypingResult,
)
from .services import create_book_from_text


def get_resume_target():
    """Where to send the user from the library page: the chapter they were in the
    middle of, otherwise the chapter after the one they finished last."""
    progress = (
        ChapterProgress.objects.select_related("chapter__book")
        .order_by("-updated_at")
        .first()
    )
    if progress:
        if progress.text_hash == progress.chapter.typing_text_hash:
            return {
                "chapter": progress.chapter,
                "percent": progress.percent,
                "resume": True,
            }
        progress.delete()  # chapter text changed since it was saved
    last = TypingResult.objects.select_related("chapter__book").first()
    if last:
        following = last.chapter.next_chapter()
        if following:
            return {"chapter": following, "percent": None, "resume": False}
    return None


def book_list(request):
    books = Book.objects.annotate(chapter_count=Count("chapters", distinct=True))
    # "completed" = chapters with at least one saved result.
    done = dict(
        Chapter.objects.filter(results__isnull=False)
        .values_list("book")
        .annotate(n=Count("pk", distinct=True))
    )
    for book in books:
        book.completed = done.get(book.pk, 0)
    return render(
        request,
        "library/book_list.html",
        {"books": books, "resume": get_resume_target()},
    )


def book_detail(request, pk):
    book = get_object_or_404(Book, pk=pk)
    chapters = book.chapters.annotate(
        best_wpm=Max("results__wpm"),
        attempts=Count("results"),
        progress_pos=F("progress__position"),
        progress_total=F("progress__total"),
    )
    return render(
        request, "library/book_detail.html", {"book": book, "chapters": chapters}
    )


def book_create(request):
    form = BookForm(request.POST or None)
    if form.is_valid():
        book = form.save()
        return redirect(book)
    return render(request, "library/form.html", {"form": form, "heading": "New book"})


def book_edit(request, pk):
    book = get_object_or_404(Book, pk=pk)
    form = BookForm(request.POST or None, instance=book)
    if form.is_valid():
        form.save()
        return redirect(book)
    return render(
        request,
        "library/form.html",
        {
            "form": form,
            "heading": f"Edit {book.title}",
            "cancel_url": book.get_absolute_url(),
        },
    )


def book_delete(request, pk):
    book = get_object_or_404(Book, pk=pk)
    if request.method == "POST":
        book.delete()
        return redirect("library:book_list")
    return render(
        request,
        "library/confirm_delete.html",
        {"object": book, "cancel_url": book.get_absolute_url()},
    )


def book_import(request):
    form = ImportBookForm(request.POST or None, request.FILES or None)
    if form.is_valid():
        data = form.cleaned_data
        book = create_book_from_text(
            title=data["title"],
            author=data["author"],
            language=data["language"],
            description=data["description"],
            text=data["source_text"],
            words_per_chapter=data["words_per_chapter"],
        )
        return redirect(book)
    return render(
        request,
        "library/form.html",
        {
            "form": form,
            "heading": "Import a book",
            "multipart": True,
            "submit_label": "Import",
            "intro": "Upload a .txt or text-based .pdf file (e.g. from Project Gutenberg) "
            "or paste text. It will be split into chapters you can edit afterwards.",
        },
    )


def chapter_create(request, book_pk):
    book = get_object_or_404(Book, pk=book_pk)
    form = ChapterForm(
        request.POST or None, initial={"order": book.next_chapter_order()}
    )
    if form.is_valid():
        chapter = form.save(commit=False)
        chapter.book = book
        chapter.save()
        return redirect(book)
    return render(
        request,
        "library/form.html",
        {
            "form": form,
            "heading": f"New chapter in {book.title}",
            "cancel_url": book.get_absolute_url(),
        },
    )


def chapter_edit(request, pk):
    chapter = get_object_or_404(Chapter, pk=pk)
    form = ChapterForm(request.POST or None, instance=chapter)
    if form.is_valid():
        form.save()
        if "text" in form.changed_data:
            ChapterProgress.objects.filter(chapter=chapter).delete()
        return redirect(chapter.book)
    return render(
        request,
        "library/form.html",
        {
            "form": form,
            "heading": f"Edit {chapter.display_title}",
            "cancel_url": chapter.book.get_absolute_url(),
        },
    )


def chapter_delete(request, pk):
    chapter = get_object_or_404(Chapter, pk=pk)
    book = chapter.book
    if request.method == "POST":
        chapter.delete()
        return redirect(book)
    return render(
        request,
        "library/confirm_delete.html",
        {"object": chapter, "cancel_url": book.get_absolute_url()},
    )


def chapter_type(request, pk):
    chapter = get_object_or_404(Chapter.objects.select_related("book"), pk=pk)
    next_chapter = chapter.next_chapter()
    saved = None
    progress = ChapterProgress.objects.filter(chapter=chapter).first()
    if progress:
        if progress.text_hash == chapter.typing_text_hash:
            saved = {
                "typed": progress.typed,
                "elapsed": progress.elapsed,
                "keystrokes": progress.keystrokes,
                "errors": progress.errors,
                "percent": progress.percent,
            }
        else:  # chapter text changed since it was saved
            progress.delete()
    return render(
        request,
        "library/chapter_type.html",
        {
            "chapter": chapter,
            "typing_text": chapter.typing_text,
            "saved": saved,
            "next_url": next_chapter.get_absolute_url() if next_chapter else "",
            "best": chapter.results.aggregate(wpm=Max("wpm"))["wpm"],
        },
    )


@require_POST
def save_result(request, pk):
    chapter = get_object_or_404(Chapter, pk=pk)
    try:
        data = json.loads(request.body)
        wpm = float(data["wpm"])
        accuracy = float(data["accuracy"])
        seconds = float(data["seconds"])
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"error": "bad payload"}, status=400)
    if not (0 <= accuracy <= 100 and wpm >= 0 and seconds > 0):
        return JsonResponse({"error": "bad values"}, status=400)
    previous_best = chapter.results.aggregate(wpm=Max("wpm"))["wpm"]
    TypingResult.objects.create(
        chapter=chapter, wpm=wpm, accuracy=accuracy, seconds=seconds
    )
    ChapterProgress.objects.filter(chapter=chapter).delete()
    return JsonResponse(
        {"ok": True, "new_best": previous_best is None or wpm > previous_best}
    )


@require_POST
def save_progress(request, pk):
    """Store (or, if nothing is typed, clear) the in-progress state of a chapter."""
    chapter = get_object_or_404(Chapter, pk=pk)
    try:
        data = json.loads(request.body)
        typed = data["typed"]
        elapsed = float(data["elapsed"])
        keystrokes = int(data["keystrokes"])
        errors = int(data["errors"])
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"error": "bad payload"}, status=400)

    text = chapter.typing_text
    if not isinstance(typed, str) or len(typed) > len(text):
        return JsonResponse({"error": "bad values"}, status=400)
    if elapsed < 0 or keystrokes < 0 or errors < 0:
        return JsonResponse({"error": "bad values"}, status=400)

    # Nothing typed, or already typed perfectly to the end (which is a finished
    # run saved through save_result): there is nothing to resume.
    if not typed or typed == text:
        ChapterProgress.objects.filter(chapter=chapter).delete()
        return JsonResponse({"ok": True, "saved": False})

    ChapterProgress.objects.update_or_create(
        chapter=chapter,
        defaults={
            "typed": typed,
            "position": len(typed),
            "total": len(text),
            "elapsed": elapsed,
            "keystrokes": keystrokes,
            "errors": errors,
            "text_hash": chapter.typing_text_hash,
        },
    )
    return JsonResponse({"ok": True, "saved": True})


def stats(request):
    results = TypingResult.objects.select_related("chapter__book")[:50]
    totals = TypingResult.objects.aggregate(
        runs=Count("pk"),
        avg_wpm=Avg("wpm"),
        best_wpm=Max("wpm"),
        avg_acc=Avg("accuracy"),
    )
    pomodoro_totals = PomodoroSession.objects.aggregate(
        sessions=Count("pk"), minutes=Sum("minutes")
    )
    pomodoro_days = (
        PomodoroSession.objects.values("local_date")
        .annotate(sessions=Count("pk"), minutes=Sum("minutes"))
        .order_by("-local_date")[:14]
    )
    return render(
        request,
        "library/stats.html",
        {
            "results": results,
            "totals": totals,
            "pomodoro_totals": pomodoro_totals,
            "pomodoro_days": pomodoro_days,
        },
    )


def _pomodoro_today(day):
    agg = PomodoroSession.objects.filter(local_date=day).aggregate(
        sessions=Count("pk"), minutes=Sum("minutes")
    )
    return {"today": agg["sessions"], "minutes": agg["minutes"] or 0}


def pomodoro_today(request):
    try:
        day = date.fromisoformat(request.GET.get("date", ""))
    except ValueError:
        return JsonResponse({"error": "bad date"}, status=400)
    return JsonResponse(_pomodoro_today(day))


@require_POST
def pomodoro_complete(request):
    """Record a finished focus session. Safe to call twice with the same key."""
    try:
        data = json.loads(request.body)
        key = int(data["key"])
        minutes = int(data["minutes"])
        day = date.fromisoformat(data["date"])
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"error": "bad payload"}, status=400)
    if not (1 <= minutes <= 180) or key <= 0:
        return JsonResponse({"error": "bad values"}, status=400)
    _, created = PomodoroSession.objects.get_or_create(
        key=key, defaults={"minutes": minutes, "local_date": day}
    )
    return JsonResponse({"ok": True, "created": created, **_pomodoro_today(day)})
