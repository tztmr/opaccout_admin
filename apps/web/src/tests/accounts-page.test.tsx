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

function renderPage(initialEntries = ["/accounts"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/accounts" element={<AccountsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("accounts page", () => {
  it("shows short OP and project columns, copies their canonical values, and submits the default project", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
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
      if (path === "/api/accounts/account-1") {
        expect(init?.method).toBe("PATCH");
        expect(JSON.parse(String(init?.body))).toMatchObject({ opProject: "douyin" });
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
      "", "序号", "抖音号", "sec_uid", "注册时间", "OP名称", "OP卡密",
      "短 OP", "项目", "OP到期时间", "归属人", "注册地区", "售卖状态", "账号状态", "备注", "操作"
    ]);
    expect(await screen.findByText("未知项目")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "复制短 OP 123456789" }));
    expect(writeText).toHaveBeenLastCalledWith("123456789");
    await user.click(screen.getByRole("button", { name: "复制短 OP 链接 123456789" }));
    expect(writeText).toHaveBeenLastCalledWith("https://op.tztright.qzz.io/123456789");

    await user.click(screen.getByRole("button", { name: "新增账号" }));
    expect(screen.getByLabelText("项目")).toHaveValue("douyin");
    expect(document.querySelector('input[name="shortOpCode"]')).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    const [firstEdit] = screen.getAllByRole("button", { name: "编辑" });
    expect(firstEdit).toBeDefined();
    await user.click(firstEdit!);
    expect(screen.getByLabelText("项目")).toHaveValue("douyin");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/accounts/account-1",
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  it("renders sec_uid as a Douyin profile link and opens a batch status dialog", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
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
      if (path === "/api/accounts/owners") return json({ items: [] });
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
      if (path === "/api/accounts/owners") return json({ items: [] });
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
      if (path === "/api/accounts/owners") return json({ items: [] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
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
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
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
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
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
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
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
        return json({ ok: true });
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
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
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
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
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

    batchRequest.resolve(json({ ok: true }));
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("shows a progress bar while a batch OP recheck is running with page size set to all", async () => {
    const batchRequest = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
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
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
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

    batchRequest.resolve(json({ ok: true }));
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("shows 注册地区 and submits a batch registeredRegion update", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
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

  it("opens a batch remark dialog and submits the remark update", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/accounts/owners") return json({ items: ["小王"] });
      if (path.startsWith("/api/accounts?")) {
        return json({
          items: [
            {
              _id: "account-1",
              douyinId: "94946893573",
              secUid: "MS4wLjABAAAA-fixture",
              registeredAt: "2026-07-01T00:00:00.000Z",
              opName: "API昵称",
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
