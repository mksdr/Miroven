import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("PWA Manifest & Service Worker Integrity Assertions", () => {
  const publicDir = path.resolve(__dirname, "../public");

  it("validates manifest.webmanifest structure and required PWA fields", () => {
    const manifestPath = path.join(publicDir, "manifest.webmanifest");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(content.name).toBe("Miroven");
    expect(content.short_name).toBe("Miroven");
    expect(content.start_url).toBe("/");
    expect(content.display).toBe("standalone");
    expect(content.theme_color).toBeDefined();
    expect(content.background_color).toBeDefined();
  });

  it("validates Service Worker (sw.js) cache integrity and offline fallback strategy", () => {
    const swPath = path.join(publicDir, "sw.js");
    expect(fs.existsSync(swPath)).toBe(true);

    const swContent = fs.readFileSync(swPath, "utf-8");

    // Must validate response.ok before caching to prevent poisoning cache with 4xx/5xx errors
    expect(swContent).toContain("if (response.ok)");

    // Must handle offline fallback strategy for navigate requests
    expect(swContent).toContain('event.request.mode === "navigate"');
    expect(swContent).toContain('caches.match(url.pathname)');

    // Must handle cache versioning and cleanup
    expect(swContent).toContain("CACHE_NAME");
    expect(swContent).toContain("caches.delete");
    expect(swContent).toMatch(/const\s+CACHE_NAME\s*=\s*["']miroven-shell-[^"']+["'];/);
  });

  it("validates Service Worker finalize script unit helpers", async () => {
    const {
      generateCacheName,
      replaceCacheName,
      shouldIncludeInBuildHash,
    } = await import("../scripts/finalize-sw.mjs");

    // Cache name generation
    expect(generateCacheName("1.5.0", "a1b2c3d4e5")).toBe("miroven-shell-v1.5.0-a1b2c3d4e5");
    expect(generateCacheName("1.5.0", "a1b2c3d4e5", "custom-release-1")).toBe("miroven-shell-custom-release-1");
    expect(generateCacheName("1.5.0", "a1b2c3d4e5", "miroven-shell-custom-2")).toBe("miroven-shell-custom-2");

    // Build hash file inclusion filters
    expect(shouldIncludeInBuildHash("index.html")).toBe(true);
    expect(shouldIncludeInBuildHash("_next/static/chunks/main.js")).toBe(true);
    expect(shouldIncludeInBuildHash("theme-init.js")).toBe(true);
    expect(shouldIncludeInBuildHash("sw.js")).toBe(false);
    expect(shouldIncludeInBuildHash("_headers")).toBe(false);
    expect(shouldIncludeInBuildHash("bundle.js.map")).toBe(false);

    // Replacement logic
    const dummySw = 'const CACHE_NAME = "miroven-shell-dev";\nconsole.log(CACHE_NAME);';
    const replaced = replaceCacheName(dummySw, "miroven-shell-v1.5.0-newhash123");
    expect(replaced).toContain('const CACHE_NAME = "miroven-shell-v1.5.0-newhash123";');

    // Replacement failure on invalid format
    expect(() => replaceCacheName("let foo = 1;", "miroven-shell-v1.5.0-x")).toThrow(
      "Service Worker source is missing a valid 'const CACHE_NAME = ...;' declaration.",
    );
  });

  it("verifies exported out/sw.js has automated cache version if build exists", () => {
    const outSwPath = path.resolve(__dirname, "../out/sw.js");
    if (!fs.existsSync(outSwPath)) return; // Skipped if out/ not yet built

    const outSwContent = fs.readFileSync(outSwPath, "utf-8");
    const match = outSwContent.match(/const\s+CACHE_NAME\s*=\s*["']([^"']+)["'];/);
    expect(match).not.toBeNull();
    const cacheName = match![1];

    expect(cacheName).toMatch(/^miroven-shell-v\d+\.\d+\.\d+-[a-f0-9]{10}$/);
    expect(cacheName).not.toBe("miroven-shell-dev");
    expect(cacheName).not.toBe("miroven-shell-v4");
  });
});
