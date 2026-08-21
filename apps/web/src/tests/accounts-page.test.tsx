import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AccountsPage } from "../features/AccountsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function renderPage(initialEntries = ["/accounts/google"], accountKind: "google" | "email" = "google") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/accounts/*" element={<AccountsPage accountKind={accountKind} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function accountFixture(index: number, accountStatus: "normal" | "banned" = "normal") {
  return {
    _id: `account-${index}`,
    douyinId: String(90000000000 + index),
    secUid: `MS4wLjABAAAA-fixture-${index}`,
    registeredAt: "2026-07-01T00:00:00.000Z",
    opName: `API昵称${index}`,
    accountPassword: "",
    hasOpSecret: true,
    shortOpCode: String(100000000 + index),
    opProject: "douyin",
    opExpiresAt: "2026-08-01T00:00:00.000Z",
    owner: "小王",
    registeredRegion: "中国.香港",
    saleStatus: accountStatus === "banned" ? "disabled" : "unknown",
    accountStatus,
    accountCheckedAt: "2026-07-01T00:00:00.000Z",
    remark: "",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

describe("accounts page", () => {
  it("keeps account data flows and the email column scoped to the active kind", async () => {
    const account = { ...accountFixture(1), accountKind: "email" as const, email: "email-account@example.test" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners?")) return json({ items: [] });
      if (path.startsWith("/api/accounts?")) return json({
        items: [account], page: 1, pageSize: 20, total: 1, totalPages: 1,
        stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
      });
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage(["/accounts/email"], "email");

    expect(await screen.findByRole("heading", { name: "抖音邮箱号管理" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(18);
    expect(screen.getByRole("columnheader", { name: "邮箱" })).toBeInTheDocument();
    expect((await screen.findByText(account.email)).closest("td")).toHaveAttribute("title", account.email);
    await waitFor(() => expect(fetchMock.mock.calls.map(([input]) => String(input)).some((path) =>
      path.startsWith("/api/accounts?") && path.includes("accountKind=email")
    )).toBe(true));
    expect(fetchMock.mock.calls.map(([input]) => String(input)).some((path) =>
      path === "/api/accounts/owners?accountKind=email"
    )).toBe(true);
  });

  it("sets and restores the document title from the active account page config", async () => {
    const originalTitle = document.title;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: [] });
      if (path.startsWith("/api/accounts?")) return json({
        items: [], page: 1, pageSize: 20, total: 0, totalPages: 1,
        stats: { total: 0, unsold: 0, sold: 0, abnormal: 0 }
      });
      throw new Error(`Unhandled request: ${path}`);
    }));

    const view = renderPage(["/accounts/email"], "email");
    await screen.findByRole("heading", { name: "抖音邮箱号管理" });
    expect(document.title).toBe("抖音邮箱号管理");

    view.unmount();
    expect(document.title).toBe(originalTitle);
  });

  it("submits email kind and email on create without allowing kind changes on edit", async () => {
    const created: unknown[] = [];
    const updated: unknown[] = [];
    const account = { ...accountFixture(2), accountKind: "email" as const, email: "existing-email@example.test" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) return json({
        items: [account], page: 1, pageSize: 20, total: 1, totalPages: 1,
        stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
      });
      if (path === "/api/accounts/check-douyin") return json({ secUid: "MS4wLjABAAAA-new", accountStatus: "normal" });
      if (path === "/api/accounts") {
        created.push(JSON.parse(String(init?.body)));
        return json({});
      }
      if (path === "/api/accounts/account-2") {
        updated.push(JSON.parse(String(init?.body)));
        return json({});
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/accounts/email"], "email");
    await user.click(await screen.findByRole("button", { name: "新增邮箱号" }));
    expect(screen.getByLabelText("邮箱")).toHaveAttribute("type", "email");
    expect(screen.queryByLabelText("邮箱密码")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("抖音号"), "93900112233");
    await user.type(screen.getByLabelText("邮箱"), "new-email@example.test");
    await user.type(screen.getByLabelText("OP卡密"), "a|b|1782303418");
    await user.type(
      within(screen.getByRole("heading", { name: "新增邮箱号" }).closest(".drawer")!).getByLabelText("归属人"),
      "小王"
    );
    await user.click(screen.getByRole("button", { name: "检测" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ accountKind: "email", email: "new-email@example.test" });

    await user.click((await screen.findAllByRole("button", { name: "编辑" }))[0]!);
    await user.clear(screen.getByLabelText("邮箱"));
    await user.type(screen.getByLabelText("邮箱"), "updated-email@example.test");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]).toMatchObject({ email: "updated-email@example.test" });
    expect(updated[0]).not.toHaveProperty("accountKind");

    await user.click((await screen.findAllByRole("button", { name: "编辑" }))[0]!);
    const emailInput = screen.getByLabelText("邮箱");
    await user.clear(emailInput);
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("邮箱不能为空")).toBeInTheDocument();
    expect(updated).toHaveLength(1);

    await user.type(emailInput, "not-an-email");
    expect(emailInput).toBeInvalid();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("邮箱格式不正确")).toBeInTheDocument();
    expect(updated).toHaveLength(1);
  });

  it("renders semantic columns and preserves full values as truncation titles", async () => {
    const account = accountFixture(1);
    account.secUid = "MS4wLjABAAAA-a-long-sec-uid-for-truncation";
    account.accountPassword = "a-long-visible-password-for-truncation";
    account.opName = "一个很长的 OP 名称用于截断提示";
    account.remark = "一段很长的备注内容用于截断提示";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [account],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    const secUid = await screen.findByRole("link", { name: account.secUid });
    const table = secUid.closest("table")!;
    expect(table).toHaveClass("accounts-table");
    expect(table.querySelectorAll("colgroup col")).toHaveLength(17);
    expect(secUid.closest("td")).toHaveAttribute("title", account.secUid);
    expect(screen.getByText(account.accountPassword).closest("td")).toHaveAttribute("title", account.accountPassword);
    expect(screen.getByText(account.opName).closest("td")).toHaveAttribute("title", account.opName);
    expect(screen.getByText(account.remark).closest("td")).toHaveAttribute("title", account.remark);
  });

  it("shows visible account passwords and submits their create and edit values", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const createPayloads: unknown[] = [];
    const editPayloads: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "douyin-pass-1",
              hasOpSecret: true,
              shortOpCode: "123456789",
              opProject: "douyin",
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            },
            {
              _id: "account-2",
              douyinId: "93180119509",
              secUid: "",
              registeredAt: "2026-07-02T00:00:00.000Z",
              opName: "",
              accountPassword: "",
              hasOpSecret: true,
              shortOpCode: "987654321",
              opProject: "legacy-unknown",
              opExpiresAt: "2026-08-02T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-02T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-02T00:00:00.000Z",
              updatedAt: "2026-07-02T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
          stats: { total: 2, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/check-douyin") {
        return json({ secUid: "MS4wLjABAAAA-new", accountStatus: "normal" });
      }
      if (path === "/api/accounts") {
        expect(init?.method).toBe("POST");
        createPayloads.push(JSON.parse(String(init?.body)));
        return json({});
      }
      if (path === "/api/accounts/account-1") {
        expect(init?.method).toBe("PATCH");
        editPayloads.push(JSON.parse(String(init?.body)));
        return json({});
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    renderPage();

    expect(
      (await screen.findAllByRole("columnheader")).map((node) => node.textContent)
    ).toEqual([
      "", "序号", "抖音号", "密码", "sec_uid", "注册时间", "OP名称", "OP卡密",
      "短 OP", "项目", "OP到期时间", "归属人", "注册地区", "售卖状态", "账号状态", "备注", "操作"
    ]);
    expect(await screen.findByText("douyin-pass-1")).toBeVisible();
    expect(screen.queryByText("••••••", { selector: ".account-password-cell" }))
      .not.toBeInTheDocument();
    const secondRow = screen.getByRole("checkbox", { name: "选择账号 93180119509" }).closest("tr");
    expect(secondRow?.querySelector(".account-password-cell")).toHaveTextContent("—");
    expect(await screen.findByText("未知项目")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "复制短 OP 123456789" }));
    expect(writeText).toHaveBeenLastCalledWith("123456789");
    await user.click(screen.getByRole("button", { name: "复制短 OP 链接 123456789" }));
    expect(writeText).toHaveBeenLastCalledWith("https://op.tztright.qzz.io/123456789");

    await user.click(screen.getByRole("button", { name: "新增谷歌账号" }));
    expect(screen.getByLabelText("项目")).toHaveValue("douyin");
    const passwordInput = screen.getByLabelText("密码");
    expect(passwordInput).toHaveProperty("type", "text");
    expect(document.querySelector('input[name="shortOpCode"]')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("抖音号"), "93900112233");
    await user.type(passwordInput, "new-account-pass");
    await user.type(screen.getByLabelText("OP卡密"), "a|b|1782303418");
    await user.type(
      within(screen.getByRole("heading", { name: "新增谷歌账号" }).closest(".drawer")!).getByLabelText("归属人"),
      "小王"
    );
    await user.click(screen.getByRole("button", { name: "检测" }));
    expect(await screen.findByText(/MS4wLjABAAAA-new/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(createPayloads).toContainEqual(expect.objectContaining({
      accountPassword: "new-account-pass",
      accountKind: "google"
    })));
    expect(createPayloads[0]).not.toHaveProperty("email");
    const [firstEdit] = screen.getAllByRole("button", { name: "编辑" });
    expect(firstEdit).toBeDefined();
    await user.click(firstEdit!);
    expect(screen.getByLabelText("项目")).toHaveValue("douyin");
    expect(screen.getByLabelText("密码")).toHaveValue("douyin-pass-1");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(editPayloads).toHaveLength(1);
    });
    expect(editPayloads[0]).not.toHaveProperty("accountPassword");
    expect(editPayloads[0]).not.toHaveProperty("email");

    const [editAgain] = screen.getAllByRole("button", { name: "编辑" });
    await user.click(editAgain!);
    await user.clear(screen.getByLabelText("密码"));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(editPayloads).toHaveLength(2);
    });
    expect(editPayloads[1]).toMatchObject({ accountPassword: "" });
    expect(editPayloads[1]).not.toHaveProperty("email");
  });

  it("renders sec_uid as a Douyin profile link and opens a batch status dialog", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();

    const secUidLink = await screen.findByRole("link", {
      name: /MS4wLjABAAAA-fixture/
    });
    expect(secUidLink).toHaveAttribute(
      "href",
      "https://www.douyin.com/user/MS4wLjABAAAA-fixture"
    );
    expect(secUidLink).toHaveAttribute("target", "_blank");

    await user.click(
      screen.getByRole("checkbox", { name: "选择账号 94946893573" })
    );
    await user.click(screen.getByRole("button", { name: "修改售卖状态" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "售卖状态" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("submits multiline keyword searches through the account query", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: [] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 1,
          stats: { total: 0, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const searchBox = await screen.findByPlaceholderText(/一行一个/);
    await user.type(searchBox, "94946893573{enter}93180119509");
    await new Promise((resolve) => setTimeout(resolve, 380));

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      requestedUrls.some((url) =>
        url.includes("/api/accounts?") &&
        url.includes("sortDirection=asc") &&
        url.includes("keyword=94946893573%0A93180119509")
      )
    ).toBe(true);
  }, 10000);

  it("uses a POST query for oversized multiline searches", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: [] });
      if (path === "/api/accounts/query") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeTruthy();
        const body = JSON.parse(String(init?.body));
        expect(body.keyword).toContain("94946893573");
        expect(body.keyword).toContain("56946848178");
        expect(body.sortDirection).toBe("asc");
        expect(body.page).toBe(1);
        expect(body.pageSize).toBe(20);
        return json({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 1,
          stats: { total: 0, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 1,
          stats: { total: 0, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const searchBox = await screen.findByPlaceholderText(/一行一个/);
    const longKeyword = `${Array.from({ length: 220 }, (_, index) =>
      String(94946893573 + index)
    ).join("\n")}\n56946848178`;
    await user.type(searchBox, longKeyword.replace(/\n/g, "{enter}"));
    await new Promise((resolve) => setTimeout(resolve, 380));

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/accounts/query" && init?.method === "POST"
      )
    ).toBe(true);
  }, 10000);

  it("shows missing douyin ids after a multiline search", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: [] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 },
          searchSummary: {
            requested: 2,
            found: 1,
            missingKeywords: ["56946848178"]
          }
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const searchBox = await screen.findByPlaceholderText(/一行一个/);
    await user.type(searchBox, "94946893573{enter}56946848178");
    await new Promise((resolve) => setTimeout(resolve, 380));

    expect(
      await screen.findByText("未找到 1 个抖音号：56946848178")
    ).toBeInTheDocument();
  }, 10000);

  it("shows a progress bar while a single recheck is running", async () => {
    const recheckRequest = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/account-1/recheck") {
        return recheckRequest.promise;
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const button = await screen.findByRole("button", { name: "重新检测" });
    await user.click(button);

    expect(await screen.findByRole("progressbar")).toBeInTheDocument();

    recheckRequest.resolve(json({ ok: true }));
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("shows a progress bar while a batch OP recheck is running", async () => {
    const batchRequest = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck-op") {
        return batchRequest.promise;
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    await user.click(
      await screen.findByRole("checkbox", { name: "选择账号 94946893573" })
    );
    await user.click(
      within(screen.getByText(/已选择 1 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测 OP" })
    );

    expect(await screen.findByRole("progressbar")).toBeInTheDocument();

    batchRequest.resolve(json({ succeeded: [{ _id: "account-1" }], failed: [] }));
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("keeps selected accounts after a batch recheck completes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck") {
        expect(init?.method).toBe("POST");
        return json({ succeeded: [{ _id: "account-1" }], failed: [] });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const checkbox = await screen.findByRole("checkbox", { name: "选择账号 94946893573" });
    await user.click(checkbox);
    await user.click(
      within(screen.getByText(/已选择 1 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测" })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/accounts/batch-recheck",
        expect.objectContaining({ method: "POST" })
      );
    });

    expect(screen.getByRole("checkbox", { name: "选择账号 94946893573" })).toBeChecked();
    expect(screen.getByText(/已选择 1 条/)).toBeInTheDocument();
  });

  it("keeps selected accounts after a batch OP recheck completes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck-op") {
        expect(init?.method).toBe("POST");
        return json({ succeeded: [{ _id: "account-1" }], failed: [] });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const checkbox = await screen.findByRole("checkbox", { name: "选择账号 94946893573" });
    await user.click(checkbox);
    await user.click(
      within(screen.getByText(/已选择 1 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测 OP" })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/accounts/batch-recheck-op",
        expect.objectContaining({ method: "POST" })
      );
    });

    expect(screen.getByRole("checkbox", { name: "选择账号 94946893573" })).toBeChecked();
    expect(screen.getByText(/已选择 1 条/)).toBeInTheDocument();
  });

  it("shows a progress bar while a batch recheck is running with page size set to all", async () => {
    const batchRequest = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        const params = new URLSearchParams(path.split("?")[1] ?? "");
        expect(params.get("page")).toBe("1");
        expect(params.get("pageSize")).toBe("all");
        expect(params.get("sortDirection")).toBe("asc");
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture-1",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称1",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            },
            {
              _id: "account-2",
              douyinId: "93180119509",
              secUid: "MS4wLjABAAAA-fixture-2",
              registeredAt: "2026-07-02T00:00:00.000Z",
              opName: "API昵称2",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-02T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-02T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-02T00:00:00.000Z",
              updatedAt: "2026-07-02T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: "all",
          total: 2,
          totalPages: 1,
          stats: { total: 2, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck") {
        return batchRequest.promise;
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/accounts?pageSize=all"]);
    await user.click(await screen.findByRole("checkbox", { name: "选择当前页" }));
    await user.click(
      within(screen.getByText(/已选择 2 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测" })
    );

    expect(await screen.findByRole("progressbar")).toBeInTheDocument();

    batchRequest.resolve(json({ succeeded: [{ _id: "account-1" }, { _id: "account-2" }], failed: [] }));
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("shows a progress bar while a batch OP recheck is running with page size set to all", async () => {
    const batchRequest = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        const params = new URLSearchParams(path.split("?")[1] ?? "");
        expect(params.get("page")).toBe("1");
        expect(params.get("pageSize")).toBe("all");
        expect(params.get("sortDirection")).toBe("asc");
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture-1",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称1",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            },
            {
              _id: "account-2",
              douyinId: "93180119509",
              secUid: "MS4wLjABAAAA-fixture-2",
              registeredAt: "2026-07-02T00:00:00.000Z",
              opName: "API昵称2",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-02T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-02T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-02T00:00:00.000Z",
              updatedAt: "2026-07-02T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: "all",
          total: 2,
          totalPages: 1,
          stats: { total: 2, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck-op") {
        return batchRequest.promise;
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/accounts?pageSize=all"]);
    await user.click(await screen.findByRole("checkbox", { name: "选择当前页" }));
    await user.click(
      within(screen.getByText(/已选择 2 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测 OP" })
    );

    expect(await screen.findByRole("progressbar")).toBeInTheDocument();

    batchRequest.resolve(
      json({ succeeded: [{ _id: "account-1" }, { _id: "account-2" }], failed: [] })
    );
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("splits an all-page account recheck into requests of at most 500 ids", async () => {
    const items = Array.from({ length: 501 }, (_, index) => accountFixture(index + 1));
    const submittedBatches: string[][] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items,
          page: 1,
          pageSize: "all",
          total: items.length,
          totalPages: 1,
          stats: { total: items.length, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck") {
        const ids = JSON.parse(String(init?.body)).ids as string[];
        submittedBatches.push(ids);
        return json({
          succeeded: ids.map((_id) => ({ _id })),
          failed: []
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/accounts?pageSize=all"]);
    await user.click(await screen.findByRole("checkbox", { name: "选择当前页" }));
    await user.click(
      within(screen.getByText(/已选择 501 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测" })
    );

    expect(await screen.findByText("已完成 501 条账号检测")).toBeInTheDocument();
    expect(submittedBatches.map((ids) => ids.length)).toEqual([500, 1]);
    expect(submittedBatches.flat()).toEqual(items.map((item) => item._id));
  }, 20000);

  it("keeps only the uncertain ids selected when a later account recheck batch fails", async () => {
    const items = Array.from({ length: 501 }, (_, index) => accountFixture(index + 1));
    let batchNumber = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items,
          page: 1,
          pageSize: "all",
          total: items.length,
          totalPages: 1,
          stats: { total: items.length, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck") {
        batchNumber += 1;
        const ids = JSON.parse(String(init?.body)).ids as string[];
        if (batchNumber === 1) {
          return json({ succeeded: ids.map((_id) => ({ _id })), failed: [] });
        }
        return new Response(JSON.stringify({
          error: { code: "UPSTREAM_ERROR", message: "检测服务暂时不可用" },
          requestId: "qa"
        }), {
          status: 503,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/accounts?pageSize=all"]);
    await user.click(await screen.findByRole("checkbox", { name: "选择当前页" }));
    await user.click(
      within(screen.getByText(/已选择 501 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测" })
    );

    expect(
      await screen.findByText("已完成 500 条账号检测，失败 1 条，请重新检测失败项")
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: `选择账号 ${items[0]!.douyinId}` })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: `选择账号 ${items[500]!.douyinId}` })).toBeChecked();
    expect(screen.getByText("已选择 1 条")).toBeInTheDocument();
  }, 20000);

  it("excludes banned accounts from an all-page batch OP recheck", async () => {
    const normal = accountFixture(1, "normal");
    const banned = accountFixture(2, "banned");
    let submittedIds: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [normal, banned],
          page: 1,
          pageSize: "all",
          total: 2,
          totalPages: 1,
          stats: { total: 2, unsold: 0, sold: 0, abnormal: 1 }
        });
      }
      if (path === "/api/accounts/batch-recheck-op") {
        submittedIds = JSON.parse(String(init?.body)).ids as string[];
        return json({
          succeeded: submittedIds.map((_id) => ({ _id })),
          failed: [],
          skipped: []
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/accounts?pageSize=all"]);
    await user.click(await screen.findByRole("checkbox", { name: "选择当前页" }));
    await user.click(
      within(screen.getByText(/已选择 2 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测 OP" })
    );

    expect(await screen.findByText(/已跳过 1 个封禁账号/)).toBeInTheDocument();
    expect(submittedIds).toEqual([normal._id]);
  });

  it("unselects an account skipped as banned by the batch OP endpoint", async () => {
    const account = accountFixture(1, "normal");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [account],
          page: 1,
          pageSize: "all",
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck-op") {
        return json({
          succeeded: [],
          failed: [],
          skipped: [{ id: account._id, code: "BANNED_ACCOUNT" }]
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/accounts?pageSize=all"]);
    const checkbox = await screen.findByRole("checkbox", {
      name: `选择账号 ${account.douyinId}`
    });
    await user.click(checkbox);
    await user.click(
      within(screen.getByText(/已选择 1 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测 OP" })
    );

    expect(await screen.findByText(/已跳过 1 个封禁账号/)).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it("waits for the next paint before starting a batch recheck request with page size set to all", async () => {
    const batchRequest = deferred<Response>();
    let runFrame: ((time: number) => void) | null = null;
    let requestStarted = false;
    vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
      runFrame = callback;
      return 1;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        const params = new URLSearchParams(path.split("?")[1] ?? "");
        expect(params.get("page")).toBe("1");
        expect(params.get("pageSize")).toBe("all");
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture-1",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称1",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            },
            {
              _id: "account-2",
              douyinId: "93180119509",
              secUid: "MS4wLjABAAAA-fixture-2",
              registeredAt: "2026-07-02T00:00:00.000Z",
              opName: "API昵称2",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-02T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-02T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-02T00:00:00.000Z",
              updatedAt: "2026-07-02T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: "all",
          total: 2,
          totalPages: 1,
          stats: { total: 2, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck") {
        requestStarted = true;
        return batchRequest.promise;
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/accounts?pageSize=all"]);
    await user.click(await screen.findByRole("checkbox", { name: "选择当前页" }));
    await user.click(
      within(screen.getByText(/已选择 2 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测" })
    );

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(requestStarted).toBe(false);

    expect(runFrame).not.toBeNull();
    const frame = runFrame;
    if (!frame) {
      throw new Error("requestAnimationFrame was not scheduled");
    }
    (frame as (time: number) => void)(16);
    await waitFor(() => {
      expect(requestStarted).toBe(true);
    });

    batchRequest.resolve(json({ succeeded: [{ _id: "account-1" }, { _id: "account-2" }], failed: [] }));
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("shows 注册地区 and submits a batch registeredRegion update", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-update") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          ids: ["account-1"],
          registeredRegion: "中国.澳门"
        });
        return json({ updated: 1 });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByText("中国.香港")).toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", { name: "选择账号 94946893573" })
    );
    await user.click(screen.getByRole("button", { name: "修改注册地区" }));
    await user.type(screen.getByRole("textbox", { name: "注册地区" }), "中国.澳门");
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/accounts/batch-update",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("opens a batch accountStatus dialog and submits the update", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-update") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          ids: ["account-1"],
          accountStatus: "violation"
        });
        return json({ updated: 1 });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();

    await user.click(
      await screen.findByRole("checkbox", { name: "选择账号 94946893573" })
    );
    await user.click(screen.getByRole("button", { name: "修改账号状态" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "账号状态" }), "violation");
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/accounts/batch-update",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await screen.findByText(/已修改 1 条账号状态/)).toBeInTheDocument();
  });

  it("shows failed batch recheck count and keeps only failed accounts selected", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            },
            {
              _id: "account-2",
              douyinId: "93180119509",
              secUid: "MS4wLjABAAAA-fixture-2",
              registeredAt: "2026-07-02T00:00:00.000Z",
              opName: "API昵称2",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
          stats: { total: 2, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck") {
        expect(init?.method).toBe("POST");
        return json({
          succeeded: [{ _id: "account-1" }],
          failed: [{ id: "account-2", code: "RECHECK_FAILED" }]
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "选择账号 94946893573" }));
    await user.click(screen.getByRole("checkbox", { name: "选择账号 93180119509" }));
    await user.click(
      within(screen.getByText(/已选择 2 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测" })
    );

    expect(await screen.findByText(/已完成 1 条账号检测，失败 1 条，请重新检测失败项/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择账号 94946893573" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择账号 93180119509" })).toBeChecked();
    expect(screen.getByText(/已选择 1 条/)).toBeInTheDocument();
  });

  it("shows failed batch OP recheck count and keeps only failed accounts selected", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            },
            {
              _id: "account-2",
              douyinId: "93180119509",
              secUid: "MS4wLjABAAAA-fixture-2",
              registeredAt: "2026-07-02T00:00:00.000Z",
              opName: "API昵称2",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
          stats: { total: 2, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-recheck-op") {
        expect(init?.method).toBe("POST");
        return json({
          succeeded: [{ _id: "account-1" }],
          failed: [{ id: "account-2", code: "OP_RECHECK_FAILED" }]
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "选择账号 94946893573" }));
    await user.click(screen.getByRole("checkbox", { name: "选择账号 93180119509" }));
    await user.click(
      within(screen.getByText(/已选择 2 条/).closest(".batch-bar") as HTMLElement)
        .getByRole("button", { name: "重新检测 OP" })
    );

    expect(await screen.findByText(/已完成 1 条OP检测，失败 1 条，请重新检测失败项/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择账号 94946893573" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择账号 93180119509" })).toBeChecked();
    expect(screen.getByText(/已选择 1 条/)).toBeInTheDocument();
  });

  it("opens a batch remark dialog and submits the remark update", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/accounts/owners")) return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
              accountPassword: "",
              hasOpSecret: true,
              opExpiresAt: "2026-08-01T00:00:00.000Z",
              owner: "小王",
              registeredRegion: "中国.香港",
              saleStatus: "unknown",
              accountStatus: "normal",
              accountCheckedAt: "2026-07-01T00:00:00.000Z",
              remark: "",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          stats: { total: 1, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      if (path === "/api/accounts/batch-update") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          ids: ["account-1"],
          remark: "统一补充备注"
        });
        return json({ updated: 1 });
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();

    await user.click(
      await screen.findByRole("checkbox", { name: "选择账号 94946893573" })
    );
    await user.click(screen.getByRole("button", { name: "批量备注" }));
    await user.type(screen.getByRole("textbox", { name: "备注" }), "统一补充备注");
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/accounts/batch-update",
        expect.objectContaining({ method: "POST" })
      );
    });

    expect(screen.getByRole("checkbox", { name: "选择账号 94946893573" })).toBeChecked();
    expect(screen.getByText(/已选择 1 条/)).toBeInTheDocument();
  });
});
