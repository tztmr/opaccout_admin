import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import type { PublicOpResolveResponse } from "@douyin-admin/shared";
import { extractPublicShortCode, publicOpApiUrl } from "./public-op-routing";

const SHORT_OP_CODE_PATTERN = /^[1-9][0-9]{8}$/;
const WAKE_RECOVERY_DELAY_MS = 1_500;

type ShortOpPageProps = {
  pathname?: string;
  hostname?: string;
  onWake?: (wakeUrl: string) => void;
  wakeRecoveryDelayMs?: number;
};

function assignWakeUrl(wakeUrl: string): void {
  window.location.assign(wakeUrl);
}

function readableError(payload: unknown): string {
  if (
    payload
    && typeof payload === "object"
    && "error" in payload
    && typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return "解析失败，请稍后重试";
}

export function ShortOpPage({
  pathname,
  hostname = window.location.hostname,
  onWake = assignWakeUrl,
  wakeRecoveryDelayMs = WAKE_RECOVERY_DELAY_MS
}: ShortOpPageProps) {
  const location = useLocation();
  const initialCode = extractPublicShortCode(pathname ?? location.pathname) ?? "";
  return (
    <ShortOpForm
      key={initialCode}
      initialCode={initialCode}
      hostname={hostname}
      onWake={onWake}
      wakeRecoveryDelayMs={wakeRecoveryDelayMs}
    />
  );
}

type ShortOpFormProps = Required<Pick<ShortOpPageProps,
  "hostname" | "onWake" | "wakeRecoveryDelayMs"
>> & {
  initialCode: string;
};

function ShortOpForm({
  initialCode,
  hostname,
  onWake,
  wakeRecoveryDelayMs
}: ShortOpFormProps) {
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<"idle" | "resolving" | "opening">("idle");
  const [error, setError] = useState("");
  const [projectName, setProjectName] = useState("");
  const wakeRecoveryTimer = useRef<number | undefined>(undefined);
  const canSubmit = SHORT_OP_CODE_PATTERN.test(code) && state === "idle";

  useEffect(() => () => {
    if (wakeRecoveryTimer.current !== undefined) {
      window.clearTimeout(wakeRecoveryTimer.current);
      wakeRecoveryTimer.current = undefined;
    }
  }, []);

  const handleCodeChange = (value: string) => {
    setCode(value.replace(/\D/g, "").slice(0, 9));
    setError("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setState("resolving");
    setError("");
    try {
      const response = await fetch(publicOpApiUrl(hostname), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "omit",
        cache: "no-store",
        body: JSON.stringify({ code })
      });
      if (!response.ok) {
        setError(readableError(await response.json().catch(() => undefined)));
        setState("idle");
        return;
      }

      const result = await response.json() as PublicOpResolveResponse;
      setProjectName(result.project.name);
      setState("opening");
      onWake(result.wakeUrl);
      wakeRecoveryTimer.current = window.setTimeout(() => {
        wakeRecoveryTimer.current = undefined;
        setState("idle");
        setError("未能自动打开抖音，请确认已安装抖音后重试");
      }, wakeRecoveryDelayMs);
    } catch {
      setError("网络异常，请检查网络后重试");
      setState("idle");
    }
  };

  const isOpening = state === "opening";
  const statusText = error
    ? error
    : state === "resolving"
      ? "正在解析短码…"
      : isOpening
        ? `正在打开${projectName || "抖音"}…`
        : "";
  const statusClass = error
    ? "short-op-message error"
    : isOpening
      ? "short-op-message success"
      : "short-op-message";

  return (
    <main className="short-op-page">
      <section className="short-op-card">
        <h1>短码登录</h1>
        <p className="short-op-intro">请输入收到的 9 位短码，我们会自动打开抖音。</p>
        <form id="short-op-form" onSubmit={submit}>
          <label htmlFor="short-op-code">9 位短 OP</label>
          <input
            id="short-op-code"
            name="code"
            type="text"
            value={code}
            onChange={(event) => handleCodeChange(event.target.value)}
            inputMode="numeric"
            pattern="[1-9][0-9]{8}"
            autoComplete="one-time-code"
            maxLength={9}
            placeholder="123456789"
            aria-describedby="short-op-message"
            autoFocus
          />
          <button
            id="submit-short-code"
            className="short-op-submit"
            type="submit"
            disabled={!canSubmit}
          >
            {state === "resolving"
              ? "解析中…"
              : isOpening
                ? "正在打开…"
                : error
                  ? "重试上号"
                  : "立即打开"}
          </button>
          <p
            id="short-op-message"
            className={statusClass}
            role={error ? "alert" : "status"}
            aria-live="polite"
          >
            {statusText}
          </p>
        </form>
        <a className="short-op-download" href="/downloads/short-op.apk" download="短位op修复.apk">
          下载短位 OP APK
        </a>
      </section>
    </main>
  );
}
