import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(resolve(currentDir, "../styles.css"), "utf8");

describe("global form control styles", () => {
  it("excludes checkbox and radio inputs from text field styling", () => {
    expect(styles).toContain(
      'input:not([type="checkbox"]):not([type="radio"]), select, textarea'
    );
    expect(styles).toContain(
      'input:not([type="checkbox"]):not([type="radio"]):focus, select:focus, textarea:focus'
    );
  });

  it("allows the batch action bar to wrap so later buttons stay visible", () => {
    const batchBarRule = styles.match(/\.batch-bar\s*\{[^}]+\}/)?.[0] ?? "";
    const batchBarButtonRule =
      styles.match(/\.batch-bar button\s*\{[^}]+\}/)?.[0] ?? "";

    expect(batchBarRule).toContain("flex-wrap: wrap;");
    expect(batchBarButtonRule).toContain("white-space: nowrap;");
  });

  it("keeps the account table within the 1920 desktop content budget", () => {
    const accountTableRule =
      styles.match(/\.accounts-table\s*\{[^}]+\}/)?.[0] ?? "";
    const actionsRule =
      styles.match(/\.accounts-table \.actions\s*\{[^}]+\}/)?.[0] ?? "";

    expect(accountTableRule).toContain("table-layout: fixed;");
    expect(accountTableRule).toContain("min-width: 1410px;");
    expect(accountTableRule).not.toContain("1720px");
    expect(actionsRule).toContain("gap: 3px;");
  });

  it("keeps table overflow and checkbox clipping scoped separately", () => {
    const tableScrollRule = styles.match(/\.table-scroll\s*\{[^}]+\}/)?.[0] ?? "";
    const checkCellRule = styles.match(/\.check-cell,[\s\S]*?\n}\n/)?.[0] ?? "";

    expect(tableScrollRule).toContain("overflow-x: auto;");
    expect(checkCellRule).toContain("text-overflow: clip !important;");
  });
});
