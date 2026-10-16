from django.urls import path

from . import views

app_name = "library"

urlpatterns = [
    path("", views.book_list, name="book_list"),
    path("stats/", views.stats, name="stats"),
    path("pomodoro/today/", views.pomodoro_today, name="pomodoro_today"),
    path("pomodoro/complete/", views.pomodoro_complete, name="pomodoro_complete"),
    path("books/new/", views.book_create, name="book_create"),
    path("books/import/", views.book_import, name="book_import"),
    path("books/<int:pk>/", views.book_detail, name="book_detail"),
    path("books/<int:pk>/edit/", views.book_edit, name="book_edit"),
    path("books/<int:pk>/delete/", views.book_delete, name="book_delete"),
    path(
        "books/<int:book_pk>/chapters/new/", views.chapter_create, name="chapter_create"
    ),
    path("chapters/<int:pk>/", views.chapter_type, name="chapter_type"),
    path("chapters/<int:pk>/edit/", views.chapter_edit, name="chapter_edit"),
    path("chapters/<int:pk>/delete/", views.chapter_delete, name="chapter_delete"),
    path("chapters/<int:pk>/result/", views.save_result, name="save_result"),
    path("chapters/<int:pk>/progress/", views.save_progress, name="save_progress"),
]
