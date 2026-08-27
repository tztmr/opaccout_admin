import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountDto } from "@douyin-admin/shared";
import { buildAccountTableColumns } from "./account-table-columns";

afterEach(cleanup);

const row: AccountDto = {
  _id: "account-synthetic",
  douyinId: "93900112233",
  accountKind: "email",
  email: "synthetic@example.test",
  mobile: "+86 13037174892",
  secUid: "MS4wLjABAAAA-synthetic",
  registeredAt: "2026-08-21T00:00:00.000Z",
  opName: "合成 OP",
  hasOpSecret: true,
  accountPassword: "synthetic-password",
  shortOpCode: "123456789",
  opProject: "douyin",
  opExpiresAt: "2026-09-21T00:00:00.000Z",
  owner: "测试人",
  registeredRegion: "中国.测试",
  saleStatus: "unknown",
  accountStatus: "normal",
  accountCheckedAt: "2026-08-21T00:00:00.000Z",
  remark: "合成备注",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z"
};

function renderColumns(value: AccountDto, order: unknown) {
  const reveal = vi.fn();
  const copyText = vi.fn();
  const columns = buildAccountTableColumns("email", order, { reveal, copyText });

  render(
    <table>
      <colgroup>
        {columns.map((column) => <col key={column.id} data-id={column.id} className={column.className} />)}
      </colgroup>
      <thead><tr>{columns.map((column) => <th key={column.id} data-id={column.id}>{column.header}</th>)}</tr></thead>
      <tbody><tr>{columns.map((column) => <td key={column.id} data-id={column.id}>{column.render(value)}</td>)}</tr></tbody>
    </table>
  );

  return { columns, reveal, copyText };
}

describe("account table column registry", () => {
  it("uses one normalized descriptor order for colgroup, headers, and cells", () => {
    const { columns } = renderColumns(row, ["remark", "mobile", "email", "douyin"]);
    const table = screen.getByRole("table");

    expect(columns.slice(0, 4).map((column) => column.id)).toEqual([
      "remark", "mobile", "email", "douyin"
    ]);
    expect(columns.find((column) => column.id === "mobile")?.header).toBe("手机号");
    expect(Array.from(table.querySelectorAll("col")).map((node) => node.getAttribute("data-id")))
      .toEqual(columns.map((column) => column.id));
    expect(screen.getAllByRole("columnheader").map((node) => node.getAttribute("data-id")))
      .toEqual(columns.map((column) => column.id));
    expect(Array.from(table.querySelectorAll("tbody td")).map((node) => node.getAttribute("data-id")))
      .toEqual(columns.map((column) => column.id));
  });

  it("keeps Google free of Email and gives every descriptor one column class", () => {
    const columns = buildAccountTableColumns("google", ["email", "mobile"], {
      reveal: vi.fn(),
      copyText: vi.fn()
    });

    expect(columns.map((column) => column.id)).not.toContain("email");
    expect(columns.every((column) => column.className === `col-${column.id}`)).toBe(true);
  });

  it("renders a legacy empty mobile as a dash and preserves a full synthetic mobile title", () => {
    const { rerender } = render(
      <table><tbody><tr><td>{buildAccountTableColumns("google", ["mobile"], {
        reveal: vi.fn(), copyText: vi.fn()
      })[0]?.render({ ...row, accountKind: "google", email: "", mobile: "" })}</td></tr></tbody></table>
    );
    expect(screen.getByRole("cell")).toHaveTextContent("—");

    const mobile = buildAccountTableColumns("google", ["mobile"], {
      reveal: vi.fn(), copyText: vi.fn()
    })[0]!;
    rerender(<table><tbody><tr><td>{mobile.render({ ...row, accountKind: "google", email: "" })}</td></tr></tbody></table>);
    expect(screen.getByText(row.mobile)).toHaveAttribute("title", row.mobile);
    expect(screen.getByRole("cell")).toHaveTextContent(row.mobile);
  });

  it("copies the share link from the short-OP value and keeps code copy separate", () => {
    const { reveal, copyText } = renderColumns(row, ["opsecret", "shortop"]);

    fireEvent.click(screen.getByRole("button", { name: /显示 OP 卡密/ }));
    const linkCopy = screen.getByRole("button", {
      name: "复制短 OP 链接 123456789"
    });
    expect(linkCopy).toHaveTextContent("123456789");
    expect(linkCopy).not.toHaveTextContent("链接");
    fireEvent.click(linkCopy);
    fireEvent.click(screen.getByRole("button", { name: "复制短 OP 123456789" }));

    expect(reveal).toHaveBeenCalledWith(row._id);
    expect(copyText).toHaveBeenNthCalledWith(
      1,
      `https://op.tztright.qzz.io/${row.shortOpCode}`,
      "短 OP 链接已复制"
    );
    expect(copyText).toHaveBeenNthCalledWith(2, row.shortOpCode, "短 OP 已复制");
  });

  it("renders missing OP fields as dashes without a reveal action", () => {
    const withoutOp: AccountDto = {
      ...row,
      opName: "",
      hasOpSecret: false,
      shortOpCode: "",
      opExpiresAt: ""
    };
    const { reveal } = renderColumns(withoutOp, ["opname", "opsecret", "shortop", "expiry"]);

    expect(screen.queryByRole("button", { name: /显示 OP 卡密/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(reveal).not.toHaveBeenCalled();
  });
});
