from pathlib import Path

from django import forms

from .models import Book, Chapter
from .services import PdfImportError, extract_text


class BookForm(forms.ModelForm):
    class Meta:
        model = Book
        fields = ["title", "author", "language", "description"]
        widgets = {"description": forms.Textarea(attrs={"rows": 3})}


class ChapterForm(forms.ModelForm):
    class Meta:
        model = Chapter
        fields = ["order", "title", "text"]
        widgets = {"text": forms.Textarea(attrs={"rows": 18})}


class ImportBookForm(forms.Form):
    title = forms.CharField(
        max_length=200,
        required=False,
        help_text="Optional for PDFs: falls back to the PDF's title, then the file name.",
    )
    author = forms.CharField(max_length=200, required=False)
    language = forms.CharField(max_length=10, initial="en")
    description = forms.CharField(
        widget=forms.Textarea(attrs={"rows": 2}), required=False
    )
    file = forms.FileField(
        required=False,
        label="Text or PDF file",
        widget=forms.ClearableFileInput(
            attrs={"accept": ".txt,.pdf,text/plain,application/pdf"}
        ),
    )
    text = forms.CharField(
        widget=forms.Textarea(attrs={"rows": 12}),
        required=False,
        label="...or paste text",
    )
    words_per_chapter = forms.IntegerField(
        min_value=20,
        max_value=5000,
        initial=300,
        help_text="Approximate size of each chapter when the text is split up.",
    )

    def clean(self):
        cleaned = super().clean()
        upload = cleaned.get("file")
        text = cleaned.get("text", "")
        title = cleaned.get("title", "")
        author = cleaned.get("author", "")

        if upload:
            try:
                extracted = extract_text(upload.read(), upload.name)
            except PdfImportError as exc:
                raise forms.ValidationError(str(exc))
            text = extracted.text
            title = title or extracted.title or Path(upload.name).stem.replace("_", " ")
            author = author or extracted.author

        if not text or not text.strip():
            raise forms.ValidationError("Upload a file or paste some text.")
        if not title:
            self.add_error("title", "Please enter a title.")

        cleaned.update(source_text=text, title=title, author=author)
        return cleaned
