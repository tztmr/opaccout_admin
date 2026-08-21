import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCOUNT_COLUMN_ORDER } from "@douyin-admin/shared";
import { AccountColumnOrderDialog } from "../features/AccountColumnOrderDialog";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof AccountColumnOrderDialog>> = {}) {
  const props: React.ComponentProps<typeof AccountColumnOrderDialog> = {
    open: true,
    accountKind: "google",
    order: DEFAULT_ACCOUNT_COLUMN_ORDER.google,
    busy: false,
    onChange: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...overrides
  };
  return { ...render(<AccountColumnOrderDialog {...props} />), props };
}

function labels() {
  return within(screen.getByRole("list", { name: "可排序业务列" }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".column-order-label")?.textContent);
}

describe("account column order dialog", () => {
  it("only exposes business columns and drags by stable id", () => {
    const onChange = vi.fn();
    renderDialog({ onChange });

    expect(screen.queryByText("选择框")).not.toBeInTheDocument();
    expect(screen.queryByText("序号")).not.toBeInTheDocument();
    expect(screen.queryByText("操作")).not.toBeInTheDocument();

    fireEvent.dragStart(screen.getByRole("listitem", { name: /手机号/ }));
    fireEvent.dragOver(screen.getByRole("listitem", { name: /抖音号/ }));
    fireEvent.drop(screen.getByRole("listitem", { name: /抖音号/ }));

    expect(labels().slice(0, 3)).toEqual(["手机号", "抖音号", "密码"]);
    expect(onChange).toHaveBeenLastCalledWith([
      "mobile", "douyin", "password", "secuid", "date", "opname", "opsecret",
      "shortop", "project", "expiry", "owner", "region", "sale", "status", "remark"
    ]);
  });

  it("moves one step with touch and keyboard-safe buttons and disables boundaries", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByRole("button", { name: "上移抖音号" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移备注" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "下移抖音号" }));
    expect(labels().slice(0, 3)).toEqual(["密码", "抖音号", "sec_uid"]);
    await user.click(screen.getByRole("button", { name: "上移抖音号" }));
    expect(labels().slice(0, 3)).toEqual(["抖音号", "密码", "sec_uid"]);
  });

  it("restores the active kind default only in the draft", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDialog({
      accountKind: "email",
      order: ["remark", "mobile", "email", "douyin"],
      onSave
    });

    await user.click(screen.getByRole("button", { name: "恢复默认顺序" }));
    expect(labels()).toEqual(DEFAULT_ACCOUNT_COLUMN_ORDER.email.map((id) => ({
      douyin: "抖音号", email: "邮箱", password: "密码", secuid: "sec_uid",
      date: "注册时间", opname: "OP名称", opsecret: "OP卡密", shortop: "短 OP",
      mobile: "手机号", project: "项目", expiry: "OP到期时间", owner: "归属人",
      region: "注册地区", sale: "售卖状态", status: "账号状态", remark: "备注"
    })[id]));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("cancels without saving and resets a draft when another kind opens", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = renderDialog({ onClose, onSave });

    await user.click(screen.getByRole("button", { name: "下移抖音号" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();

    view.rerender(<AccountColumnOrderDialog {...view.props} accountKind="email" order={["email", "mobile"]} />);
    expect(labels().slice(0, 3)).toEqual(["邮箱", "手机号", "抖音号"]);
  });

  it("saves one draft and blocks duplicate submissions while busy", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const onSave = vi.fn(() => pending.promise);
    renderDialog({ onSave });

    await user.click(screen.getByRole("button", { name: "下移抖音号" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存中…" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith([
      "password", "douyin", "secuid", "date", "opname", "opsecret", "shortop",
      "mobile", "project", "expiry", "owner", "region", "sale", "status", "remark"
    ]);
    pending.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
  });

  it("keeps the failed draft visible with its error", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("保存顺序失败"));
    renderDialog({ onSave });

    await user.click(screen.getByRole("button", { name: "下移抖音号" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存顺序失败");
    expect(labels().slice(0, 3)).toEqual(["密码", "抖音号", "sec_uid"]);
  });
});
