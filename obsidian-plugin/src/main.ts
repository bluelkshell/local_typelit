import { Notice, Plugin, TFile } from "obsidian";
import { LocalTypeLitSettingTab } from "./settings.ts";
import { StatsModal } from "./stats.ts";
import { addResult, normalizeData, pruneProgress } from "./storage.ts";
import type { PluginData, RunResult, SavedProgress } from "./storage.ts";
import { hashText, prepareText, truncateAtWord } from "./text.ts";
import { TypingView, VIEW_TYPE } from "./view.ts";
import type { Source } from "./view.ts";

const SELECTION_TITLE_WORDS = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default class LocalTypeLitPlugin extends Plugin {
  data: PluginData = normalizeData(undefined);
  private writes: Promise<void> = Promise.resolve();

  override async onload(): Promise<void> {
    this.data = normalizeData(await this.loadData());

    this.registerView(VIEW_TYPE, (leaf) => new TypingView(leaf, this));

    this.addRibbonIcon("keyboard", "Type the current note", () => void this.typeCurrentNote());

    this.addCommand({
      id: "type-current-note",
      name: "Type the current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.typeFile(file);
        return true;
      },
    });

    this.addCommand({
      id: "type-selection",
      name: "Type the selected text",
      editorCheckCallback: (checking, editor, ctx) => {
        const selected = editor.getSelection();
        if (!selected.trim()) return false;
        if (!checking) void this.typeSelection(selected, ctx.file?.basename);
        return true;
      },
    });

    this.addCommand({
      id: "show-stats",
      name: "Show typing stats",
      callback: () => new StatsModal(this.app, this).open(),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) =>
          item
            .setTitle("Type this note")
            .setIcon("keyboard")
            .onClick(() => void this.typeFile(file)),
        );
      }),
    );

    this.addSettingTab(new LocalTypeLitSettingTab(this.app, this));
  }

  // --- opening texts -------------------------------------------------------------------

  async typeCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("Open a Markdown note first.");
      return;
    }
    await this.typeFile(file);
  }

  async typeFile(file: TFile): Promise<void> {
    const source = await this.sourceFromFile(file);
    if (source) await this.openSource(source);
  }

  async typeSelection(selected: string, from?: string): Promise<void> {
    const source = this.sourceFromSelection(selected, from);
    if (source) await this.openSource(source);
  }

  async openSource(source: Source): Promise<void> {
    const workspace = this.app.workspace;
    // Reuse the typing tab if there is one, so tabs don't pile up.
    const leaf = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    const view = leaf.view;
    if (view instanceof TypingView) view.loadSource(source);
    await workspace.revealLeaf(leaf);
  }

  /** Rebuild a text from what a typing tab saved in the workspace layout. */
  async sourceFromState(state: unknown): Promise<Source | null> {
    if (!isRecord(state)) return null;
    if (state.kind === "file" && typeof state.path === "string") {
      const file = this.app.vault.getAbstractFileByPath(state.path);
      return file instanceof TFile ? this.sourceFromFile(file) : null;
    }
    if (state.kind === "selection" && typeof state.raw === "string") {
      return this.sourceFromSelection(state.raw, typeof state.title === "string" ? state.title : undefined);
    }
    return null;
  }

  private prepare(raw: string): string | null {
    const s = this.data.settings;
    const prepared = prepareText(raw, {
      stripMarkdown: s.stripMarkdown,
      skipCode: s.skipCode,
      asciiPunctuation: s.normalizePunctuation,
    });
    if (!prepared) {
      new Notice("There is nothing to type here.");
      return null;
    }
    const { text, truncated } = truncateAtWord(prepared, s.maxChars);
    if (truncated) {
      new Notice(`This text is long, so only the first ${text.length.toLocaleString()} characters are used.`);
    }
    return text;
  }

  async sourceFromFile(file: TFile): Promise<Source | null> {
    const text = this.prepare(await this.app.vault.cachedRead(file));
    if (text === null) return null;
    return { kind: "file", key: `file:${file.path}`, title: file.basename, text, path: file.path };
  }

  sourceFromSelection(selected: string, from?: string): Source | null {
    const text = this.prepare(selected);
    if (text === null) return null;
    const words = text.split(" ");
    const preview = words.slice(0, SELECTION_TITLE_WORDS).join(" ") + (words.length > SELECTION_TITLE_WORDS ? "\u2026" : "");
    return {
      kind: "selection",
      key: `sel:${hashText(text)}`,
      title: from && !from.includes("\u2026") ? `${from}: ${preview}` : preview,
      text,
      raw: selected,
    };
  }

  // --- data ---------------------------------------------------------------------------------

  /** Writes are queued so two quick saves can't overlap. */
  saveAll(): Promise<void> {
    this.writes = this.writes.then(
      () => this.saveData(this.data),
      () => this.saveData(this.data),
    );
    return this.writes;
  }

  async saveProgress(key: string, progress: SavedProgress): Promise<void> {
    this.data.progress[key] = progress;
    this.data.progress = pruneProgress(this.data.progress);
    await this.saveAll();
  }

  async clearProgress(key: string): Promise<void> {
    if (!(key in this.data.progress)) return;
    delete this.data.progress[key];
    await this.saveAll();
  }

  async recordResult(result: RunResult): Promise<void> {
    this.data.results = addResult(this.data.results, result);
    delete this.data.progress[result.key];
    await this.saveAll();
  }

  async clearHistory(): Promise<void> {
    this.data.results = [];
    this.data.progress = {};
    await this.saveAll();
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof TypingView) leaf.view.applySettings();
    }
  }
}
