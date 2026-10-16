(function () {
    "use strict";

    // -------------------------------------------------------------------------
    // Core: which finger types which key (standard touch typing, US QWERTY).
    // Pure functions, also loaded by tests_js/hand-guide.test.js.
    // -------------------------------------------------------------------------

    // Finger ids: l/r = hand, then p(inky) r(ing) m(iddle) i(ndex) t(humb).
    const KEYS_BY_FINGER = {
        lp: "`1qaz",
        lr: "2wsx",
        lm: "3edc",
        li: "45rtfgvb",
        ri: "67yuhjnm",
        rm: "8ik,",
        rr: "9ol.",
        rp: "0p;/-=[]\\'",
    };

    const FINGER_OF = {};
    Object.keys(KEYS_BY_FINGER).forEach((finger) => {
        for (const key of KEYS_BY_FINGER[finger]) FINGER_OF[key] = finger;
    });

    const SHIFTED = {
        "~": "`",
        "!": "1",
        "@": "2",
        "#": "3",
        $: "4",
        "%": "5",
        "^": "6",
        "&": "7",
        "*": "8",
        "(": "9",
        ")": "0",
        _: "-",
        "+": "=",
        "{": "[",
        "}": "]",
        "|": "\\",
        ":": ";",
        '"': "'",
        "<": ",",
        ">": ".",
        "?": "/",
    };

    const FINGER_NAMES = {
        lp: "left pinky",
        lr: "left ring finger",
        lm: "left middle finger",
        li: "left index finger",
        lt: "left thumb",
        rt: "right thumb",
        ri: "right index finger",
        rm: "right middle finger",
        rr: "right ring finger",
        rp: "right pinky",
    };

    // The finger's kind, used for colouring: "pinky", "ring", ...
    const KIND = { p: "pinky", r: "ring", m: "middle", i: "index", t: "thumb" };
    const kindOf = (finger) => KIND[finger[1]];

    // Returns how to type `ch`, or null if there's no standard fingering for it
    // (accented letters, other layouts, ...).
    //   { key, fingers: [...], shift: bool, shiftKey: "shift-l"|"shift-r"|null }
    // For shifted characters the second finger is the pinky of the *other* hand.
    function lookup(ch) {
        if (ch === " ") {
            return {
                key: " ",
                fingers: ["lt", "rt"],
                shift: false,
                shiftKey: null,
            };
        }
        let base = ch;
        let shift = false;
        if (Object.prototype.hasOwnProperty.call(SHIFTED, ch)) {
            base = SHIFTED[ch];
            shift = true;
        } else if (/^[A-Z]$/.test(ch)) {
            base = ch.toLowerCase();
            shift = true;
        }
        const finger = FINGER_OF[base];
        if (!finger) return null;
        if (!shift)
            return {
                key: base,
                fingers: [finger],
                shift: false,
                shiftKey: null,
            };
        const leftHand = finger[0] === "l";
        return {
            key: base,
            fingers: [finger, leftHand ? "rp" : "lp"],
            shift: true,
            shiftKey: leftHand ? "shift-r" : "shift-l",
        };
    }

    function describe(ch) {
        if (ch === null || ch === undefined) return "";
        const label = ch === " " ? "Space" : "\u201c" + ch + "\u201d";
        const info = lookup(ch);
        if (!info) return label + " \u2014 no standard fingering";
        if (ch === " ") return label + " \u2014 either thumb";
        let text = label + " \u2014 " + FINGER_NAMES[info.fingers[0]];
        if (info.shift)
            text += ", hold Shift with your " + FINGER_NAMES[info.fingers[1]];
        return text;
    }

    const core = { lookup, describe, FINGER_NAMES, kindOf, KEYS_BY_FINGER };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = core;
    }
    if (typeof document === "undefined") return;

    // -------------------------------------------------------------------------
    // UI: two hands and a small keyboard under the typing box.
    // -------------------------------------------------------------------------

    const container = document.getElementById("hand-guide");
    if (!container) return;

    const SVG_NS = "http://www.w3.org/2000/svg";
    function svgEl(name, attrs, parent) {
        const el = document.createElementNS(SVG_NS, name);
        Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
        if (parent) parent.appendChild(el);
        return el;
    }

    // Finger shapes for a left hand seen from above (pinky on the left). The
    // right hand is the same drawing mirrored.
    const FINGER_SHAPES = [
        ["p", 14, 42, 24, 40],
        ["r", 42, 28, 24, 54],
        ["m", 70, 22, 24, 60],
        ["i", 98, 28, 24, 54],
    ];

    const fingerEls = {};

    function buildHand(side) {
        const svg = svgEl("svg", {
            viewBox: "0 0 160 130",
            class: "hand",
            "aria-hidden": "true",
        });
        const g = svgEl(
            "g",
            side === "r" ? { transform: "translate(160,0) scale(-1,1)" } : {},
            svg,
        );
        const add = (code, attrs) => {
            const id = side + code;
            const el = svgEl(
                "rect",
                Object.assign(
                    { rx: 11, class: "finger", "data-f": kindOf(id) },
                    attrs,
                ),
                g,
            );
            fingerEls[id] = el;
        };
        FINGER_SHAPES.forEach(([code, x, y, w, h]) =>
            add(code, { x: x, y: y, width: w, height: h }),
        );
        svgEl(
            "rect",
            { x: 14, y: 70, width: 108, height: 56, rx: 18, class: "palm" },
            g,
        );
        add("t", {
            x: 116,
            y: 68,
            width: 22,
            height: 44,
            transform: "rotate(20 127 110)",
        });
        return svg;
    }

    const keyEls = {};
    // [row offset in key units, keys]; shift/space entries carry their widths.
    const ROW_SPECS = [
        { offset: 0, keys: "`1234567890-=" },
        { offset: 1.5, keys: "qwertyuiop[]\\" },
        { offset: 1.75, keys: "asdfghjkl;'" },
        { offset: 0, keys: "zxcvbnm,./", shiftL: 2.25, shiftR: 2.75 },
        { offset: 3.75, keys: " ", spaceWidth: 6.25 },
    ];

    function buildKey(row, id, label, width, finger) {
        const el = document.createElement("span");
        el.className = "key";
        el.style.setProperty("--w", width);
        el.textContent = label;
        if (finger) el.dataset.f = kindOf(finger);
        else el.classList.add("key-shift");
        row.appendChild(el);
        keyEls[id] = el;
    }

    function buildKeyboard() {
        const kb = document.createElement("div");
        kb.className = "keyboard";
        ROW_SPECS.forEach((spec) => {
            const row = document.createElement("div");
            row.className = "key-row";
            row.style.setProperty("--offset", spec.offset);
            if (spec.shiftL)
                buildKey(row, "shift-l", "Shift", spec.shiftL, null);
            for (const ch of spec.keys) {
                if (ch === " ") {
                    buildKey(row, " ", "", spec.spaceWidth, "rt");
                } else {
                    buildKey(row, ch, ch.toUpperCase(), 1, FINGER_OF[ch]);
                }
            }
            if (spec.shiftR)
                buildKey(row, "shift-r", "Shift", spec.shiftR, null);
            kb.appendChild(row);
        });
        return kb;
    }

    const caption = document.createElement("div");
    caption.className = "guide-caption";

    const main = document.createElement("div");
    main.className = "guide-main";
    main.appendChild(buildHand("l"));
    main.appendChild(buildKeyboard());
    main.appendChild(buildHand("r"));
    container.appendChild(main);
    container.appendChild(caption);

    let lit = [];
    function setNext(ch) {
        lit.forEach((el) => el.classList.remove("next", "active"));
        lit = [];
        caption.textContent = describe(ch);
        const info = ch === null || ch === undefined ? null : lookup(ch);
        if (!info) return;
        const mark = (el, cls) => {
            if (!el) return;
            el.classList.add(cls);
            lit.push(el);
        };
        mark(keyEls[info.key], "next");
        if (info.shiftKey) mark(keyEls[info.shiftKey], "next");
        info.fingers.forEach((f) => mark(fingerEls[f], "active"));
    }

    // --- show / hide ---------------------------------------------------------

    const KEY = "typelit.handGuide";
    function stored() {
        try {
            return localStorage.getItem(KEY);
        } catch (e) {
            return null;
        }
    }

    function show(on) {
        document.body.classList.toggle("guide-on", on);
        try {
            localStorage.setItem(KEY, on ? "1" : "0");
        } catch (e) {
            /* not remembered */
        }
        document.querySelectorAll("[data-guide-toggle]").forEach((btn) => {
            btn.setAttribute("aria-pressed", String(on));
            btn.classList.toggle("active", on);
        });
        // The typing box changes height; let it re-measure the caret.
        window.dispatchEvent(new Event("resize"));
    }

    document.querySelectorAll("[data-guide-toggle]").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep typing focus
        btn.addEventListener("click", () =>
            show(!document.body.classList.contains("guide-on")),
        );
    });

    // On by default; the template's inline script has already set the class.
    show(stored() !== "0");

    window.HandGuide = { setNext: setNext, show: show };
})();
