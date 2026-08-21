import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { DEFAULT_ACCOUNT_COLUMN_ORDER } from "@douyin-admin/shared";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{`${location.pathname}${location.search}`}</output>;
}

function TestNavigation() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/imports?accountKind=google")}>外部打开谷歌导入</button>;
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
        <TestNavigation />
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
      "94946893573----account-pass----2026-07-27----星图运营----a|b|1782303418----+86 13037174892----抖音----小王----未售卖----正常账号"
    ], "google", DEFAULT_ACCOUNT_COLUMN_ORDER.google);
    expect(csv).toContain('"抖音号","密码","注册时间","OP名称","OP卡密","手机号","项目","归属人","注册地区","售卖状态","备注"');
    expect(csv).toContain('"94946893573","account-pass","2026-07-27","星图运营","a|b|1782303418","+86 13037174892","抖音","小王","","未售卖","正常账号"');

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
      await screen.findByRole("textbox", { name: "粘贴导入内容" }),
      "94946893573----account-pass----2026-07-27----星图运营----a|b|1782303418----+86 13037174892----抖音----小王----未售卖----正常账号"
    );
    await user.click(
      within(pasteCard as HTMLElement).getByRole("button", { name: "解析并预览" })
    );

    await screen.findByRole("heading", { name: "导入预览" });
  });

  it("builds an email pasted CSV without an email password and clears stale preview on kind change", async () => {
    const csv = buildPasteImportCsv([
      "94946893573----email@example.test----account-pass----2026-07-27----星图运营----a|b|1782303418----+852 65478974----抖音----小王----未售卖----正常账号"
    ], "email", DEFAULT_ACCOUNT_COLUMN_ORDER.email);
    expect(csv).toContain('"抖音号","邮箱","密码","注册时间","OP名称","OP卡密","手机号","项目","归属人","注册地区","售卖状态","备注"');
    expect(csv).not.toContain("邮箱密码");
    expect(csv).toContain('"94946893573","email@example.test","account-pass","2026-07-27","星图运营","a|b|1782303418","+852 65478974","抖音","小王","","未售卖","正常账号"');

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
    await user.type(textarea, "94946893573----email@example.test----account-pass----2026-07-27----星图运营----a|b|1782303418----+852 65478974----抖音----小王----未售卖----正常账号");
    await user.click(within(pasteCard as HTMLElement).getByRole("button", { name: "解析并预览" }));
    await screen.findByRole("heading", { name: "导入预览" });

    await user.type(textarea, "stale input");
    await user.selectOptions(selector, "google");
    expect(screen.queryByRole("heading", { name: "导入预览" })).not.toBeInTheDocument();
    expect(textarea).toHaveValue("");
  });

  it("uses each active saved order for phone-aware paste guides and CSV without uploading the order", async () => {
    const googleOrder = ["remark", "mobile", "douyin", ...DEFAULT_ACCOUNT_COLUMN_ORDER.google];
    const emailOrder = ["email", "mobile", "remark", "douyin", ...DEFAULT_ACCOUNT_COLUMN_ORDER.email];
    const googleCsv = buildPasteImportCsv([
      "合成备注----+86 13037174892----94946893573"
    ], "google", googleOrder);
    const emailCsv = buildPasteImportCsv([
      "synthetic@example.test----+852 65478974----邮箱备注----94946893574"
    ], "email", emailOrder);
    expect(googleCsv.split("\n")[0]).toMatch(/^"备注","手机号","抖音号","密码"/);
    expect(googleCsv).toContain('"+86 13037174892"');
    expect(emailCsv.split("\n")[0]).toMatch(/^"邮箱","手机号","备注","抖音号","密码"/);
    expect(emailCsv).not.toContain("邮箱密码");

    let uploadedCsv = "";
    let uploadKeys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/settings/account-columns") {
        return json({ google: googleOrder, email: emailOrder });
      }
      if (path === "/api/imports") return json([]);
      if (path === "/api/imports/preview") {
        const form = init?.body as FormData;
        uploadKeys = Array.from(form.keys()).sort();
        uploadedCsv = await readBlob(form.get("file") as File);
        return json({ previewId: "saved-order-preview", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201);
      }
      throw new Error(`Unhandled request: ${path}`);
    }));
    const user = userEvent.setup();

    renderPage();
    expect(await screen.findByText(/备注、手机号、抖音号、密码/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载模板" })).toHaveAttribute(
      "href",
      "/api/imports/template?format=xlsx&accountKind=google"
    );
    const textarea = screen.getByRole("textbox", { name: "粘贴导入内容" });
    await user.type(textarea, "合成备注----+86 13037174892----94946893573");
    await user.click(within(screen.getByText("文本快捷导入").closest("form")!).getByRole("button", { name: "解析并预览" }));

    await waitFor(() => expect(uploadedCsv).toContain('"备注","手机号","抖音号","密码"'));
    expect(uploadedCsv).toContain('"合成备注","+86 13037174892","94946893573"');
    expect(uploadKeys).toEqual(["accountKind", "file"]);
  });

  it("clears email import state when navigation changes the account kind in the URL", async () => {
    let previewCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return json([]);
      if (path === "/api/imports/preview") {
        previewCalls += 1;
        if (previewCalls === 1) {
          return json({ previewId: "email-preview", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201);
        }
        return json({ error: { code: "IMPORT_PARSE_FAILED", message: "预览失败" }, requestId: "test" }, 500);
      }
      throw new Error(`Unhandled request: ${path}`);
    }));
    const user = userEvent.setup();

    renderPage(["/imports?accountKind=email"]);
    const uploadCard = await screen.findByText("上传账号文件");
    const staleFileInput = document.querySelector<HTMLInputElement>('input[name="file"]');
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["email"], "email-accounts.csv", { type: "text/csv" })] }
    });
    await screen.findByRole("heading", { name: "导入预览" });

    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["invalid"], "invalid.csv", { type: "text/csv" })] }
    });
    await screen.findByText("预览失败");
    const textarea = screen.getByRole("textbox", { name: "粘贴导入内容" });
    await user.type(textarea, "stale input");

    await user.click(screen.getByRole("button", { name: "外部打开谷歌导入" }));

    expect(screen.getByRole("combobox", { name: "账号类型" })).toHaveValue("google");
    expect(screen.queryByRole("heading", { name: "导入预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认导入/ })).not.toBeInTheDocument();
    expect(textarea).toHaveValue("");
    expect(document.querySelector<HTMLInputElement>('input[name="file"]')).not.toBe(staleFileInput);
    expect(screen.queryByText("预览失败")).not.toBeInTheDocument();
  });

  it("ignores an old preview failure after URL navigation changes the account kind", async () => {
    const previewResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") return previewResponse.promise;
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/imports?accountKind=email"]);
    const uploadCard = await screen.findByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["email"], "email-accounts.csv", { type: "text/csv" })] }
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/imports/preview",
      expect.objectContaining({ method: "POST" })
    ));
    await user.click(screen.getByRole("button", { name: "外部打开谷歌导入" }));

    await act(async () => {
      previewResponse.reject(new Error("旧预览失败"));
      await Promise.resolve();
    });

    expect(screen.getByRole("combobox", { name: "账号类型" })).toHaveValue("google");
    expect(screen.queryByText("旧预览失败")).not.toBeInTheDocument();
  });

  it("ignores an old execute completion after URL navigation changes the account kind", async () => {
    const executeResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") {
        return Promise.resolve(json({ previewId: "email-preview", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201));
      }
      if (path === "/api/imports/execute") return executeResponse.promise;
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/imports?accountKind=email"]);
    const uploadCard = await screen.findByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["email"], "email-accounts.csv", { type: "text/csv" })] }
    });
    await screen.findByRole("button", { name: "确认导入 1 行" });
    await user.click(screen.getByRole("button", { name: "确认导入 1 行" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/imports/execute",
      expect.objectContaining({ method: "POST" })
    ));
    await user.click(screen.getByRole("button", { name: "外部打开谷歌导入" }));

    await act(async () => {
      executeResponse.resolve(json({ jobId: "email-job" }, 202));
      await Promise.resolve();
    });

    expect(screen.getByRole("combobox", { name: "账号类型" })).toHaveValue("google");
    expect(screen.queryByText("导入任务已提交，将在后台继续处理")).not.toBeInTheDocument();
  });

  it("blocks a new preview while an earlier execute succeeds", async () => {
    const executeResponse = deferred<Response>();
    let previewCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") {
        previewCalls += 1;
        return Promise.resolve(json(
          previewCalls === 1
            ? { previewId: "email-preview-a", totalRows: 1, validRows: 1, errors: [], rows: [] }
            : { previewId: "email-preview-b", totalRows: 2, validRows: 2, errors: [], rows: [] },
          201
        ));
      }
      if (path === "/api/imports/execute") return executeResponse.promise;
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/imports?accountKind=email"]);
    const uploadCard = await screen.findByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["a"], "email-a.csv", { type: "text/csv" })] }
    });
    await screen.findByRole("button", { name: "确认导入 1 行" });
    await user.click(screen.getByRole("button", { name: "确认导入 1 行" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/imports/execute",
      expect.objectContaining({ method: "POST" })
    ));
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["b"], "email-b.csv", { type: "text/csv" })] }
    });
    expect(previewCalls).toBe(1);

    await act(async () => {
      executeResponse.resolve(json({ jobId: "email-job-a" }, 202));
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { name: "导入预览" })).not.toBeInTheDocument();
    expect(screen.getByText("导入任务已提交，将在后台继续处理")).toBeInTheDocument();
  });

  it("blocks a new preview while an earlier execute fails", async () => {
    const executeResponse = deferred<Response>();
    let previewCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") {
        previewCalls += 1;
        return Promise.resolve(json(
          previewCalls === 1
            ? { previewId: "email-preview-a", totalRows: 1, validRows: 1, errors: [], rows: [] }
            : { previewId: "email-preview-b", totalRows: 2, validRows: 2, errors: [], rows: [] },
          201
        ));
      }
      if (path === "/api/imports/execute") return executeResponse.promise;
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/imports?accountKind=email"]);
    const uploadCard = await screen.findByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["a"], "email-a.csv", { type: "text/csv" })] }
    });
    await screen.findByRole("button", { name: "确认导入 1 行" });
    await user.click(screen.getByRole("button", { name: "确认导入 1 行" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/imports/execute",
      expect.objectContaining({ method: "POST" })
    ));
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["b"], "email-b.csv", { type: "text/csv" })] }
    });
    expect(previewCalls).toBe(1);

    await act(async () => {
      executeResponse.reject(new Error("旧导入失败"));
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "导入预览" })).toBeInTheDocument();
    expect(screen.getByText("旧导入失败")).toBeInTheDocument();
  });

  it("keeps a submitted preview isolated from a blocked replacement while execute succeeds", async () => {
    const executeResponse = deferred<Response>();
    let previewCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") {
        previewCalls += 1;
        if (previewCalls === 1) {
          return Promise.resolve(json({ previewId: "email-preview-a", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201));
        }
        return Promise.resolve(json({ previewId: "email-preview-b", totalRows: 2, validRows: 2, errors: [], rows: [] }, 201));
      }
      if (path === "/api/imports/execute") return executeResponse.promise;
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/imports?accountKind=email"]);
    const uploadCard = await screen.findByText("上传账号文件");
    const uploadForm = uploadCard.closest("form") ?? uploadCard;
    fireEvent.drop(uploadForm, { dataTransfer: { files: [new File(["a"], "email-a.csv", { type: "text/csv" })] } });
    await user.click(await screen.findByRole("button", { name: "确认导入 1 行" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/imports/execute",
      expect.objectContaining({ method: "POST" })
    ));

    fireEvent.drop(uploadForm, { dataTransfer: { files: [new File(["b"], "email-b.csv", { type: "text/csv" })] } });
    expect(previewCalls).toBe(1);

    await act(async () => {
      executeResponse.resolve(json({ jobId: "email-job-a" }, 202));
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { name: "导入预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认导入/ })).not.toBeInTheDocument();
    expect(screen.getByText("导入任务已提交，将在后台继续处理")).toBeInTheDocument();
  });

  it("keeps a submitted preview actionable after a blocked replacement and execute error", async () => {
    const executeResponse = deferred<Response>();
    let previewCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") {
        previewCalls += 1;
        if (previewCalls === 1) {
          return Promise.resolve(json({ previewId: "email-preview-a", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201));
        }
        return Promise.resolve(json({ previewId: "email-preview-b", totalRows: 2, validRows: 2, errors: [], rows: [] }, 201));
      }
      if (path === "/api/imports/execute") return executeResponse.promise;
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/imports?accountKind=email"]);
    const uploadCard = await screen.findByText("上传账号文件");
    const uploadForm = uploadCard.closest("form") ?? uploadCard;
    fireEvent.drop(uploadForm, { dataTransfer: { files: [new File(["a"], "email-a.csv", { type: "text/csv" })] } });
    await user.click(await screen.findByRole("button", { name: "确认导入 1 行" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/imports/execute",
      expect.objectContaining({ method: "POST" })
    ));

    fireEvent.drop(uploadForm, { dataTransfer: { files: [new File(["b"], "email-b.csv", { type: "text/csv" })] } });
    expect(previewCalls).toBe(1);

    await act(async () => {
      executeResponse.reject(new Error("旧导入失败"));
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "导入预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认导入 1 行" })).toBeEnabled();
    expect(screen.getByText("旧导入失败")).toBeInTheDocument();
  });

  it("ignores an old date-override success after navigation changes the account kind", async () => {
    const overrideResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/accounts/batch-override-dates") return overrideResponse.promise;
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage(["/imports?accountKind=email"]);
    const textarea = await screen.findByRole("textbox", { name: "粘贴导入内容" });
    const pasteForm = screen.getByText("文本快捷导入").closest("form")!;
    await user.type(textarea, "94946893573----2026-07-27");
    await user.click(within(pasteForm).getByRole("button", { name: "解析并预览" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/batch-override-dates",
      expect.objectContaining({ method: "POST" })
    ));

    await user.click(screen.getByRole("button", { name: "外部打开谷歌导入" }));
    await user.type(textarea, "new paste after navigation");
    await act(async () => {
      overrideResponse.resolve(json({ matched: 1, updated: 1 }));
      await Promise.resolve();
    });

    expect(textarea).toHaveValue("new paste after navigation");
    expect(screen.queryByText(/时间覆盖完成/)).not.toBeInTheDocument();
  });

  it("prevents a new upload while a date override is pending and keeps its failure current", async () => {
    const overrideResponse = deferred<Response>();
    const previewResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/accounts/batch-override-dates") return overrideResponse.promise;
      if (path === "/api/imports/preview") return previewResponse.promise;
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const textarea = await screen.findByRole("textbox", { name: "粘贴导入内容" });
    const pasteForm = screen.getByText("文本快捷导入").closest("form")!;
    await user.type(textarea, "94946893573----2026-07-27");
    await user.click(within(pasteForm).getByRole("button", { name: "解析并预览" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/batch-override-dates",
      expect.objectContaining({ method: "POST" })
    ));

    const uploadCard = screen.getByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["new"], "new-import.csv", { type: "text/csv" })] }
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/imports/preview");
    await act(async () => {
      overrideResponse.reject(new Error("时间覆盖失败"));
      await Promise.resolve();
    });

    expect(textarea).toHaveValue("94946893573----2026-07-27");
    expect(screen.getByText("时间覆盖失败")).toBeInTheDocument();
  });

  it("keeps only the latest same-kind date override result", async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    let overrideCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/accounts/batch-override-dates") {
        overrideCalls += 1;
        return overrideCalls === 1 ? firstResponse.promise : secondResponse.promise;
      }
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const textarea = await screen.findByRole("textbox", { name: "粘贴导入内容" });
    const pasteForm = screen.getByText("文本快捷导入").closest("form")!;
    await user.type(textarea, "94946893573----2026-07-27");
    await user.click(within(pasteForm).getByRole("button", { name: "解析并预览" }));
    await user.clear(textarea);
    await user.type(textarea, "93180119509----2026-07-28");
    await user.click(within(pasteForm).getByRole("button", { name: "解析并预览" }));
    await waitFor(() => expect(overrideCalls).toBe(2));

    await act(async () => {
      secondResponse.resolve(json({ matched: 2, updated: 2 }));
      await Promise.resolve();
    });
    expect(await screen.findByText("时间覆盖完成：匹配到 2 个账号，成功更新 2 个")).toBeInTheDocument();
    await user.type(textarea, "fresh paste");

    await act(async () => {
      firstResponse.resolve(json({ matched: 1, updated: 1 }));
      await Promise.resolve();
    });

    expect(textarea).toHaveValue("fresh paste");
    expect(screen.getByText("时间覆盖完成：匹配到 2 个账号，成功更新 2 个")).toBeInTheDocument();
    expect(screen.queryByText("时间覆盖完成：匹配到 1 个账号，成功更新 1 个")).not.toBeInTheDocument();
  });

  it("blocks a date override during execute and consumes the submitted preview on success", async () => {
    const executeResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") return Promise.resolve(json({ previewId: "preview-a", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201));
      if (path === "/api/imports/execute") return executeResponse.promise;
      if (path === "/api/accounts/batch-override-dates") return Promise.resolve(json({ matched: 1, updated: 1 }));
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const uploadCard = await screen.findByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["preview"], "preview.csv", { type: "text/csv" })] }
    });
    const confirm = await screen.findByRole("button", { name: "确认导入 1 行" });
    await user.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.map(([input]) => String(input)).filter((path) => path === "/api/imports/execute")).toHaveLength(1));

    const textarea = screen.getByRole("textbox", { name: "粘贴导入内容" });
    const pasteForm = screen.getByText("文本快捷导入").closest("form")!;
    await user.type(textarea, "94946893573----2026-07-27");
    expect(within(pasteForm).getByRole("button", { name: "解析并预览" })).toBeDisabled();
    await user.click(within(pasteForm).getByRole("button", { name: "解析并预览" }));
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/accounts/batch-override-dates");

    await act(async () => {
      executeResponse.resolve(json({ jobId: "job-a" }, 202));
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { name: "导入预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认导入/ })).not.toBeInTheDocument();
    expect(screen.getByText("导入任务已提交，将在后台继续处理")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input)).filter((path) => path === "/api/imports/execute")).toHaveLength(1);
  });

  it("blocks a date override during execute and keeps a failed preview actionable", async () => {
    const executeResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") return Promise.resolve(json({ previewId: "preview-a", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201));
      if (path === "/api/imports/execute") return executeResponse.promise;
      if (path === "/api/accounts/batch-override-dates") return Promise.resolve(json({ matched: 1, updated: 1 }));
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const uploadCard = await screen.findByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["preview"], "preview.csv", { type: "text/csv" })] }
    });
    await user.click(await screen.findByRole("button", { name: "确认导入 1 行" }));
    const textarea = screen.getByRole("textbox", { name: "粘贴导入内容" });
    const pasteForm = screen.getByText("文本快捷导入").closest("form")!;
    await user.type(textarea, "94946893573----2026-07-27");
    expect(within(pasteForm).getByRole("button", { name: "解析并预览" })).toBeDisabled();

    await act(async () => {
      executeResponse.reject(new Error("提交导入失败"));
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "导入预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认导入 1 行" })).toBeEnabled();
    expect(screen.getByText("提交导入失败")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/accounts/batch-override-dates");
  });

  it("blocks execute during a date override and retains its preview after override success", async () => {
    const overrideResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") return Promise.resolve(json({ previewId: "preview-a", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201));
      if (path === "/api/accounts/batch-override-dates") return overrideResponse.promise;
      if (path === "/api/imports/execute") return Promise.resolve(json({ jobId: "job-a" }, 202));
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const uploadCard = await screen.findByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["preview"], "preview.csv", { type: "text/csv" })] }
    });
    const confirm = await screen.findByRole("button", { name: "确认导入 1 行" });
    const textarea = screen.getByRole("textbox", { name: "粘贴导入内容" });
    const pasteForm = screen.getByText("文本快捷导入").closest("form")!;
    await user.type(textarea, "94946893573----2026-07-27");
    await user.click(within(pasteForm).getByRole("button", { name: "解析并预览" }));
    await waitFor(() => expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/api/accounts/batch-override-dates"));
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/imports/execute");

    await act(async () => {
      overrideResponse.resolve(json({ matched: 1, updated: 1 }));
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "导入预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认导入 1 行" })).toBeEnabled();
    expect(screen.getByText("时间覆盖完成：匹配到 1 个账号，成功更新 1 个")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/imports/execute");
  });

  it("blocks execute during a date override and retains its preview after override failure", async () => {
    const overrideResponse = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/imports") return Promise.resolve(json([]));
      if (path === "/api/imports/preview") return Promise.resolve(json({ previewId: "preview-a", totalRows: 1, validRows: 1, errors: [], rows: [] }, 201));
      if (path === "/api/accounts/batch-override-dates") return overrideResponse.promise;
      if (path === "/api/imports/execute") return Promise.resolve(json({ jobId: "job-a" }, 202));
      return Promise.reject(new Error(`Unhandled request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPage();
    const uploadCard = await screen.findByText("上传账号文件");
    fireEvent.drop(uploadCard.closest("form") ?? uploadCard, {
      dataTransfer: { files: [new File(["preview"], "preview.csv", { type: "text/csv" })] }
    });
    const confirm = await screen.findByRole("button", { name: "确认导入 1 行" });
    const textarea = screen.getByRole("textbox", { name: "粘贴导入内容" });
    const pasteForm = screen.getByText("文本快捷导入").closest("form")!;
    await user.type(textarea, "94946893573----2026-07-27");
    await user.click(within(pasteForm).getByRole("button", { name: "解析并预览" }));
    expect(confirm).toBeDisabled();

    await act(async () => {
      overrideResponse.reject(new Error("时间覆盖失败"));
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "导入预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认导入 1 行" })).toBeEnabled();
    expect(screen.getByText("时间覆盖失败")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/imports/execute");
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
