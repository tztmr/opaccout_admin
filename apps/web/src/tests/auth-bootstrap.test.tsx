import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function renderApp(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("administrator bootstrap UI", () => {
  it("shows registration by default when no administrator exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ needsSetup: true })));
    renderApp("/login");

    expect(await screen.findByRole("heading", { name: "注册管理员" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" }))
      .not.toBeInTheDocument();
  });

  it("hides setup and shows login after an administrator exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ needsSetup: false })));
    renderApp("/setup");

    expect(await screen.findByRole("heading", { name: "账号管理台" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "注册管理员" }))
      .not.toBeInTheDocument();
  });

  it("does not submit when password confirmation differs", async () => {
    const fetchMock = vi.fn(async () => json({ needsSetup: true }));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/setup");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "a-long-admin-password");
    await user.type(screen.getByLabelText("确认密码"), "different-long-password");
    await user.click(screen.getByRole("button", { name: "注册管理员" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("submits setup and enters the account page", async () => {
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const path = String(input);
      if (path === "/api/auth/setup" && !init?.method) {
        return json({ needsSetup: true });
      }
      if (path === "/api/auth/setup" && init?.method === "POST") {
        return json({ authenticated: true, username: "admin" }, 201);
      }
      if (path === "/api/auth/session") {
        return json({ authenticated: true, username: "admin" });
      }
      if (path.startsWith("/api/accounts/owners")) {
        return json({ items: [] });
      }
      if (path.startsWith("/api/accounts")) {
        return json({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
          stats: { total: 0, unsold: 0, sold: 0, abnormal: 0 }
        });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/setup");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "a-long-admin-password");
    await user.type(screen.getByLabelText("确认密码"), "a-long-admin-password");
    await user.click(screen.getByRole("button", { name: "注册管理员" }));

    expect(await screen.findByText("抖音账号")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/setup",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("moves a stale registration page to login after a setup conflict", async () => {
    let setupChecks = 0;
    vi.stubGlobal("fetch", vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const path = String(input);
      if (path === "/api/auth/setup" && init?.method === "POST") {
        return json({
          error: {
            code: "ADMIN_ALREADY_EXISTS",
            message: "管理员已存在，请直接登录"
          },
          requestId: "request-id"
        }, 409);
      }
      if (path === "/api/auth/setup") {
        return json({ needsSetup: setupChecks++ === 0 });
      }
      return json({});
    }));
    renderApp("/setup");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "a-long-admin-password");
    await user.type(screen.getByLabelText("确认密码"), "a-long-admin-password");
    await user.click(screen.getByRole("button", { name: "注册管理员" }));

    expect(await screen.findByRole("heading", { name: "账号管理台" }))
      .toBeInTheDocument();
  });

  it("shows a retry action when setup state cannot load", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce(json({ needsSetup: true }));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/login");
    const user = userEvent.setup();

    expect(await screen.findByRole("alert")).toHaveTextContent("无法确认管理员状态");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "注册管理员" }))
      .toBeInTheDocument();
  });

  it("describes MongoDB as the administrator credential store", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return json({ authenticated: true, username: "admin" });
      }
      if (path === "/api/settings") {
        return json({ defaultPageSize: 20, sessionHours: 12 });
      }
      return json({});
    }));
    renderApp("/settings");

    expect(await screen.findByText(
      "管理员账号和密码在首次注册后加密保存在 MongoDB 中，不会显示在页面中。"
    )).toBeInTheDocument();
  });
});
