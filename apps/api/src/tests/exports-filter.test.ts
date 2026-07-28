import { describe, expect, it } from "vitest";
import { buildExportFilter } from "../routes/exports";

describe("export account filters", () => {
  it("includes an exact owner filter", () => {
    expect(buildExportFilter({ owner: " 张三 " })).toEqual({ owner: "张三" });
  });

  it("matches each non-empty keyword line in batch search", () => {
    const filter = buildExportFilter({ keyword: "94946893573\n93180119509\n" });

    expect(filter.searchText).toBeInstanceOf(RegExp);
    const expression = filter.searchText as RegExp;
    expect(expression.test("94946893573")).toBe(true);
    expect(expression.test("93180119509")).toBe(true);
    expect(expression.test("12345678901")).toBe(false);
  });

  it("preserves existing status and registration date filters", () => {
    expect(buildExportFilter({
      saleStatus: "recovered",
      accountStatus: "normal",
      registeredFrom: "2026-07-01",
      registeredTo: "2026-07-31"
    })).toEqual({
      saleStatus: "recovered",
      accountStatus: "normal",
      registeredAt: {
        $gte: new Date("2026-07-01T00:00:00.000Z"),
        $lte: new Date("2026-07-31T23:59:59.999Z")
      }
    });
  });
});
