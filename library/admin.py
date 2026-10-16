from django.contrib import admin

from .models import (
    Book,
    Chapter,
    ChapterProgress,
    PomodoroSession,
    TypingResult,
)


class ChapterInline(admin.StackedInline):
    model = Chapter
    extra = 0
    show_change_link = True


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ("title", "author", "language")
    search_fields = ("title", "author")
    inlines = [ChapterInline]


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):
    list_display = ("__str__", "book", "order")
    list_filter = ("book",)
    search_fields = ("title", "text")


@admin.register(ChapterProgress)
class ChapterProgressAdmin(admin.ModelAdmin):
    list_display = ("chapter", "position", "total", "updated_at")


@admin.register(PomodoroSession)
class PomodoroSessionAdmin(admin.ModelAdmin):
    list_display = ("local_date", "minutes", "completed_at")


@admin.register(TypingResult)
class TypingResultAdmin(admin.ModelAdmin):
    list_display = ("chapter", "wpm", "accuracy", "seconds", "created_at")
    list_filter = ("chapter__book",)
