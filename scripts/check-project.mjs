import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scripts = [];
const jsonFiles = [];
const markdownFiles = [];
let checkedLinks = 0;
let checkedSkills = 0;

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
    for (const match of source.matchAll(/!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const link = match[1];
        if (/^(?:[a-z]+:|#)/i.test(link)) continue;
        const target = decodeURIComponent(link.split("#", 1)[0]);
        if (!target) continue;
        await stat(resolve(dirname(path), target));
        checkedLinks += 1;
    }
    if (basename(path) === "SKILL.md" && relative(root, path).startsWith(`.github${process.platform === "win32" ? "\\" : "/"}skills`)) {
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1];
        if (!frontmatter) throw new Error(`${relative(root, path)} is missing YAML frontmatter.`);
        const fields = Object.fromEntries(frontmatter.split(/\r?\n/).filter(Boolean).map((line) => {
            const separator = line.indexOf(":");
            if (separator < 1) throw new Error(`${relative(root, path)} has invalid frontmatter.`);
            return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
        }));
        const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
        const unknown = Object.keys(fields).find((field) => !allowed.has(field));
        if (unknown) throw new Error(`${relative(root, path)} has unknown frontmatter field "${unknown}".`);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name ?? "") || fields.name.length > 64) {
            throw new Error(`${relative(root, path)} has an invalid skill name.`);
        }
        if (fields.name !== basename(dirname(path))) {
            throw new Error(`${relative(root, path)} skill name must match its directory.`);
        }
        if (!fields.description || fields.description.length > 1024) {
            throw new Error(`${relative(root, path)} has an invalid description.`);
        }
        if (fields.compatibility && fields.compatibility.length > 500) {
            throw new Error(`${relative(root, path)} has an invalid compatibility field.`);
        }
        checkedSkills += 1;
    }
}
process.stdout.write(`Checked ${scripts.length} scripts, ${jsonFiles.length} JSON files, ${checkedLinks} relative Markdown links, ${checkedSkills} project skill(s), and documentation JSON examples.\n`);
