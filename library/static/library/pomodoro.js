(function () {
    "use strict";

    // ---------------------------------------------------------------------------
    // Core: pure state machine (no DOM), also loaded by tests_js/pomodoro.test.js
    // ---------------------------------------------------------------------------

    const DEFAULTS = {
        focus: 25,
        short: 5,
        long: 15,
        longEvery: 4,
        sound: true,
        notify: false,
        autoStart: false,
    };

    function clamp(value, min, max, fallback) {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    const core = {
        DEFAULTS: DEFAULTS,

        sanitizeSettings(raw) {
            raw = raw || {};
            return {
                focus: clamp(raw.focus, 1, 180, DEFAULTS.focus),
                short: clamp(raw.short, 1, 60, DEFAULTS.short),
                long: clamp(raw.long, 1, 120, DEFAULTS.long),
                longEvery: clamp(raw.longEvery, 2, 12, DEFAULTS.longEvery),
                sound: raw.sound !== false,
                notify: raw.notify === true,
                autoStart: raw.autoStart === true,
            };
        },

        phaseMs(settings, phase) {
            return settings[phase] * 60000;
        },

        // `cycle` = focus sessions completed since the last long break.
        initialState(settings, phase, cycle) {
            phase = phase || "focus";
            const total = core.phaseMs(settings, phase);
            return {
                phase: phase,
                cycle: cycle || 0,
                running: false,
                endsAt: 0,
                remaining: total,
                total: total,
            };
        },

        remaining(state, now) {
            return state.running
                ? Math.max(0, state.endsAt - now)
                : state.remaining;
        },

        start(state, now) {
            if (state.running) return state;
            return Object.assign({}, state, {
                running: true,
                endsAt: now + state.remaining,
            });
        },

        pause(state, now) {
            if (!state.running) return state;
            return Object.assign({}, state, {
                running: false,
                endsAt: 0,
                remaining: core.remaining(state, now),
            });
        },

        isExpired(state, now) {
            return state.running && now >= state.endsAt;
        },

        // Move on to the next phase (paused). `completed` is false when skipping:
        // a skipped focus session doesn't count towards the long break.
        advance(state, settings, completed) {
            let next;
            let cycle = state.cycle;
            if (state.phase === "focus") {
                if (completed) cycle += 1;
                if (completed && cycle >= settings.longEvery) {
                    next = "long";
                    cycle = 0;
                } else {
                    next = "short";
                }
            } else {
                next = "focus";
            }
            return core.initialState(settings, next, cycle);
        },

        // Apply changed durations to a phase that hasn't been touched yet.
        applySettings(state, settings) {
            if (!state.running && state.remaining === state.total) {
                return core.initialState(settings, state.phase, state.cycle);
            }
            return state;
        },

        formatTime(ms) {
            const totalSeconds = Math.ceil(ms / 1000);
            const m = Math.floor(totalSeconds / 60);
            const s = totalSeconds % 60;
            return (
                String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
            );
        },
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = core;
    }
    if (typeof document === "undefined") return;

    // ---------------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------------

    const root = document.getElementById("pomodoro");
    if (!root) return;

    const SETTINGS_KEY = "typelit.pomodoro.settings";
    const STATE_KEY = "typelit.pomodoro.state";
    // If the timer expired while no page was open for longer than this, assume the
    // session was abandoned: don't count it or alert about it.
    const STALE_MS = 5 * 60 * 1000;
    const LABELS = { focus: "Focus", short: "Short break", long: "Long break" };

    const els = {
        toggle: document.getElementById("pomo-toggle"),
        phase: document.getElementById("pomo-phase"),
        time: document.getElementById("pomo-time"),
        skip: document.getElementById("pomo-skip"),
        reset: document.getElementById("pomo-reset"),
        count: document.getElementById("pomo-count"),
        settingsBtn: document.getElementById("pomo-settings-btn"),
        settings: document.getElementById("pomo-settings"),
        settingsNote: document.getElementById("pomo-settings-note"),
        toast: document.getElementById("pomo-toast"),
        toastText: document.getElementById("pomo-toast-text"),
        toastAction: document.getElementById("pomo-toast-action"),
        toastClose: document.getElementById("pomo-toast-close"),
    };
    const baseTitle = document.title;

    function readJson(key) {
        try {
            return JSON.parse(localStorage.getItem(key));
        } catch (e) {
            return null;
        }
    }
    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            /* storage unavailable: the timer still works for this page */
        }
    }

    let settings = core.sanitizeSettings(readJson(SETTINGS_KEY));

    function loadState() {
        const stored = readJson(STATE_KEY);
        const valid =
            stored &&
            LABELS[stored.phase] &&
            typeof stored.running === "boolean" &&
            Number.isFinite(stored.remaining) &&
            Number.isFinite(stored.total) &&
            Number.isFinite(stored.endsAt);
        return valid ? stored : core.initialState(settings, "focus", 0);
    }

    let state = loadState();
    let seenDone = state.lastDone ? state.lastDone.at : 0;

    function saveState() {
        writeJson(STATE_KEY, state);
    }

    function localDate() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return (
            d.getFullYear() +
            "-" +
            pad(d.getMonth() + 1) +
            "-" +
            pad(d.getDate())
        );
    }

    // --- server --------------------------------------------------------------

    function showCount(n) {
        els.count.textContent = "\uD83C\uDF45 " + n;
    }

    function fetchToday() {
        fetch(root.dataset.todayUrl + "?date=" + localDate())
            .then((r) => r.json())
            .then((data) => {
                if (typeof data.today === "number") showCount(data.today);
            })
            .catch(() => {});
    }

    function postCompleted(finished) {
        fetch(root.dataset.completeUrl, {
            method: "POST",
            keepalive: true,
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": root.dataset.csrf,
            },
            body: JSON.stringify({
                key: finished.endsAt,
                minutes: Math.max(1, Math.round(finished.total / 60000)),
                date: localDate(),
            }),
        })
            .then((r) => r.json())
            .then((data) => {
                if (typeof data.today === "number") showCount(data.today);
            })
            .catch(() => {});
    }

    // --- alerts --------------------------------------------------------------

    let audioCtx = null;
    function beep() {
        try {
            audioCtx =
                audioCtx ||
                new (window.AudioContext || window.webkitAudioContext)();
            const t0 = audioCtx.currentTime;
            [0, 0.35, 0.7].forEach((offset) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = "sine";
                osc.frequency.value = 880;
                gain.gain.setValueAtTime(0.0001, t0 + offset);
                gain.gain.exponentialRampToValueAtTime(
                    0.25,
                    t0 + offset + 0.02,
                );
                gain.gain.exponentialRampToValueAtTime(
                    0.0001,
                    t0 + offset + 0.25,
                );
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(t0 + offset);
                osc.stop(t0 + offset + 0.3);
            });
        } catch (e) {
            /* audio blocked by the browser: the toast is still shown */
        }
    }

    function messageFor(finishedPhase) {
        return finishedPhase === "focus"
            ? "Focus session complete. Time for a break!"
            : "Break over. Ready to focus?";
    }

    function showToast(finishedPhase) {
        els.toastText.textContent = messageFor(finishedPhase);
        els.toastAction.textContent =
            state.phase === "focus" ? "Start focus" : "Start break";
        els.toast.hidden = false;
    }

    function hideToast() {
        els.toast.hidden = true;
    }

    function announce(finished) {
        showToast(finished.phase);
        if (settings.sound) beep();
        if (
            settings.notify &&
            "Notification" in window &&
            Notification.permission === "granted"
        ) {
            try {
                new Notification("Local TypeLit", {
                    body: messageFor(finished.phase),
                });
            } catch (e) {
                /* some browsers only allow notifications from service workers */
            }
        }
    }

    // --- rendering -----------------------------------------------------------

    function render() {
        const left = core.remaining(state, Date.now());
        const label = LABELS[state.phase];
        const clock = core.formatTime(left);
        els.time.textContent = clock;
        els.phase.textContent = label;
        els.toggle.innerHTML = state.running ? "&#9208;" : "&#9654;";
        els.toggle.title = state.running ? "Pause" : "Start";
        root.dataset.phase = state.phase;
        root.classList.toggle("running", state.running);
        document.title = state.running
            ? clock + " " + label + " - " + baseTitle
            : baseTitle;
    }

    // --- transitions ---------------------------------------------------------

    function expire() {
        // Another tab may already have handled this: always re-read first.
        state = loadState();
        const now = Date.now();
        if (!core.isExpired(state, now)) {
            render();
            return;
        }
        const finished = state;
        if (now - finished.endsAt > STALE_MS) {
            state = core.initialState(settings, "focus", finished.cycle);
            saveState();
            render();
            return;
        }
        state = core.advance(finished, settings, true);
        state.lastDone = { phase: finished.phase, at: finished.endsAt };
        seenDone = finished.endsAt;
        saveState();
        render();
        announce(finished);
        if (finished.phase === "focus") postCompleted(finished);
    }

    function start() {
        if (state.running) return;
        state = core.start(state, Date.now());
        saveState();
        hideToast();
        render();
    }

    function pause() {
        state = core.pause(state, Date.now());
        saveState();
        render();
    }

    function toggle() {
        if (state.running) pause();
        else start();
    }

    function skip() {
        state = core.advance(state, settings, false);
        saveState();
        hideToast();
        render();
    }

    function resetPhase() {
        state = core.initialState(settings, state.phase, state.cycle);
        saveState();
        hideToast();
        render();
    }

    // Called by the typing page on each keystroke.
    function autoStart() {
        if (settings.autoStart && state.phase === "focus" && !state.running)
            start();
    }

    // --- settings panel ------------------------------------------------------

    function fillSettingsForm() {
        for (const el of els.settings.elements) {
            if (!el.name) continue;
            if (el.type === "checkbox") el.checked = !!settings[el.name];
            else el.value = settings[el.name];
        }
    }

    function readSettingsForm() {
        const raw = {};
        for (const el of els.settings.elements) {
            if (!el.name) continue;
            raw[el.name] = el.type === "checkbox" ? el.checked : el.value;
        }
        return raw;
    }

    function onSettingsChange(event) {
        const raw = readSettingsForm();
        els.settingsNote.textContent = "";

        if (event.target.name === "notify" && raw.notify) {
            if (!("Notification" in window)) {
                raw.notify = false;
                els.settingsNote.textContent =
                    "This browser doesn't support notifications.";
            } else if (Notification.permission === "default") {
                Notification.requestPermission().then((perm) => {
                    if (perm !== "granted") {
                        settings.notify = false;
                        writeJson(SETTINGS_KEY, settings);
                        fillSettingsForm();
                        els.settingsNote.textContent =
                            "Notifications were blocked in the browser.";
                    }
                });
            } else if (Notification.permission === "denied") {
                raw.notify = false;
                els.settingsNote.textContent =
                    "Notifications are blocked for this site.";
            }
        }

        settings = core.sanitizeSettings(raw);
        writeJson(SETTINGS_KEY, settings);
        state = core.applySettings(state, settings);
        saveState();
        render();
        // Number inputs are re-filled on "change" only, so typing isn't interrupted.
        if (event.type === "change") fillSettingsForm();
    }

    // --- wiring --------------------------------------------------------------

    // Keep keyboard focus where it is (e.g. the typing box) when clicking buttons.
    [root, els.toast].forEach((el) =>
        el.addEventListener("mousedown", (e) => {
            if (e.target.closest("button")) e.preventDefault();
        }),
    );
    els.toggle.addEventListener("click", toggle);
    els.skip.addEventListener("click", skip);
    els.reset.addEventListener("click", resetPhase);
    els.toastAction.addEventListener("click", start);
    els.toastClose.addEventListener("click", hideToast);
    els.settingsBtn.addEventListener("click", () => {
        const open = els.settings.hidden;
        els.settings.hidden = !open;
        els.settingsBtn.setAttribute("aria-expanded", String(open));
        if (open) fillSettingsForm();
    });
    els.settings.addEventListener("input", onSettingsChange);
    els.settings.addEventListener("change", onSettingsChange);
    els.settings.addEventListener("submit", (e) => e.preventDefault());
    document.addEventListener("click", (e) => {
        if (!els.settings.hidden && !root.contains(e.target)) {
            els.settings.hidden = true;
            els.settingsBtn.setAttribute("aria-expanded", "false");
        }
    });

    // Keep several open tabs in sync.
    window.addEventListener("storage", (e) => {
        if (e.key === SETTINGS_KEY) {
            settings = core.sanitizeSettings(readJson(SETTINGS_KEY));
        } else if (e.key === STATE_KEY) {
            state = loadState();
            if (state.lastDone && state.lastDone.at !== seenDone) {
                seenDone = state.lastDone.at; // another tab already beeped; just show the toast
                showToast(state.lastDone.phase);
            }
            render();
        }
    });

    setInterval(() => {
        if (state.running) {
            if (Date.now() >= state.endsAt) expire();
            else render();
        }
    }, 250);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            state = loadState();
            if (core.isExpired(state, Date.now())) expire();
            else render();
        }
    });

    window.Pomodoro = { autoStart: autoStart, start: start, pause: pause };

    if (core.isExpired(state, Date.now())) expire();
    render();
    fetchToday();
})();
