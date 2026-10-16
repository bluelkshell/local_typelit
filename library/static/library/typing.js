(function () {
    "use strict";

    const text = JSON.parse(document.getElementById("typing-text").textContent);
    const saved = JSON.parse(
        document.getElementById("saved-progress").textContent,
    );
    const box = document.getElementById("typing");
    const capture = document.getElementById("capture");
    const wpmEl = document.getElementById("wpm");
    const accEl = document.getElementById("acc");
    const timeEl = document.getElementById("time");
    const bar = document.getElementById("bar");
    const resultBox = document.getElementById("result");
    const resultSummary = document.getElementById("result-summary");
    const resumeNote = document.getElementById("resume-note");
    const idleNote = document.getElementById("idle-note");
    const focusProgress = document.getElementById("focus-progress");

    // After this long without a keystroke the clock stops until you type again.
    const IDLE_MS = 5000;
    const SAVE_DELAY_MS = 1500;
    const CONFIRM_RESTART_AFTER = 20; // characters typed

    // Use Array.from so characters outside the BMP count as one character.
    const chars = Array.from(text);
    const total = chars.length;
    let spans = [];

    // state[i]: 0 = untyped, 1 = correct, 2 = wrong
    let state, typed, mistakes, keystrokes, errors;
    // Only time spent actively typing counts: `banked` holds finished segments,
    // `segmentStart` is set while a segment is running, and a running segment
    // never extends more than IDLE_MS past `lastKeyAt`.
    let banked, segmentStart, lastKeyAt, idle, ticker, saveTimer, finished;
    // Whether the focus-mode footer also shows live WPM/accuracy/time.
    let showFocusStats = false;

    const idx = () => typed.length;

    // A single element that glides to the current character. It lives inside
    // the scrolling box, so it scrolls along with the text.
    const caret = document.createElement("div");
    caret.className = "caret";
    caret.setAttribute("aria-hidden", "true");
    let caretTop = -1;

    function build() {
        box.textContent = "";
        spans = chars.map((ch) => {
            const s = document.createElement("span");
            s.textContent = ch;
            box.appendChild(s);
            return s;
        });
        box.appendChild(caret);
    }

    function clearState() {
        clearInterval(ticker);
        clearTimeout(saveTimer);
        state = new Array(total).fill(0);
        typed = [];
        mistakes = 0;
        keystrokes = 0;
        errors = 0;
        banked = 0;
        segmentStart = null;
        lastKeyAt = 0;
        idle = false;
        ticker = null;
        saveTimer = null;
        finished = false;
        spans.forEach((s) => (s.className = ""));
        caretTop = -1;
        resultBox.hidden = true;
        resumeNote.hidden = true;
        capture.disabled = false;
    }

    function restore(progress) {
        const previous = Array.from(progress.typed || "");
        if (!previous.length || previous.length > total) return false;
        previous.forEach((ch, i) => {
            const ok = ch === chars[i];
            state[i] = ok ? 1 : 2;
            spans[i].className = ok ? "correct" : "wrong";
            if (!ok) mistakes++;
        });
        typed = previous;
        keystrokes = progress.keystrokes || previous.length;
        errors = progress.errors || 0;
        banked = progress.elapsed || 0;
        resumeNote.textContent =
            "Resumed where you left off (" +
            progress.percent +
            "%). Press Esc to start over.";
        resumeNote.hidden = false;
        return true;
    }

    function elapsedSeconds() {
        if (!segmentStart) return banked;
        const end = Math.min(performance.now(), lastKeyAt + IDLE_MS);
        return banked + Math.max(0, end - segmentStart) / 1000;
    }

    function currentWpm(seconds) {
        if (!idx() || seconds <= 0) return 0;
        const minutes = Math.max(seconds, 1) / 60;
        return Math.max(0, (idx() - mistakes) / 5 / minutes);
    }

    function currentAccuracy() {
        if (!keystrokes) return 100;
        return Math.max(0, ((keystrokes - errors) / keystrokes) * 100);
    }

    function render() {
        const seconds = elapsedSeconds();
        wpmEl.textContent = Math.round(currentWpm(seconds));
        accEl.textContent = Math.round(currentAccuracy());
        timeEl.textContent = Math.floor(seconds);
        idleNote.hidden = !idle || finished;
        const percent = total ? (idx() / total) * 100 : 0;
        bar.style.width = percent + "%";
        const parts = [
            Math.floor(percent) + "%",
            idx().toLocaleString() +
                " / " +
                total.toLocaleString() +
                " characters",
        ];
        if (showFocusStats) {
            parts.push(
                wpmEl.textContent + " WPM",
                accEl.textContent + "% accuracy",
                timeEl.textContent + "s",
            );
            if (idle && !finished) parts.push("paused");
        }
        focusProgress.textContent = parts.join(" \u00b7 ");
    }

    // Stats text changes on every keystroke; batch them to one update per frame
    // so reading layout for the caret doesn't force extra work.
    let renderQueued = false;
    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            render();
        });
    }

    // Move the caret to the current character and keep that line about a third
    // of the way down the box. `instant` skips the animations (used after a
    // restart, resize, or text-size change, when the layout itself changed).
    function markCurrent(instant) {
        caret.classList.toggle("waiting", !segmentStart && !finished);
        if (window.HandGuide) {
            window.HandGuide.setNext(idx() < total ? chars[idx()] : null);
        }
        if (idx() >= total) {
            caret.hidden = true;
            return;
        }
        const cur = spans[idx()];
        const top = cur.offsetTop;
        // The caret sweeping back across the text on a line wrap looks wrong:
        // jump there instead of gliding.
        const jump = instant || top !== caretTop;
        if (jump) caret.classList.add("no-anim");
        caret.hidden = false;
        caret.style.height = cur.offsetHeight + "px";
        caret.style.transform =
            "translate(" + cur.offsetLeft + "px, " + top + "px)";
        if (jump) {
            void caret.offsetWidth; // apply the jump before re-enabling the glide
            requestAnimationFrame(() => caret.classList.remove("no-anim"));
        }
        caretTop = top;

        scrollTo(Math.max(0, top - box.clientHeight / 3), instant);
    }

    // Ease the box towards the target scroll position over a few frames. Done in
    // JS rather than CSS `scroll-behavior` so it behaves the same in every browser.
    const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
    ).matches;
    let scrollTarget = 0;
    let scrollFrame = null;

    function scrollStep() {
        const diff = scrollTarget - box.scrollTop;
        // Move a fraction of the remaining distance, but at least 1px.
        const step = Math.max(1, Math.abs(diff) * 0.22);
        if (Math.abs(diff) <= step) {
            box.scrollTop = scrollTarget;
            scrollFrame = null;
            return;
        }
        box.scrollTop += Math.sign(diff) * step;
        scrollFrame = requestAnimationFrame(scrollStep);
    }

    function scrollTo(target, instant) {
        scrollTarget = target;
        if (instant || reduceMotion) {
            if (scrollFrame) cancelAnimationFrame(scrollFrame);
            scrollFrame = null;
            box.scrollTop = target;
        } else if (!scrollFrame && Math.abs(box.scrollTop - target) > 1) {
            scrollFrame = requestAnimationFrame(scrollStep);
        }
    }

    // Called on every keystroke: records activity and (re)starts the clock.
    function touch() {
        lastKeyAt = performance.now();
        if (segmentStart) return;
        segmentStart = lastKeyAt;
        idle = false;
        ticker = setInterval(() => {
            if (performance.now() - lastKeyAt > IDLE_MS) {
                pauseTimer();
                sendProgress(false); // store the frozen time
            }
            render();
        }, 250);
    }

    function pauseTimer() {
        if (!segmentStart) return;
        banked = elapsedSeconds();
        segmentStart = null;
        idle = true;
        caret.classList.add("waiting");
        clearInterval(ticker);
        ticker = null;
    }

    // --- saving progress -----------------------------------------------------

    function postJson(url, payload, keepalive) {
        return fetch(url, {
            method: "POST",
            keepalive: !!keepalive,
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": window.TYPELIT.csrfToken,
            },
            body: JSON.stringify(payload),
        });
    }

    function sendProgress(keepalive) {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (finished) return;
        postJson(
            window.TYPELIT.progressUrl,
            {
                typed: typed.join(""),
                elapsed: elapsedSeconds(),
                keystrokes: keystrokes,
                errors: errors,
            },
            keepalive,
        ).catch(() => {});
    }

    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => sendProgress(false), SAVE_DELAY_MS);
    }

    function flushAndPause() {
        if (!idx() || finished) return;
        pauseTimer();
        sendProgress(true);
    }

    // --- typing --------------------------------------------------------------

    function typeChar(ch) {
        if (finished || idx() >= total) return;
        touch();
        if (window.Pomodoro) window.Pomodoro.autoStart();
        keystrokes++;
        const i = idx();
        const ok = ch === chars[i];
        if (!ok) {
            errors++;
            mistakes++;
        }
        state[i] = ok ? 1 : 2;
        spans[i].className = ok ? "correct" : "wrong";
        typed.push(ch);
        resumeNote.hidden = true;
        markCurrent();
        scheduleRender();
        if (idx() === total && mistakes === 0) finish();
        else scheduleSave();
    }

    function backspace() {
        if (finished || idx() === 0) return;
        touch();
        const i = idx() - 1;
        if (state[i] === 2) mistakes--;
        state[i] = 0;
        spans[i].className = "";
        typed.pop();
        markCurrent();
        scheduleRender();
        scheduleSave();
    }

    function finish() {
        finished = true;
        clearTimeout(saveTimer);
        pauseTimer();
        const seconds = Math.max(elapsedSeconds(), 0.5);
        const wpm = currentWpm(seconds);
        const accuracy = currentAccuracy();
        render();
        capture.disabled = true;
        resultSummary.textContent =
            Math.round(wpm) +
            " WPM, " +
            accuracy.toFixed(1) +
            "% accuracy, " +
            seconds.toFixed(1) +
            " seconds.";
        resultBox.hidden = false;

        // The server also clears the saved progress for this chapter.
        postJson(window.TYPELIT.resultUrl, {
            wpm: wpm,
            accuracy: accuracy,
            seconds: seconds,
        })
            .then((r) => r.json())
            .then((data) => {
                if (data.new_best)
                    resultSummary.textContent += " New personal best!";
            })
            .catch(() => {
                resultSummary.textContent += " (Could not save this result.)";
            });
    }

    function restart() {
        if (
            !finished &&
            idx() > CONFIRM_RESTART_AFTER &&
            !window.confirm(
                "Start over? Your saved progress for this chapter will be discarded.",
            )
        ) {
            capture.focus();
            return;
        }
        const hadProgress = idx() > 0 && !finished;
        clearState();
        if (hadProgress) {
            postJson(
                window.TYPELIT.progressUrl,
                { typed: "", elapsed: 0, keystrokes: 0, errors: 0 },
                true,
            ).catch(() => {});
        }
        render();
        markCurrent(true);
        capture.focus();
    }

    function handleText(str) {
        for (const ch of Array.from(str)) {
            if (ch === "\n" || ch === "\r") continue;
            typeChar(ch);
        }
    }

    // Typing goes through a hidden textarea so dead keys, accents, IMEs and
    // mobile keyboards all work (not just raw key codes).
    let composing = false;
    capture.addEventListener("compositionstart", () => (composing = true));
    capture.addEventListener("compositionend", (e) => {
        composing = false;
        capture.value = "";
        handleText(e.data || "");
    });
    capture.addEventListener("input", (e) => {
        if (composing || e.isComposing) return;
        const value = capture.value;
        capture.value = "";
        if (e.inputType && e.inputType.startsWith("delete")) return;
        handleText(value);
    });
    capture.addEventListener("keydown", (e) => {
        if (e.key === "Backspace") {
            e.preventDefault();
            backspace();
        }
    });

    // Text size (remembered in this browser).
    const SIZE_KEY = "typelit.typingSize";
    const SIZE_MIN = 1.2;
    const SIZE_MAX = 3.4;
    const SIZE_STEP = 0.2;
    function storedValue(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }
    let textSize = parseFloat(storedValue(SIZE_KEY));
    if (!Number.isFinite(textSize)) textSize = 1.9;

    function applyTextSize(size) {
        textSize = Math.min(SIZE_MAX, Math.max(SIZE_MIN, size));
        box.style.setProperty("--typing-size", textSize.toFixed(1) + "rem");
        try {
            localStorage.setItem(SIZE_KEY, String(textSize));
        } catch (e) {
            /* storage unavailable: the size just isn't remembered */
        }
        markCurrent(true);
    }

    document.querySelectorAll("[data-font]").forEach((btn) => {
        const delta = btn.dataset.font === "up" ? SIZE_STEP : -SIZE_STEP;
        btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep typing focus
        btn.addEventListener("click", () => applyTextSize(textSize + delta));
    });

    // Focus mode: hides everything but the text (see .focus-mode in style.css).
    // The layout is remembered; real browser fullscreen is requested only when
    // you switch it on, since browsers require a click or key press for that.
    const FOCUS_KEY = "typelit.focusMode";
    let usedFullscreen = false;

    function inFocusMode() {
        return document.body.classList.contains("focus-mode");
    }

    function setFocusMode(on, withFullscreen) {
        document.body.classList.toggle("focus-mode", on);
        try {
            localStorage.setItem(FOCUS_KEY, on ? "1" : "0");
        } catch (e) {
            /* not remembered */
        }
        if (
            on &&
            withFullscreen &&
            document.documentElement.requestFullscreen
        ) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else if (!on && document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
        markCurrent(true);
        if (!capture.disabled) capture.focus();
    }

    const STATS_KEY = "typelit.focusStats";
    function setFocusStats(on, rerender) {
        showFocusStats = on;
        try {
            localStorage.setItem(STATS_KEY, on ? "1" : "0");
        } catch (e) {
            /* not remembered */
        }
        document.querySelectorAll("[data-stats-toggle]").forEach((btn) => {
            btn.setAttribute("aria-pressed", String(on));
            btn.classList.toggle("active", on);
        });
        if (rerender) render();
    }
    document.querySelectorAll("[data-stats-toggle]").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", () =>
            setFocusStats(!showFocusStats, true),
        );
    });
    // The first render happens at the end of this file, once state exists.
    setFocusStats(storedValue(STATS_KEY) === "1", false);

    document.querySelectorAll("[data-focus-toggle]").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", () => setFocusMode(!inFocusMode(), true));
    });

    // Leaving fullscreen (e.g. with Esc) also leaves focus mode.
    document.addEventListener("fullscreenchange", () => {
        if (document.fullscreenElement) {
            usedFullscreen = true;
        } else if (usedFullscreen) {
            usedFullscreen = false;
            if (inFocusMode()) setFocusMode(false, false);
        }
    });
    window.addEventListener("resize", () => markCurrent(true));

    box.addEventListener("click", () => capture.focus());
    document.getElementById("restart").addEventListener("click", restart);
    document.getElementById("again").addEventListener("click", restart);
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
            e.preventDefault();
            setFocusMode(!inFocusMode(), true);
            return;
        }
        if (e.key !== "Escape") return;
        const tag = e.target.tagName;
        // Esc inside another form field (e.g. the timer settings) isn't a restart.
        if (tag === "INPUT" || (tag === "TEXTAREA" && e.target !== capture))
            return;
        e.preventDefault();
        restart();
    });

    // Save when leaving the page or switching tabs, and don't count time away.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushAndPause();
    });
    window.addEventListener("pagehide", flushAndPause);

    build();
    clearState();
    if (saved) restore(saved);
    applyTextSize(textSize);
    render();
    markCurrent(true);
    capture.focus();
})();
