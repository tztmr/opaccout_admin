import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = join(webRoot, "public");
const apkPath = join(publicDir, "downloads", "short-op.apk");
const nginxConf = readFileSync(join(webRoot, "nginx.conf"), "utf8");
const opHtml = readFileSync(join(publicDir, "op.html"), "utf8");
const opJsPath = join(publicDir, "op.js");
const opJsSource = readFileSync(opJsPath, "utf8");

function loadShortOpPage() {
  const module = { exports: {} as Record<string, unknown> };
  const context = {
    module,
    exports: module.exports,
    window: undefined,
    document: undefined
  };
  vm.runInNewContext(opJsSource, context, { filename: opJsPath });
  return module.exports as {
    isValidShortCode(value: string): boolean;
    extractShortCode(locationLike: { pathname?: string }): string;
    readErrorMessage(payload: unknown, fallback?: string): string;
  };
}

const shortOpPage = loadShortOpPage();

describe("static public short OP page", () => {
  it("ships the approved short OP APK bytes", () => {
    const apk = readFileSync(apkPath);
    expect(apk.byteLength).toBe(881_585);
    expect(createHash("sha256").update(apk).digest("hex")).toBe(
      "04b2b747ee36eb9891cc64bff8e135431b2bf39daa8692d4d1f8a0bd8f8c36cd"
    );
  });

  it("ships an iOS-friendly static shell that targets the current resolve API", () => {
    expect(opHtml).toContain("短码登录");
    expect(opHtml).toContain("9 位短 OP");
    expect(opHtml).toContain("initializeShortOpPage");
    expect(opHtml).toContain('fetch("/api/op/resolve"');
    expect(opHtml).not.toContain('src="/op.js"');
    expect(opHtml).toContain("立即打开");
    expect(opHtml).not.toContain("react");
    expect(opHtml).not.toContain("type=\"module\"");

    expect(shortOpPage.isValidShortCode("123456789")).toBe(true);
    expect(shortOpPage.isValidShortCode("012345678")).toBe(false);
    expect(shortOpPage.isValidShortCode("12345678")).toBe(false);
    expect(shortOpPage.extractShortCode({ pathname: "/123456789" })).toBe("123456789");
    expect(shortOpPage.extractShortCode({ pathname: "/op/987654321" })).toBe("987654321");
    expect(shortOpPage.extractShortCode({ pathname: "/op/012345678" })).toBe("");
    expect(shortOpPage.readErrorMessage({ error: "短 OP 无效或已过期" }, "fallback")).toBe(
      "短 OP 无效或已过期"
    );

    expect(opJsSource).toContain('fetch("/api/op/resolve"');
    expect(opJsSource).toContain("credentials: \"omit\"");
    expect(opJsSource).toContain("cache: \"no-store\"");
    expect(opJsSource).not.toContain("import ");
    expect(opJsSource).not.toContain("=>");
  });

  it("keeps the admin SPA root on index.html while serving static short OP routes", () => {
    expect(nginxConf).toMatch(/location = \/op\.html\s*\{[\s\S]*Cache-Control "no-store"/);
    expect(nginxConf).toMatch(/location = \/op\.js\s*\{[\s\S]*Cache-Control "no-store"/);
    expect(nginxConf).toMatch(/location = \/op\s*\{[\s\S]*try_files \/op\.html =404;/);
    expect(nginxConf).toMatch(/location ~ "\^\/\[1-9\]\[0-9\]\{8\}\$"\s*\{[\s\S]*try_files \/op\.html =404;/);
    expect(nginxConf).toMatch(/location ~ "\^\/op\/\[1-9\]\[0-9\]\{8\}\$"\s*\{[\s\S]*try_files \/op\.html =404;/);
    expect(nginxConf).toMatch(/location \/\s*\{[\s\S]*try_files \$uri \$uri\/ \/index\.html;/);
    expect(nginxConf).not.toMatch(/location = \/\s*\{[\s\S]*try_files \/op\.html =404;/);
  });
});
