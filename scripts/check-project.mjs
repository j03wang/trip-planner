import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scripts = [];
const jsonFiles = [];
const markdownFiles = [];

async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".test-work") continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if ([".js", ".mjs"].includes(extname(entry.name))) scripts.push(path);
        else if (extname(entry.name) === ".json") jsonFiles.push(path);
        else if (extname(entry.name) === ".md") markdownFiles.push(path);
    }
}

await walk(root);
for (const path of scripts) {
    const result = spawnSync(process.execPath, ["--check", path], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const path of jsonFiles) JSON.parse(await readFile(path, "utf8"));
for (const path of markdownFiles) {
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/```json\s*\n([\s\S]*?)```/g)) JSON.parse(match[1]);
}
process.stdout.write(`Checked ${scripts.length} scripts, ${jsonFiles.length} JSON files, and documentation JSON examples.\n`);
