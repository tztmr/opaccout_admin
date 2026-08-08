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
  it("does not render or submit the removed QQ proxy pool", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/settings" && !init?.method) {
        return json({
          defaultPageSize: 20,
          sessionHours: 12,
          qqOpSocksProxyPool: "socks5://127.0.0.1:1080"
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

    await screen.findByRole("button", { name: "保存设置" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "保存设置" })).not.toBeDisabled();
    });
    expect(screen.queryByText("QQ OP SOCKS 代理池")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            defaultPageSize: 20,
            sessionHours: 12
          }),
          credentials: "include"
        })
      );
    });
  });
});
