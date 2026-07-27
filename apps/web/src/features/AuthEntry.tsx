import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import { LoginPage } from "./LoginPage";
import { SetupPage } from "./SetupPage";

export type SetupState = { needsSetup: boolean };

export function AuthEntry({ mode }: { mode: "setup" | "login" }) {
  const queryClient = useQueryClient();
  const setup = useQuery({
    queryKey: ["auth-setup"],
    queryFn: () => api<SetupState>("/api/auth/setup"),
    retry: false
  });

  if (setup.isPending) {
    return <div className="screen-center">正在确认管理员状态…</div>;
  }
  if (setup.isError) {
    return (
      <div className="login-page">
        <div className="login-card auth-state-error">
          <div className="form-error" role="alert">
            无法确认管理员状态，请检查服务后重试
          </div>
          <button className="primary" onClick={() => void setup.refetch()}>
            重试
          </button>
        </div>
      </div>
    );
  }
  if (!setup.data) {
    return <div className="screen-center">正在确认管理员状态…</div>;
  }
  if (setup.data.needsSetup && mode === "login") {
    return <Navigate to="/setup" replace />;
  }
  if (!setup.data.needsSetup && mode === "setup") {
    // Setup success may update needsSetup before navigation settles.
    // Prefer an existing session so registration lands on /accounts.
    const session = queryClient.getQueryData<{ authenticated: true; username: string }>([
      "session"
    ]);
    return <Navigate to={session ? "/accounts" : "/login"} replace />;
  }
  return mode === "setup" ? <SetupPage /> : <LoginPage />;
}
