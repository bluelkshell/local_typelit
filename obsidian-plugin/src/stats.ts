import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import type LocalTypeLitPlugin from "./main.ts";
import { summarize } from "./storage.ts";

const RECENT_RUNS = 20;

export class StatsModal extends Modal {
    plugin: LocalTypeLitPlugin;

    constructor(app: App, plugin: LocalTypeLitPlugin) {
        super(app);
        this.plugin = plugin;
    }

    override onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass("typelit-stats");
        new Setting(contentEl).setName("Typing stats").setHeading();

        const results = this.plugin.data.results;
        if (results.length === 0) {
            contentEl.createEl("p", {
                text: "Nothing typed yet. Finish a note to see your stats here.",
            });
            return;
        }

        const s = summarize(results);
        const cards = contentEl.createDiv({ cls: "typelit-cards" });
        const card = (value: string, label: string) => {
            const c = cards.createDiv({ cls: "typelit-card" });
            c.createEl("strong", { text: value });
            c.createDiv({ cls: "typelit-card-label", text: label });
        };
        card(String(s.runs), "runs");
        card(String(Math.round(s.avgWpm)), "average WPM");
        card(String(Math.round(s.bestWpm)), "best WPM");
        card(`${s.avgAccuracy.toFixed(1)}%`, "average accuracy");

        new Setting(contentEl).setName("Recent runs").setHeading();
        const table = contentEl.createEl("table", { cls: "typelit-table" });
        const head = table.createEl("thead").createEl("tr");
        for (const h of ["When", "Note", "WPM", "Accuracy", "Time"])
            head.createEl("th", { text: h });
        const body = table.createEl("tbody");
        for (const r of results.slice(-RECENT_RUNS).reverse()) {
            const row = body.createEl("tr");
            row.createEl("td", { text: new Date(r.at).toLocaleString() });
            row.createEl("td", { text: r.title });
            row.createEl("td", { text: String(Math.round(r.wpm)) });
            row.createEl("td", { text: `${r.accuracy.toFixed(1)}%` });
            row.createEl("td", { text: `${Math.round(r.seconds)}s` });
        }
    }

    override onClose(): void {
        this.contentEl.empty();
    }
}
