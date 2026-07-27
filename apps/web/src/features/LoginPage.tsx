import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({
        username: data.get("username"), password: data.get("password")
      })});
      navigate("/accounts", { replace: true });
    } catch (value) { setError(value instanceof Error ? value.message : "登录失败"); }
    finally { setBusy(false); }
  };
  return <div className="login-page"><form className="login-card" onSubmit={submit}>
    <div className="login-logo">抖</div><h1>账号管理台</h1><p>使用管理员账号登录</p>
    <label>用户名<input name="username" autoComplete="username" required autoFocus/></label>
    <label>密码<input name="password" type="password" autoComplete="current-password" required/></label>
    {error && <div className="form-error" role="alert">{error}</div>}
    <button className="primary" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
  </form></div>;
}
