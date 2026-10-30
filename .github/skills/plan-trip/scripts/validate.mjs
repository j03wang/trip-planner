import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
    const [toolingDirectory, itineraryPath] = process.argv.slice(2);
    if (!toolingDirectory || !itineraryPath || process.argv.length !== 4) {
        throw new Error("Usage: node scripts/validate.mjs <tooling-checkout> <project-relative-itinerary.json>");
    }

    const toolingRoot = resolve(toolingDirectory);
    const gitRoot = execFileSync("git", ["-C", toolingRoot, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (realpathSync(gitRoot) !== realpathSync(toolingRoot)) {
        throw new Error("Tooling directory must be the root of its own checkout.");
    }
    const changes = execFileSync("git", ["-C", toolingRoot, "status", "--porcelain", "--untracked-files=no"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (changes) throw new Error("Tooling checkout has modified tracked files; use a clean checkout of origin/main.");

    try {
        execFileSync("git", ["-C", toolingRoot, "fetch", "--quiet", "origin", "main"], {
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (error) {
        throw new Error(`Could not check latest tooling on origin/main: ${error.message}`);
    }
    const revision = execFileSync("git", ["-C", toolingRoot, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const latest = execFileSync("git", ["-C", toolingRoot, "rev-parse", "refs/remotes/origin/main"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (revision !== latest) {
        throw new Error(`Tooling checkout is outdated (${revision}); update it to origin/main (${latest}) and review the current contract before validation.`);
    }

    const moduleUrl = pathToFileURL(resolve(toolingRoot, "scripts", "validate-itinerary.mjs"));
    const { validateItineraryFile } = await import(moduleUrl.href);
    const result = await validateItineraryFile(itineraryPath, { projectRoot: process.cwd() });
    if (!result.ok) {
        throw new Error(`Itinerary validation failed:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
    }
    process.stdout.write(`Valid itinerary: ${result.path} (${result.bytes} bytes, schema ${result.schemaVersion}, trip ${result.tripId}, tooling ${revision})\n`);
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
