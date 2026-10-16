import { ItemView, Modal, Setting } from "obsidian";
import type { App, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { TypingEngine } from "./engine.ts";
import type LocalTypeLitPlugin from "./main.ts";
import { bestWpm } from "./storage.ts";
import type { RunResult } from "./storage.ts";
import { hashText } from "./text.ts";

export const VIEW_TYPE = "local-typelit-view";

/** A piece of text to type, plus how to find it again after a restart. */
export interface Source {
    kind: "file" | "selection";
    /** Identifies this text for saved progress and history. */
    key: string;
    title: string;
    /** Ready to type: already cleaned and normalised. */
    text: string;
    path?: string;
    /** The original selection (files are re-read from the vault instead). */
    raw?: string;
}

/** Did this workspace state describe a text (as opposed to a blank new tab)? */
function isSavedSource(state: unknown): boolean {
    return (
        typeof state === "object" &&
        state !== null &&
        ("path" in state || "raw" in state)
    );
}

const SAVE_DELAY_MS = 1500;
const CONFIRM_RESTART_AFTER = 20; // characters typed
const SIZE_STEP = 2;

class ConfirmModal extends Modal {
    message: string;
    onConfirm: () => void;

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    override onOpen(): void {
        this.contentEl.createEl("p", { text: this.message });
        new Setting(this.contentEl)
            .addButton((b) =>
                b
                    .setButtonText("Start over")
                    .setWarning()
                    .onClick(() => {
                        this.close();
                        this.onConfirm();
                    }),
            )
            .addButton((b) =>
                b.setButtonText("Keep typing").onClick(() => this.close()),
            );
    }

    override onClose(): void {
        this.contentEl.empty();
    }
}

export class TypingView extends ItemView {
    plugin: LocalTypeLitPlugin;
    source: Source | null = null;
    engine: TypingEngine | null = null;

    private spans: HTMLSpanElement[] = [];
    private caretTop = -1;
    private finished = false;
    private composing = false;
    private saveTimer: number | null = null;
    private renderQueued = false;
    private scrollTarget = 0;
    private scrollFrame: number | null = null;
    private textHash = "";
    private reduceMotion = false;
    private opened = false;

    private titleEl!: HTMLElement;
    private liveEl!: HTMLElement;
    private wpmEl!: HTMLElement;
    private accEl!: HTMLElement;
    private timeEl!: HTMLElement;
    private bestEl!: HTMLElement;
    private idleEl!: HTMLElement;
    private barEl!: HTMLElement;
    private noteEl!: HTMLElement;
    private boxEl!: HTMLElement;
    private caretEl!: HTMLElement;
    private captureEl!: HTMLTextAreaElement;
    private resultEl!: HTMLElement;
    private resultText!: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: LocalTypeLitPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    override getViewType(): string {
        return VIEW_TYPE;
    }

    override getDisplayText(): string {
        return this.source ? `Typing: ${this.source.title}` : "Typing practice";
    }

    override getIcon(): string {
        return "keyboard";
    }

    // --- persistence of the open tab across restarts --------------------------------

    override getState(): Record<string, unknown> {
        const s = this.source;
        if (!s) return {};
        return { kind: s.kind, path: s.path, title: s.title, raw: s.raw };
    }

    override async setState(
        state: unknown,
        result: ViewStateResult,
    ): Promise<void> {
        await super.setState(state, result);
        const source = await this.plugin.sourceFromState(state);
        if (source) {
            // setState can run before onOpen has built the page; onOpen loads this.source.
            if (this.opened) this.loadSource(source);
            else this.source = source;
        } else if (this.opened && isSavedSource(state)) {
            this.showMessage("This note could not be found.");
        }
    }

    // --- building the view -----------------------------------------------------------

    override async onOpen(): Promise<void> {
        this.reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
        ).matches;
        const root = this.contentEl;
        root.empty();
        root.addClass("typelit-root");

        const header = root.createDiv({ cls: "typelit-header" });
        this.titleEl = header.createDiv({ cls: "typelit-title" });
        const actions = header.createDiv({ cls: "typelit-actions" });
        this.button(actions, "A\u2212", "Smaller text", () =>
            this.changeSize(-SIZE_STEP),
        );
        this.button(actions, "A+", "Larger text", () =>
            this.changeSize(SIZE_STEP),
        );
        this.button(actions, "Restart", "Start over (Esc)", () =>
            this.restart(),
        );

        this.liveEl = root.createDiv({ cls: "typelit-live" });
        this.wpmEl = this.stat(this.liveEl, "WPM", "0");
        this.accEl = this.stat(this.liveEl, "% accuracy", "100");
        this.timeEl = this.stat(this.liveEl, "s", "0");
        this.idleEl = this.liveEl.createSpan({
            cls: "typelit-idle",
            text: "paused \u2014 type to continue",
        });
        this.bestEl = this.liveEl.createSpan({ cls: "typelit-best" });
        this.idleEl.hidden = true;

        root.createDiv({ cls: "typelit-progress" }).createDiv({
            cls: "typelit-bar",
        });
        this.barEl = root.querySelector<HTMLElement>(".typelit-bar")!;

        this.noteEl = root.createDiv({ cls: "typelit-note" });
        this.noteEl.hidden = true;

        this.boxEl = root.createDiv({ cls: "typelit-typing" });
        this.boxEl.setAttribute("tabindex", "-1");
        this.captureEl = root.createEl("textarea", { cls: "typelit-capture" });
        this.captureEl.setAttribute("aria-label", "Typing input");
        for (const attr of ["autocomplete", "autocorrect", "autocapitalize"]) {
            this.captureEl.setAttribute(attr, "off");
        }
        this.captureEl.spellcheck = false;

        this.resultEl = root.createDiv({ cls: "typelit-result" });
        this.resultEl.hidden = true;
        this.resultEl.createEl("h3", { text: "Finished!" });
        this.resultText = this.resultEl.createEl("p");
        const resultActions = this.resultEl.createDiv({
            cls: "typelit-actions",
        });
        this.button(resultActions, "Type again", "", () => this.reset(), true);
        this.button(resultActions, "Close", "", () => this.leaf.detach());

        // Typing goes through a hidden textarea so accents, dead keys and IMEs work.
        this.registerDomEvent(
            this.captureEl,
            "compositionstart",
            () => (this.composing = true),
        );
        this.registerDomEvent(
            this.captureEl,
            "compositionend",
            (e: CompositionEvent) => {
                this.composing = false;
                this.captureEl.value = "";
                this.handleText(e.data || "");
            },
        );
        this.registerDomEvent(this.captureEl, "input", (e: Event) => {
            const ev = e as InputEvent;
            if (this.composing || ev.isComposing) return;
            const value = this.captureEl.value;
            this.captureEl.value = "";
            if (ev.inputType && ev.inputType.startsWith("delete")) return;
            this.handleText(value);
        });
        this.registerDomEvent(this.captureEl, "keydown", (e: KeyboardEvent) => {
            if (e.key === "Backspace") {
                e.preventDefault();
                e.stopPropagation();
                this.backspace();
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                this.restart();
            }
        });
        this.registerDomEvent(this.boxEl, "click", () => this.focusInput());
        this.registerDomEvent(window, "blur", () => this.pauseAndSave());
        this.registerDomEvent(this.containerEl.doc, "visibilitychange", () => {
            if (this.containerEl.doc.visibilityState === "hidden")
                this.pauseAndSave();
        });
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", (leaf) => {
                if (leaf === this.leaf) this.focusInput();
            }),
        );
        this.registerEvent(
            this.app.workspace.on("resize", () => this.placeCaret(true)),
        );
        this.registerInterval(window.setInterval(() => this.onTick(), 250));

        this.opened = true;
        this.applySettings();
        if (this.source) this.loadSource(this.source);
        else
            this.showMessage(
                "Open a note and run \u201cType the current note\u201d.",
            );
    }

    override async onClose(): Promise<void> {
        this.pauseAndSave();
        if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
        this.contentEl.empty();
    }

    private button(
        parent: HTMLElement,
        text: string,
        title: string,
        onClick: () => void,
        primary = false,
    ): HTMLButtonElement {
        const btn = parent.createEl("button", {
            text,
            cls: primary ? "mod-cta" : "",
        });
        if (title) btn.setAttribute("aria-label", title);
        // Keep keyboard focus in the typing box when clicking.
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", onClick);
        return btn;
    }

    private stat(
        parent: HTMLElement,
        label: string,
        initial: string,
    ): HTMLElement {
        const wrap = parent.createSpan({ cls: "typelit-stat" });
        const value = wrap.createEl("strong", { text: initial });
        wrap.appendText(` ${label}`);
        return value;
    }

    // --- loading a text ----------------------------------------------------------------

    loadSource(source: Source): void {
        this.flushSave();
        this.source = source;
        this.textHash = hashText(source.text);
        this.titleEl.setText(source.title);
        // Refresh the tab title. updateHeader() is not in Obsidian's public typings,
        // so call it only if this version provides it.
        (
            this.leaf as unknown as { updateHeader?: () => void }
        ).updateHeader?.();

        const engine = this.createEngine();
        this.engine = engine;
        this.finished = false;

        const saved = this.plugin.data.progress[source.key];
        this.noteEl.hidden = true;
        if (saved) {
            if (saved.textHash === this.textHash) {
                const restored = TypingEngine.restore(
                    source.text,
                    saved,
                    this.idleMs(),
                );
                if (restored.index > 0) {
                    this.engine = restored;
                    this.noteEl.setText(
                        `Resumed where you left off (${Math.round(restored.percent)}%). Press Esc to start over.`,
                    );
                    this.noteEl.hidden = false;
                }
            } else {
                void this.plugin.clearProgress(source.key); // the note changed since it was saved
            }
        }

        this.buildSpans();
        this.resultEl.hidden = true;
        this.captureEl.disabled = false;
        this.bestEl.setText(this.bestLabel());
        this.render();
        this.placeCaret(true);
        this.focusInput();
    }

    private idleMs(): number {
        return this.plugin.data.settings.idleSeconds * 1000;
    }

    private createEngine(): TypingEngine {
        return new TypingEngine(this.source?.text ?? "", this.idleMs());
    }

    private bestLabel(): string {
        if (!this.source) return "";
        const best = bestWpm(this.plugin.data.results, this.source.key);
        return best === null ? "" : `best: ${Math.round(best)} WPM`;
    }

    private showMessage(text: string): void {
        this.boxEl.empty();
        this.boxEl.createDiv({ cls: "typelit-empty", text });
        this.spans = [];
    }

    private buildSpans(): void {
        this.boxEl.empty();
        const engine = this.engine;
        if (!engine) return;
        this.spans = engine.chars.map((ch) =>
            this.boxEl.createSpan({ text: ch }),
        );
        this.caretEl = this.boxEl.createDiv({ cls: "typelit-caret" });
        this.caretEl.setAttribute("aria-hidden", "true");
        this.caretTop = -1;
        engine.state.forEach((s, i) => this.paint(i, s));
        this.boxEl.scrollTop = 0;
    }

    private paint(i: number, state: number): void {
        const span = this.spans[i];
        if (span)
            span.className =
                state === 1
                    ? "typelit-correct"
                    : state === 2
                      ? "typelit-wrong"
                      : "";
    }

    /** Re-apply settings that affect an open view (text size, live stats). */
    applySettings(): void {
        const s = this.plugin.data.settings;
        this.contentEl.style.setProperty("--typelit-size", `${s.textSize}px`);
        this.liveEl.toggleClass("typelit-hidden", !s.showLiveStats);
        this.placeCaret(true);
    }

    private changeSize(delta: number): void {
        const s = this.plugin.data.settings;
        s.textSize = Math.min(48, Math.max(12, s.textSize + delta));
        void this.plugin.saveAll();
        this.plugin.refreshViews();
    }

    focusInput(): void {
        if (!this.captureEl.disabled)
            this.captureEl.focus({ preventScroll: true });
    }

    // --- typing --------------------------------------------------------------------------

    private handleText(text: string): void {
        for (const ch of Array.from(text)) {
            if (ch === "\n" || ch === "\r") continue;
            this.typeChar(ch);
        }
    }

    private typeChar(ch: string): void {
        const engine = this.engine;
        if (!engine || this.finished) return;
        const result = engine.type(ch, performance.now());
        if (result === "ignored") return;
        this.paint(engine.index - 1, engine.state[engine.index - 1]);
        this.noteEl.hidden = true;
        this.placeCaret(false);
        this.scheduleRender();
        if (engine.complete) this.finish();
        else this.scheduleSave();
    }

    private backspace(): void {
        const engine = this.engine;
        if (!engine || this.finished) return;
        if (!engine.backspace(performance.now())) return;
        this.paint(engine.index, 0);
        this.placeCaret(false);
        this.scheduleRender();
        this.scheduleSave();
    }

    private onTick(): void {
        const engine = this.engine;
        if (!engine || this.finished) return;
        if (engine.tick(performance.now())) this.saveNow(); // store the frozen time
        if (engine.running) this.render();
        else this.renderIdleNote();
    }

    // --- finishing and restarting -----------------------------------------------------------

    private finish(): void {
        const engine = this.engine;
        const source = this.source;
        if (!engine || !source) return;
        this.finished = true;
        this.clearSaveTimer();
        const now = performance.now();
        engine.pause(now);
        const seconds = Math.max(engine.elapsedMs(now) / 1000, 0.5);
        const wpm = engine.wpm(now);
        const accuracy = engine.accuracy();
        this.render();
        this.captureEl.disabled = true;

        const previousBest = bestWpm(this.plugin.data.results, source.key);
        const result: RunResult = {
            key: source.key,
            title: source.title,
            wpm,
            accuracy,
            seconds,
            at: Date.now(),
        };
        void this.plugin.recordResult(result);

        let summary = `${Math.round(wpm)} WPM, ${accuracy.toFixed(1)}% accuracy, ${seconds.toFixed(1)} seconds.`;
        if (previousBest === null || wpm > previousBest)
            summary += " New personal best!";
        this.resultText.setText(summary);
        this.resultEl.hidden = false;
        this.bestEl.setText(this.bestLabel());
    }

    restart(): void {
        const engine = this.engine;
        if (engine && !this.finished && engine.index > CONFIRM_RESTART_AFTER) {
            new ConfirmModal(
                this.app,
                "Start over? Your saved progress for this text will be discarded.",
                () => this.reset(),
            ).open();
            return;
        }
        this.reset();
    }

    private reset(): void {
        const source = this.source;
        if (!source) return;
        this.clearSaveTimer();
        void this.plugin.clearProgress(source.key);
        this.engine = this.createEngine();
        this.finished = false;
        this.noteEl.hidden = true;
        this.resultEl.hidden = true;
        this.captureEl.disabled = false;
        this.buildSpans();
        this.render();
        this.placeCaret(true);
        this.focusInput();
    }

    // --- autosave ------------------------------------------------------------------------------

    private scheduleSave(): void {
        this.clearSaveTimer();
        this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
    }

    private clearSaveTimer(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
    }

    private saveNow(): void {
        this.clearSaveTimer();
        const engine = this.engine;
        const source = this.source;
        if (!engine || !source || this.finished) return;
        if (engine.index === 0) {
            void this.plugin.clearProgress(source.key);
            return;
        }
        void this.plugin.saveProgress(source.key, {
            ...engine.snapshot(performance.now()),
            textHash: this.textHash,
            updatedAt: Date.now(),
        });
    }

    private flushSave(): void {
        if (this.saveTimer !== null) this.saveNow();
    }

    /** Stop the clock and save when you leave the window or tab. */
    private pauseAndSave(): void {
        const engine = this.engine;
        if (!engine || this.finished || engine.index === 0) return;
        engine.pause(performance.now());
        this.saveNow();
        this.renderIdleNote();
    }

    // --- drawing -----------------------------------------------------------------------------------

    private scheduleRender(): void {
        if (this.renderQueued) return;
        this.renderQueued = true;
        requestAnimationFrame(() => {
            this.renderQueued = false;
            this.render();
        });
    }

    private render(): void {
        const engine = this.engine;
        if (!engine) return;
        const now = performance.now();
        this.wpmEl.setText(String(Math.round(engine.wpm(now))));
        this.accEl.setText(String(Math.round(engine.accuracy())));
        this.timeEl.setText(String(Math.floor(engine.elapsedMs(now) / 1000)));
        this.barEl.style.width = `${engine.percent}%`;
        this.caretEl?.toggleClass(
            "typelit-waiting",
            !engine.running && !this.finished,
        );
        this.renderIdleNote();
    }

    private renderIdleNote(): void {
        const engine = this.engine;
        this.idleEl.hidden = !(engine && engine.idle && !this.finished);
        this.caretEl?.toggleClass(
            "typelit-waiting",
            !!engine && !engine.running && !this.finished,
        );
    }

    /** Move the caret to the current character and keep that line about a third of
     *  the way down the box. `instant` skips the animations. */
    private placeCaret(instant: boolean): void {
        const engine = this.engine;
        if (!engine || !this.caretEl || !this.caretEl.isConnected) return;
        if (engine.index >= engine.total) {
            this.caretEl.hidden = true;
            return;
        }
        const cur = this.spans[engine.index];
        if (!cur) return;
        const top = cur.offsetTop;
        // Jump instead of gliding across the text when the caret wraps to a new line.
        const jump = instant || top !== this.caretTop;
        if (jump) this.caretEl.addClass("typelit-no-anim");
        this.caretEl.hidden = false;
        this.caretEl.style.height = `${cur.offsetHeight}px`;
        this.caretEl.style.transform = `translate(${cur.offsetLeft}px, ${top}px)`;
        if (jump) {
            void this.caretEl.offsetWidth; // apply the jump before re-enabling the glide
            requestAnimationFrame(() =>
                this.caretEl.removeClass("typelit-no-anim"),
            );
        }
        this.caretTop = top;
        this.scrollTo(Math.max(0, top - this.boxEl.clientHeight / 3), instant);
    }

    /** Ease the box towards the target scroll position over a few frames. */
    private scrollTo(target: number, instant: boolean): void {
        this.scrollTarget = target;
        if (instant || this.reduceMotion) {
            if (this.scrollFrame !== null)
                cancelAnimationFrame(this.scrollFrame);
            this.scrollFrame = null;
            this.boxEl.scrollTop = target;
        } else if (
            this.scrollFrame === null &&
            Math.abs(this.boxEl.scrollTop - target) > 1
        ) {
            this.scrollFrame = requestAnimationFrame(() => this.scrollStep());
        }
    }

    private scrollStep(): void {
        const diff = this.scrollTarget - this.boxEl.scrollTop;
        const step = Math.max(1, Math.abs(diff) * 0.22);
        if (Math.abs(diff) <= step) {
            this.boxEl.scrollTop = this.scrollTarget;
            this.scrollFrame = null;
            return;
        }
        this.boxEl.scrollTop += Math.sign(diff) * step;
        this.scrollFrame = requestAnimationFrame(() => this.scrollStep());
    }
}
