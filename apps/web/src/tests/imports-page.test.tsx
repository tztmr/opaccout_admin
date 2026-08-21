import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { buildPasteImportCsv, ImportsPage } from "../features/ImportsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(initialEntries = ["/imports"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <ImportsPage />
        <CurrentLocation />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("imports page", () => {
  it("prevents the browser from navigating away on window file drops", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));

    renderPage();
    await screen.findByText("上传账号文件");

    const event = new Event("drop", { bubbles: true, cancelable: true });
    const file = new File(["douyinId\n94946893573"], "accounts.csv", {
      type: "text/csv"
    });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [file] }
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("uploads a dropped file for preview", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/imports") return json([]);
      if (path === "/api/imports/preview") {
        return json({
          previewId: "preview-1",
          totalRows: 1,
          validRows: 1,
          errors: [],
          rows: [{ douyinId: "94946893573" }]
        }, 201);
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    const file = new File(["douyinId\n94946893573"], "accounts.csv", {
      type: "text/csv"
    });
    const uploadCard = await screen.findByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [file] }
    });

    await screen.findByRole("heading", { name: "导入预览" });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/imports/preview",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData)
        })
      );
    });
    const request = fetchMock.mock.calls.find(([path]) => path === "/api/imports/preview");
    expect((request?.[1]?.body as FormData).get("accountKind")).toBe("google");
  });

  it("uses the email account template and upload kind selected from the URL", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/imports") return json([]);
      if (path === "/api/imports/preview") {
        expect((init?.body as FormData).get("accountKind")).toBe("email");
        return json({ previewId: "preview-email", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201);
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage(["/imports?accountKind=email"]);

    expect(await screen.findByRole("combobox", { name: "账号类型" })).toHaveValue("email");
    expect(screen.getByRole("link", { name: "下载模板" })).toHaveAttribute(
      "href",
      "/api/imports/template?format=xlsx&accountKind=email"
    );

    const file = new File(["抖音号,邮箱\n94946893573,email@example.test"], "email-accounts.csv", { type: "text/csv" });
    const uploadCard = screen.getByText("上传账号文件").closest("form");
    fireEvent.drop(uploadCard as HTMLElement, { dataTransfer: { files: [file] } });
    await screen.findByRole("heading", { name: "导入预览" });
  });

  it("defaults an invalid account kind to Google and updates the URL when changed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));
    const user = userEvent.setup();

    renderPage(["/imports?accountKind=unknown"]);

    const selector = await screen.findByRole("combobox", { name: "账号类型" });
    expect(selector).toHaveValue("google");
    await user.selectOptions(selector, "email");
    expect(screen.getByTestId("current-location")).toHaveTextContent("/imports?accountKind=email");
  });

  it("builds Google pasted CSV with 注册地区 after 归属人 and defaults it blank", async () => {
    const csv = buildPasteImportCsv([
      "94946893573----2026-07-27----星图运营----a|b|1782303418----小王----未售卖----正常账号"
    ], "google");
    expect(csv).toContain('"抖音号","注册时间","OP名称","OP卡密","归属人","注册地区","售卖状态","备注"');
    expect(csv).toContain('"94946893573","2026-07-27","星图运营","a|b|1782303418","小王","","未售卖","正常账号"');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/imports") return json([]);
      if (path === "/api/imports/preview") {
        const form = init?.body as FormData;
        expect(form.get("accountKind")).toBe("google");
        return json({
          previewId: "preview-1",
          totalRows: 1,
          validRows: 1,
          errors: [],
          rows: [{ douyinId: "94946893573" }]
        }, 201);
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();

    const pasteCard = (await screen.findByText("文本快捷导入")).closest("form");
    await user.type(
      await screen.findByPlaceholderText(/抖音号----注册时间/),
      "94946893573----2026-07-27----星图运营----a|b|1782303418----小王----未售卖----正常账号"
    );
    await user.click(
      within(pasteCard as HTMLElement).getByRole("button", { name: "解析并预览" })
    );

    await screen.findByRole("heading", { name: "导入预览" });
  });

  it("builds an email pasted CSV without an email password and clears stale preview on kind change", async () => {
    const csv = buildPasteImportCsv([
      "94946893573----email@example.test----2026-07-27----星图运营----a|b|1782303418----小王----未售卖----正常账号"
    ], "email");
    expect(csv).toContain('"抖音号","邮箱","注册时间","OP名称","OP卡密","归属人","注册地区","售卖状态","备注"');
    expect(csv).not.toContain("邮箱密码");
    expect(csv).toContain('"94946893573","email@example.test","2026-07-27","星图运营","a|b|1782303418","小王","","未售卖","正常账号"');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/imports") return json([]);
      if (path === "/api/imports/preview") {
        const form = init?.body as FormData;
        expect(form.get("accountKind")).toBe("email");
        return json({ previewId: "preview-email", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201);
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const selector = await screen.findByRole("combobox", { name: "账号类型" });
    await user.selectOptions(selector, "email");
    const pasteCard = screen.getByText("文本快捷导入").closest("form");
    const textarea = screen.getByRole("textbox", { name: "粘贴导入内容" });
    await user.type(textarea, "94946893573----email@example.test----2026-07-27----星图运营----a|b|1782303418----小王----未售卖----正常账号");
    await user.click(within(pasteCard as HTMLElement).getByRole("button", { name: "解析并预览" }));
    await screen.findByRole("heading", { name: "导入预览" });

    await user.type(textarea, "stale input");
    await user.selectOptions(selector, "google");
    expect(screen.queryByRole("heading", { name: "导入预览" })).not.toBeInTheDocument();
    expect(textarea).toHaveValue("");
  });

  it("labels historical import jobs without a kind as Google accounts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/imports") {
        return json([{
          _id: "legacy-job", fileName: "legacy.csv", duplicateStrategy: "skip", status: "completed",
          total: 1, processed: 1, createdCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0,
          createdAt: "2026-08-21T08:00:00.000Z"
        }]);
      }
      throw new Error(`Unhandled request: ${String(input)}`);
    }));

    renderPage();

    expect(await screen.findByRole("columnheader", { name: "账号类型" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "抖音谷歌账号" })).toBeInTheDocument();
  });
});
