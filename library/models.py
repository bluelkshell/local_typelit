import hashlib

from django.db import models
from django.db.models import Max
from django.urls import reverse

from .text import normalize_for_typing


class Book(models.Model):
    title = models.CharField(max_length=200)
    author = models.CharField(max_length=200, blank=True)
    language = models.CharField(
        max_length=10, default="en", help_text="Language code, e.g. en, de, fr."
    )
    description = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return f"{self.title} - {self.author}" if self.author else self.title

    def get_absolute_url(self):
        return reverse("library:book_detail", args=[self.pk])

    def next_chapter_order(self):
        last = self.chapters.aggregate(m=Max("order"))["m"]
        return (last or 0) + 1


class Chapter(models.Model):
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="chapters")
    order = models.PositiveIntegerField(default=1)
    title = models.CharField(max_length=200, blank=True)
    text = models.TextField(
        help_text="Plain text. Line breaks are turned into single spaces when typing."
    )

    class Meta:
        ordering = ["book", "order", "pk"]

    def __str__(self):
        return f"{self.book.title}: {self.display_title}"

    @property
    def display_title(self):
        return self.title or f"Chapter {self.order}"

    @property
    def typing_text(self):
        return normalize_for_typing(self.text)

    @property
    def typing_text_hash(self):
        return hashlib.sha1(self.typing_text.encode("utf-8")).hexdigest()

    @property
    def word_count(self):
        return len(self.text.split())

    def get_absolute_url(self):
        return reverse("library:chapter_type", args=[self.pk])

    def next_chapter(self):
        return (
            self.book.chapters.filter(order__gt=self.order)
            .order_by("order", "pk")
            .first()
        )


class ChapterProgress(models.Model):
    """Where you stopped in a chapter, so you can pick up again later.

    One row per chapter; removed when the chapter is finished or restarted."""

    chapter = models.OneToOneField(
        Chapter, on_delete=models.CASCADE, related_name="progress"
    )
    typed = models.TextField(
        help_text="Exactly what was typed so far, mistakes included."
    )
    position = models.PositiveIntegerField(help_text="Characters typed so far.")
    total = models.PositiveIntegerField(
        help_text="Characters in the chapter when saved."
    )
    elapsed = models.FloatField(default=0, help_text="Seconds spent typing.")
    keystrokes = models.PositiveIntegerField(default=0)
    errors = models.PositiveIntegerField(default=0)
    text_hash = models.CharField(max_length=40)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "chapter progress"

    def __str__(self):
        return f"{self.chapter}: {self.percent}%"

    @property
    def percent(self):
        return round(self.position * 100 / self.total) if self.total else 0


class PomodoroSession(models.Model):
    """A completed focus session from the Pomodoro timer."""

    key = models.BigIntegerField(
        unique=True,
        help_text="Client-generated id (end time in ms) so a session is only counted once.",
    )
    minutes = models.PositiveSmallIntegerField()
    local_date = models.DateField(help_text="Date in the browser's timezone.")
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-completed_at"]

    def __str__(self):
        return f"{self.minutes} min on {self.local_date}"


class TypingResult(models.Model):
    chapter = models.ForeignKey(
        Chapter, on_delete=models.CASCADE, related_name="results"
    )
    wpm = models.FloatField()
    accuracy = models.FloatField(help_text="Percentage, 0-100.")
    seconds = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.chapter}: {self.wpm:.0f} wpm @ {self.accuracy:.0f}%"
