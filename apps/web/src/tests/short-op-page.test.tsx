import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { App } from "../app/App";
import { ShortOpPage } from "../features/ShortOpPage";
import {
  extractPublicShortCode,
  isPublicOpHost,
  publicOpApiUrl
} from "../features/public-op-routing";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function renderApp(pathname: string, hostname: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[pathname]}><App hostname={hostname} /></MemoryRouter>
    </QueryClientProvider>
  );
}

function ShortOpNavigationHarness() {
  return <>
    <Link to="/987654321">切换短 OP</Link>
    <Routes>
      <Route path="/:code" element={<ShortOpPage hostname="op.tztright.qzz.io" onWake={vi.fn()} />} />
    </Routes>
  </>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public short OP routing", () => {
  it("recognizes only the trusted public host and a nine-digit path code", () => {
    expect(isPublicOpHost("op.tztright.qzz.io")).toBe(true);
    expect(isPublicOpHost("OP.TZTRIGHT.QZZ.IO")).toBe(true);
    expect(isPublicOpHost("tkacc.tztright.top")).toBe(false);
    expect(extractPublicShortCode("/123456789")).toBe("123456789");
    expect(extractPublicShortCode("/012345678")).toBeUndefined();
    expect(extractPublicShortCode("/123456789/extra")).toBeUndefined();
    expect(publicOpApiUrl("op.tztright.qzz.io")).toBe("/api/op/resolve");
  });

  it("serves the local legacy /op entry without bootstrapping an admin session", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderApp("/op", "localhost");

    expect(screen.getByLabelText("9 位短 OP")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves a local legacy short OP path without bootstrapping an admin session", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderApp("/op/123456789", "127.0.0.1");

    expect(screen.getByLabelText("9 位短 OP")).toHaveValue("123456789");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefills a shared path code and resolves it with a same-origin request", async () => {
    const fetchMock = vi.fn(async () => json({
      status: "success",
      code: "123456789",
      opData: "secret-op-data",
      project: { key: "douyin", name: "抖音", appId: "1105602870" },
      expiresAt: "2026-08-23T12:16:58.000Z",
      wakeUrl: "tencent1105602870://qzapp/mqzone/0?fixture"
    }));
    vi.stubGlobal("fetch", fetchMock);
    const wake = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/123456789"]}>
        <ShortOpPage hostname="op.tztright.qzz.io" onWake={wake} />
      </MemoryRouter>
    );

    expect(screen.getByLabelText("9 位短 OP")).toHaveValue("123456789");
    await user.click(screen.getByRole("button", { name: "立即上号" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/op/resolve", expect.objectContaining({
      method: "POST",
      credentials: "omit",
      body: JSON.stringify({ code: "123456789" })
    }));
    expect(await screen.findByText("正在打开抖音")).toBeInTheDocument();
    expect(wake).toHaveBeenCalledWith("tencent1105602870://qzapp/mqzone/0?fixture");
    expect(document.body.textContent).not.toContain("secret-op-data");
  });

  it("replaces the prefilled code when a mounted route navigates to another short code", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/123456789"]}>
        <ShortOpNavigationHarness />
      </MemoryRouter>
    );

    expect(screen.getByLabelText("9 位短 OP")).toHaveValue("123456789");
    await user.click(screen.getByRole("link", { name: "切换短 OP" }));
    expect(screen.getByLabelText("9 位短 OP")).toHaveValue("987654321");
  });

  it("accepts only nine non-zero-leading digits and keeps submit disabled otherwise", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ShortOpPage hostname="op.tztright.qzz.io" onWake={vi.fn()} />
      </MemoryRouter>
    );

    const input = screen.getByLabelText("9 位短 OP");
    const submit = screen.getByRole("button", { name: "立即上号" });
    expect(submit).toBeDisabled();
    await user.type(input, "012345678");
    expect(submit).toBeDisabled();
    await user.clear(input);
    await user.type(input, "123456789abc0");
    expect(input).toHaveValue("123456789");
    expect(submit).toBeEnabled();
  });

  it("recovers the action with an error when resolution fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "短 OP 无效或已过期" }, 404)));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ShortOpPage pathname="/123456789" hostname="op.tztright.qzz.io" onWake={vi.fn()} />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "立即上号" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("短 OP 无效或已过期");
    expect(screen.getByRole("button", { name: "重试上号" })).toBeEnabled();
  });

  it("restores the action if the wake URL does not leave the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      status: "success",
      code: "123456789",
      opData: "secret-op-data",
      project: { key: "douyin", name: "抖音", appId: "1105602870" },
      expiresAt: "2026-08-23T12:16:58.000Z",
      wakeUrl: "tencent1105602870://qzapp/mqzone/0?fixture"
    })));
    const wake = vi.fn();
    render(
      <MemoryRouter>
        <ShortOpPage
          pathname="/123456789"
          hostname="op.tztright.qzz.io"
          onWake={wake}
          wakeRecoveryDelayMs={0}
        />
      </MemoryRouter>
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "立即上号" }));

    expect(wake).toHaveBeenCalledOnce();
    expect(await screen.findByRole("alert")).toHaveTextContent("未能自动打开抖音");
    expect(screen.getByRole("button", { name: "重试上号" })).toBeEnabled();
  });

  it("cancels the wake recovery timer when the page unmounts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      status: "success",
      code: "123456789",
      opData: "secret-op-data",
      project: { key: "douyin", name: "抖音", appId: "1105602870" },
      expiresAt: "2026-08-23T12:16:58.000Z",
      wakeUrl: "tencent1105602870://qzapp/mqzone/0?fixture"
    })));
    const clearTimeoutMock = vi.spyOn(window, "clearTimeout");
    const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wake = vi.fn();
    const rendered = render(
      <MemoryRouter>
        <ShortOpPage
          pathname="/123456789"
          hostname="op.tztright.qzz.io"
          onWake={wake}
          wakeRecoveryDelayMs={10}
        />
      </MemoryRouter>
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "立即上号" }));
    expect(await screen.findByText("正在打开抖音")).toBeInTheDocument();
    rendered.unmount();
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(wake).toHaveBeenCalledOnce();
    expect(clearTimeoutMock).toHaveBeenCalled();
    expect(consoleErrorMock).not.toHaveBeenCalled();
  });

  it("does not bootstrap an admin session on the public host", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/", "op.tztright.qzz.io");

    expect(screen.getByLabelText("9 位短 OP")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects the administrator root to login and blocks public accounts routes", async () => {
    const adminFetch = vi.fn(async () => json({ needsSetup: false }));
    vi.stubGlobal("fetch", adminFetch);
    renderApp("/", "tkacc.tztright.top");
    expect(await screen.findByRole("heading", { name: "账号管理台" })).toBeInTheDocument();

    cleanup();
    const publicFetch = vi.fn();
    vi.stubGlobal("fetch", publicFetch);
    renderApp("/accounts", "op.tztright.qzz.io");
    await waitFor(() => expect(screen.getByLabelText("9 位短 OP")).toBeInTheDocument());
    expect(publicFetch).not.toHaveBeenCalled();
  });
});
