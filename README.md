# Local TypeLit

A small, single-user typing trainer for the books you choose. Built with Django.

## Run it

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver
```

Open http://127.0.0.1:8000/.

Optional: `.venv/bin/python manage.py createsuperuser` to use the Django admin at `/admin/`.

## Run it with Docker

```sh
docker compose up -d --build
```

Open http://127.0.0.1:8765/ (change the port with `TYPELIT_PORT`).

- The container only listens on `127.0.0.1`, because the app has **no login**. Don't publish it
  on a network without putting authentication in front of it.
- Your data lives in the Docker volume `local-typelit_data` (the database and a generated secret
  key). It survives `docker compose down`, rebuilds and restarts. **`docker compose down -v`
  deletes it.**
- This is a separate database from the one used by `manage.py runserver`. To move your existing
  books across (this **replaces** the Docker database), or to take a backup:
    ```sh
    ./docker-db.sh import db.sqlite3
    ./docker-db.sh export backup.sqlite3
    ```
- Create an admin user: `docker compose exec web python manage.py createsuperuser`.
- Import a file: `docker compose cp book.pdf web:/tmp/` then
  `docker compose exec web python manage.py import_book /tmp/book.pdf`.
- If Docker Hub isn't reachable, put `PYTHON_IMAGE=<mirror>/python:3.14-slim` in a `.env` file.
- Run the tests: `docker compose run --rm --no-deps --entrypoint python web manage.py test`.
- Settings come from environment variables (`DJANGO_DEBUG`, `DJANGO_SECRET_KEY`,
  `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, `DJANGO_DATA_DIR`); see `docker-compose.yml`.

## Obsidian plugin

`obsidian-plugin/` holds an Obsidian version of this app: type your own notes inside Obsidian, with
resume, an idle-pausing clock and stats. It is a separate TypeScript implementation and does not share
data with this Django app. See `obsidian-plugin/README.md`.

## Adding and rewriting books

- **Import**: use the _Import_ page (upload a `.txt` or `.pdf`, or paste text), or from the command line:
  `python manage.py import_book book.pdf --title "..." --author "..." --words-per-chapter 300`
  The text is split into chapters at paragraph boundaries.
    - **PDFs** need a text layer (scanned image-only PDFs are rejected with a message; they need OCR first).
      Hard line wraps, hyphenated line breaks, ligatures and bare page-number lines are cleaned up,
      and the title/author are taken from the PDF metadata when you leave them blank.
      Running headers/footers and footnotes are not detected, so skim the imported chapters and
      use _Edit_ to remove anything odd.
- **Write your own**: _New book_, then _+ Chapter_.
- **Rewrite**: every chapter has an _Edit_ button (also available on the typing screen).
  The admin offers the same with search.

When typing, curly quotes, long dashes and ellipses are converted to plain keyboard
characters, and line breaks become spaces. Your stored text is left unchanged.
Tweak `library/text.py` if you want different behaviour, e.g. for non-English books.

## Typing screen

- The text feels smooth: a caret glides from letter to letter (blinking while you're not typing), lines
  ease up as you reach the end of one, and colours fade in. All motion is turned off if your system is set
  to _reduce motion_. The glide speed is `--caret-ms` in `style.css`.
- **Finger guide** (_Hands_ button, on by default and remembered): two hands and a small keyboard,
  just under the top buttons and beside the chapter title, colour-coded by finger. The typing box fits
  its text (short chapters don't leave a big empty box) and grows up to the window height for long ones. The key and finger for the next character light up, and a
  caption names the finger; capitals and symbols also light up `Shift` and say to hold it with the
  _opposite_ pinky. It follows standard touch-typing for a US QWERTY keyboard; characters without a
  standard fingering (accents, other alphabets) just show a note. Edit `KEYS_BY_FINGER` in
  `hand-guide.js` to change the mapping. It also shows in focus mode.
- The clock starts on your first keystroke and **pauses after 5 seconds without typing** (a "paused"
  note appears and time/WPM freeze); the next keystroke or Backspace resumes it.
- The timer starts on your first keystroke. Mistakes turn red; use Backspace to fix them.
- A chapter finishes when you reach the end with no uncorrected mistakes.
- **Your place is remembered.** What you've typed (mistakes included), time and accuracy so far are
  autosaved to the database a moment after each keystroke, and when you switch tabs or leave the page.
  Reopening the chapter picks up where you stopped; the book page shows an _in progress_ badge and a
  _Continue_ button. Time away from the page isn't counted. Progress is cleared when you finish,
  restart (`Esc` asks first), or edit the chapter's text.
- `Esc` restarts. Results (WPM, accuracy, time) are saved and shown on the _Stats_ page.
- **Focus mode** (_Focus mode_ button or `Ctrl+Shift+F`) hides the header, title and stats, leaving a
  large text box, a thin progress bar and a faded Pomodoro timer (hover to use it). It also asks the browser
  for fullscreen; `Esc` leaves fullscreen and focus mode. The layout is remembered, so the next chapter
  opens in focus mode too (without fullscreen, which browsers only allow after a click or key press).
  Use _Exit focus_ at the bottom right or `Ctrl+Shift+F` to leave. Use A−/A+ for text size.
  The bottom-left line always shows your progress (percent and characters); the _Stats_ button there
  adds live WPM, accuracy and time (off by default, remembered).
- WPM is net: (correct characters / 5) per minute.

## Library shortcut

The top of the library page shows a card for the chapter you were in the middle of
(_Continue where you left off_), or, if nothing is in progress, the chapter after the last one you
finished (_Up next_).

## Pomodoro timer

The timer in the header works on every page.

- Phases: focus (25 min), short break (5), and a long break (15) after every 4 completed focus
  sessions. The ⚙ button changes the durations, the sound/desktop notification, and an option to start
  the focus timer automatically when you start typing.
- It keeps running while you move between pages or tabs (state and settings live in the browser's
  `localStorage`, so they're per browser). If the timer ran out while no page was open for more than
  5 minutes, that session is treated as abandoned and isn't counted.
- When a phase ends you get a banner (plus optional sound/notification). The next phase waits for you
  to press start.
- Skipping a focus session (⏭) doesn't count it. Completed focus sessions are saved on the server and
  summarised on the _Stats_ page; the 🍅 counter shows today's total.

## Tests

```sh
.venv/bin/python manage.py test      # Django tests
node --test tests_js/                # Pomodoro timer and finger-guide logic
```

With Docker (what’s running now)
Do this
Command
Start it
docker compose up -d
Stop it (data is kept)
docker compose down
See logs
docker compose logs -f web
Check status
docker compose ps
Rebuild after changing code
docker compose up -d --build

nc -tv 127.0.0.1 8765
