import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type LocalTypeLitPlugin from "./main.ts";
import { DEFAULT_SETTINGS, normalizeSettings } from "./storage.ts";
import type { Settings } from "./storage.ts";

type ToggleKey =
    "normalizePunctuation" | "stripMarkdown" | "skipCode" | "showLiveStats";

export class LocalTypeLitSettingTab extends PluginSettingTab {
    plugin: LocalTypeLitPlugin;
    private confirmingClear = false;

    constructor(app: App, plugin: LocalTypeLitPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private async applyChange(change: Partial<Settings>): Promise<void> {
        this.plugin.data.settings = normalizeSettings({
            ...this.plugin.data.settings,
            ...change,
        });
        await this.plugin.saveAll();
        this.plugin.refreshViews();
    }

    private toggle(name: string, desc: string, key: ToggleKey): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addToggle((t) =>
                t
                    .setValue(this.plugin.data.settings[key])
                    .onChange(
                        (value) => void this.applyChange({ [key]: value }),
                    ),
            );
    }

    override display(): void {
        const { containerEl } = this;
        containerEl.empty();
        const s = this.plugin.data.settings;

        new Setting(containerEl)
            .setName("Text size")
            .setDesc("Size of the text in the typing tab, in pixels.")
            .addSlider((slider) =>
                slider
                    .setLimits(12, 48, 1)
                    .setValue(s.textSize)
                    .setDynamicTooltip()
                    .onChange(
                        (value) => void this.applyChange({ textSize: value }),
                    ),
            );

        new Setting(containerEl)
            .setName("Pause after")
            .setDesc(
                "The clock stops after this many seconds without a keystroke, and resumes when you type.",
            )
            .addSlider((slider) =>
                slider
                    .setLimits(2, 30, 1)
                    .setValue(s.idleSeconds)
                    .setDynamicTooltip()
                    .onChange(
                        (value) =>
                            void this.applyChange({ idleSeconds: value }),
                    ),
            );

        this.toggle(
            "Show live stats",
            "Show WPM, accuracy and time while you type.",
            "showLiveStats",
        );

        new Setting(containerEl).setName("Preparing the text").setHeading();
        containerEl.createEl("p", {
            cls: "setting-item-description",
            text: "These apply the next time you open a note. Changing them restarts saved progress for notes whose text changes.",
        });
        this.toggle(
            "Strip Markdown",
            "Type the prose only: no heading markers, link syntax, bold or italic marks, frontmatter or comments.",
            "stripMarkdown",
        );
        this.toggle(
            "Skip code blocks",
            "Leave fenced code blocks out of the text (only when stripping Markdown).",
            "skipCode",
        );
        this.toggle(
            "Use plain punctuation",
            "Turn curly quotes, long dashes and ellipses into keys on a normal keyboard, so you never have to type them.",
            "normalizePunctuation",
        );

        new Setting(containerEl)
            .setName("Maximum length")
            .setDesc(
                "Longer notes are cut at a word boundary after this many characters.",
            )
            .addText((text) =>
                text
                    .setPlaceholder(String(DEFAULT_SETTINGS.maxChars))
                    .setValue(String(s.maxChars))
                    .onChange((value) => {
                        const n = Number.parseInt(value, 10);
                        if (Number.isFinite(n))
                            void this.applyChange({ maxChars: n });
                    }),
            );

        new Setting(containerEl).setName("Data").setHeading();
        new Setting(containerEl)
            .setName("Clear history and saved places")
            .setDesc(
                "Deletes your run history and every saved place. Your notes are not touched.",
            )
            .addButton((button) => {
                button
                    .setButtonText(
                        this.confirmingClear
                            ? "Click again to confirm"
                            : "Clear",
                    )
                    .setWarning()
                    .onClick(async () => {
                        if (!this.confirmingClear) {
                            this.confirmingClear = true;
                            this.display();
                            return;
                        }
                        this.confirmingClear = false;
                        await this.plugin.clearHistory();
                        this.display();
                    });
            });
    }
}
