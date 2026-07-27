import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";

export function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "");
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const session = await api<{ authenticated: true; username: string }>(
        "/api/auth/setup",
        {
          method: "POST",
          body: JSON.stringify({ username, password })
        }
      );
      queryClient.setQueryData(["auth-setup"], { needsSetup: false });
      queryClient.setQueryData(["session"], session);
      await queryClient.cancelQueries({ queryKey: ["session"] });
      navigate("/accounts", { replace: true });
    } catch (value) {
      if (
        value instanceof ApiError &&
        value.body.error.code === "ADMIN_ALREADY_EXISTS"
      ) {
        await queryClient.invalidateQueries({ queryKey: ["auth-setup"] });
        navigate("/login", { replace: true });
        return;
      }
      setError(value instanceof Error ? value.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">抖</div>
        <h1>注册管理员</h1>
        <p>首次使用请创建唯一管理员，注册完成后此页面将关闭</p>
        <label>
          用户名
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          确认密码
          <input
            name="confirmation"
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "注册中…" : "注册管理员"}
        </button>
      </form>
    </div>
  );
}
