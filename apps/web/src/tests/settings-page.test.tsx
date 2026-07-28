import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SimplePage } from "../features/SimplePage";

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
      <MemoryRouter>
        <SimplePage type="settings" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("settings page", () => {
  it("renders and submits a multiline QQ proxy pool textarea", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/settings" && !init?.method) {
        return json({
          defaultPageSize: 20,
          sessionHours: 12,
          qqOpSocksProxyPool: "127.0.0.1:1080"
        });
      }
      if (path === "/api/settings" && init?.method === "PATCH") {
        return json(JSON.parse(String(init.body)));
      }
      throw new Error(`Unhandled request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();

    await screen.findByPlaceholderText(/一行一个代理/);
    const getTextarea = () =>
      screen.getByPlaceholderText(/一行一个代理/) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(getTextarea()).not.toBeDisabled();
    });
    const textarea = getTextarea();

    await user.clear(textarea);
    await user.type(
      textarea,
      "127.0.0.1:1080\n198.64.244.205:50101:tztright:t5sYiBK8tD"
    );
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            defaultPageSize: 20,
            sessionHours: 12,
            qqOpSocksProxyPool:
              "127.0.0.1:1080\n198.64.244.205:50101:tztright:t5sYiBK8tD"
          }),
          credentials: "include"
        })
      );
    });
  });
});
