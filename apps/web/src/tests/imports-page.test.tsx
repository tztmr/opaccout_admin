import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportsPage } from "../features/ImportsPage";

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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={client}>
      <ImportsPage />
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
  });

  it("builds pasted CSV with 注册地区 after 归属人 and defaults it blank", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/imports") return json([]);
      if (path === "/api/imports/preview") {
        const form = init?.body as FormData;
        const file = form.get("file");
        const text = file instanceof File ? await file.text() : "";
        expect(text).toContain('"抖音号","注册时间","OP名称","OP卡密","归属人","注册地区","售卖状态","备注"');
        expect(text).toContain('"94946893573","2026-07-27","星图运营","a|b|1782303418","小王","","未售卖","正常账号"');
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
});
