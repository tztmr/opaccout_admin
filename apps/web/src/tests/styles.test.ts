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
    expect(styles).not.toMatch(/min-width:\s*1[6-9]\d{2}px/);
    expect(actionsRule).toContain("gap: 3px;");
  });

  it("adds only the email page width needed for its extra column", () => {
    const emailTableRule =
      styles.match(/\.accounts-table-email\s*\{[^}]+\}/)?.[0] ?? "";
    const emailColumnRule =
      styles.match(/\.accounts-table \.col-email\s*\{[^}]+\}/)?.[0] ?? "";
    const mobileColumnRule =
      styles.match(/\.accounts-table \.col-mobile\s*\{[^}]+\}/)?.[0] ?? "";

    expect(emailTableRule).toContain("min-width: 1518px;");
    expect(emailTableRule).not.toContain("1720px");
    expect(emailColumnRule).toContain("width: 108px;");
    expect(mobileColumnRule).toMatch(/width:\s*\d+px;/);
  });

  it("reserves enough width to show the full YYYY-MM-DD registration date", () => {
    const dateColumnRule =
      styles.match(/\.accounts-table \.col-date\s*\{[^}]+\}/)?.[0] ?? "";
    const width = Number(dateColumnRule.match(/width:\s*(\d+)px;/)?.[1] ?? 0);

    expect(width).toBeGreaterThanOrEqual(96);
  });

  it("keeps table overflow and checkbox clipping scoped separately", () => {
    const tableScrollRule = styles.match(/\.table-scroll\s*\{[^}]+\}/)?.[0] ?? "";
    const checkCellRule = styles.match(/\.check-cell,[\s\S]*?\n}\n/)?.[0] ?? "";

    expect(tableScrollRule).toContain("overflow-x: auto;");
    expect(checkCellRule).toContain("text-overflow: clip !important;");
    expect(styles).not.toMatch(/(?:html|body|\.main|\.main > section)\s*\{[^}]*overflow-x:\s*(?:auto|scroll)/);
  });

  it("styles the explicit column-order dialog without adding a table overlay", () => {
    expect(styles).toMatch(/\.column-order-dialog\s*\{[^}]+\}/);
    expect(styles).toMatch(/\.column-order-list\s*\{[^}]+\}/);
    expect(styles).toMatch(/\.column-order-list li\s*\{[^}]+\}/);
    expect(styles).not.toMatch(/\.table-scroll::(?:before|after)/);
  });

  it("keeps all five mobile navigation links in the fixed bottom bar", () => {
    const mobileRule = styles.match(
      /@media \(max-width: 680px\) \{[\s\S]*?\.sidebar nav\s*\{[^}]+\}/
    )?.[0] ?? "";

    expect(mobileRule).toContain("grid-template-columns: repeat(5,1fr);");
    expect(mobileRule).not.toContain("repeat(4,1fr)");
  });
});
