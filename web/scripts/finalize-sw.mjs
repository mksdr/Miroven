import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDirectory = fileURLToPath(new URL("../", import.meta.url));
const outDirectory = path.join(webDirectory, "out");
const swPath = path.join(outDirectory, "sw.js");
const pkgPath = path.join(webDirectory, "package.json");

/**
 * Recursively list all files in a directory.
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
export async function listAllFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listAllFiles(entryPath);
      return entry.isFile() ? [entryPath] : [];
    }),
  );
  return nestedFiles.flat();
}

/**
 * Filter out files that should not contribute to the Service Worker cache hash.
 * @param {string} relativePath POSIX-formatted relative path
 * @returns {boolean}
 */
export function shouldIncludeInBuildHash(relativePath) {
  const normalized = relativePath.toLowerCase();
  if (normalized === "sw.js" || normalized === "_headers") return false;
  if (normalized.endsWith(".map")) return false;
  return true;
}

/**
 * Computes a deterministic SHA-256 hash across all build output files.
 * @param {string} baseDirectory
 * @returns {Promise<{ digest: string, fileCount: number }>}
 */
export async function computeBuildArtifactsHash(baseDirectory) {
  const allFiles = await listAllFiles(baseDirectory);
  const relativeFiles = allFiles
    .map((fullPath) => path.relative(baseDirectory, fullPath).split(path.sep).join("/"))
    .filter(shouldIncludeInBuildHash)
    .sort();

  if (relativeFiles.length === 0) {
    throw new Error(`No build artifacts found in ${baseDirectory}. Run next build first.`);
  }

  const hasher = createHash("sha256");
  for (const relativePath of relativeFiles) {
    const fullPath = path.join(baseDirectory, relativePath);
    let content = await readFile(fullPath);

    // Normalize CRLF to LF in text files for cross-platform deterministic hashing
    const isTextFile = /\.(?:html|js|mjs|cjs|css|json|webmanifest|txt|svg|xml)$/i.test(relativePath);
    if (isTextFile) {
      content = Buffer.from(content.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    }

    hasher.update(relativePath, "utf8");
    hasher.update(content);
  }

  const digest = hasher.digest("hex").slice(0, 10);
  return { digest, fileCount: relativeFiles.length };
}

/**
 * Generates the cache name string.
 * @param {string} version
 * @param {string} hash
 * @param {string | undefined} envOverride
 * @returns {string}
 */
export function generateCacheName(version, hash, envOverride = process.env.SERVICE_WORKER_CACHE_VERSION) {
  if (envOverride && envOverride.trim().length > 0) {
    const clean = envOverride.trim();
    return clean.startsWith("miroven-shell-") ? clean : `miroven-shell-${clean}`;
  }
  return `miroven-shell-v${version}-${hash}`;
}

/**
 * Replaces the CACHE_NAME declaration in the Service Worker script.
 * @param {string} source
 * @param {string} newCacheName
 * @returns {string}
 */
export function replaceCacheName(source, newCacheName) {
  const pattern = /const\s+CACHE_NAME\s*=\s*["'][^"']+["'];/;
  if (!pattern.test(source)) {
    throw new Error("Service Worker source is missing a valid 'const CACHE_NAME = ...;' declaration.");
  }
  return source.replace(pattern, `const CACHE_NAME = "${newCacheName}";`);
}

/**
 * Main execution routine.
 */
export async function runFinalizeSw({
  checkOnly = process.argv.includes("--check"),
  outDir = outDirectory,
  targetSwPath = swPath,
  packageJsonPath = pkgPath,
} = {}) {
  const pkgContent = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(pkgContent);
  const version = pkg.version;
  if (!version) {
    throw new Error("Could not determine package version from package.json.");
  }

  const { digest, fileCount } = await computeBuildArtifactsHash(outDir);
  const expectedCacheName = generateCacheName(version, digest);

  let swContent;
  try {
    swContent = await readFile(targetSwPath, "utf8");
  } catch {
    throw new Error(`Service Worker file not found at ${targetSwPath}. Run next build first.`);
  }

  const match = swContent.match(/const\s+CACHE_NAME\s*=\s*["']([^"']+)["'];/);
  const currentCacheName = match?.[1];

  if (checkOnly) {
    if (currentCacheName !== expectedCacheName) {
      throw new Error(
        `Exported Service Worker cache name mismatch.\nExpected: "${expectedCacheName}"\nFound:    "${currentCacheName}"\nRun "npm run build" to update.`,
      );
    }
    console.log(`Service Worker cache name is verified: "${expectedCacheName}" (hashed ${fileCount} files)`);
    return { expectedCacheName, currentCacheName, fileCount };
  }

  const updatedSwContent = replaceCacheName(swContent, expectedCacheName);
  await writeFile(targetSwPath, updatedSwContent, "utf8");
  console.log(`Updated Service Worker cache name to: "${expectedCacheName}" (hashed ${fileCount} files)`);
  return { expectedCacheName, currentCacheName, fileCount };
}

// Execute when run directly as CLI
const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runFinalizeSw().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
