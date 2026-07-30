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
      new URLSearchParams("owner=张三&saleStatus=unknown&sortDirection=desc&page=2"),
      new Set()
    );

    expect(result).toEqual({
      format: "xlsx",
      owner: "张三",
      saleStatus: "unknown",
      sortDirection: "desc"
    });
  });

  it("prioritizes selected ids over filters", () => {
    const result = buildAccountExportParams(
      new URLSearchParams("owner=张三"),
      new Set(["a", "b"])
    );

    expect(result).toEqual({
      format: "xlsx",
      ids: ["a", "b"]
    });
  });
});
