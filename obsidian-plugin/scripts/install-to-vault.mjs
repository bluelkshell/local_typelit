// Copy the built plugin into an Obsidian vault.
//   npm run build
//   npm run install-to-vault -- /path/to/your/vault
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vault = process.argv[2] ? resolve(process.argv[2]) : "";

if (!vault) {
  console.error("Usage: npm run install-to-vault -- /path/to/your/vault");
  process.exit(2);
}
if (!existsSync(vault) || !statSync(vault).isDirectory()) {
  console.error(`Not a folder: ${vault}`);
  process.exit(1);
}
if (!existsSync(join(vault, ".obsidian"))) {
  console.error(`${vault} has no .obsidian folder. Open it once in Obsidian, or check the path.`);
  process.exit(1);
}

const files = ["main.js", "manifest.json", "styles.css"];
for (const file of files) {
  if (!existsSync(join(root, file))) {
    console.error(`${file} is missing. Run "npm run build" first.`);
    process.exit(1);
  }
}

const id = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).id;
const target = join(vault, ".obsidian", "plugins", id);
mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(join(root, file), join(target, file));

console.log(`Installed to ${target}`);
console.log('In Obsidian: Settings > Community plugins > turn on "Local TypeLit" (reload plugins if it is not listed).');
console.log("Your saved progress and history (data.json) in that folder are left untouched.");
