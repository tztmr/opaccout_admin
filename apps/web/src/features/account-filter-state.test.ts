import { describe, expect, it } from "vitest";
import {
  buildAccountExportParams,
  DEFAULT_ACCOUNT_SALE_STATUS
} from "./account-filter-state";

describe("account filter state", () => {
  it("uses unknown as the new account default", () => {
    expect(DEFAULT_ACCOUNT_SALE_STATUS).toBe("unknown");
  });

  it("includes the owner in unselected exports", () => {
    const result = buildAccountExportParams(
      new URLSearchParams("owner=张三&saleStatus=unknown&page=2"),
      new Set()
    );

    expect(result.get("format")).toBe("xlsx");
    expect(result.get("owner")).toBe("张三");
    expect(result.get("saleStatus")).toBe("unknown");
    expect(result.has("page")).toBe(false);
  });

  it("prioritizes selected ids over filters", () => {
    const result = buildAccountExportParams(
      new URLSearchParams("owner=张三"),
      new Set(["a", "b"])
    );

    expect(result.get("ids")).toBe("a,b");
    expect(result.has("owner")).toBe(false);
  });
});
