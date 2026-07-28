import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
