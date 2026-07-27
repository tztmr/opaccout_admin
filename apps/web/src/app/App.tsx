import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileClock, ListChecks, LogOut, Settings, Users } from "lucide-react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api } from "../api";
import { AccountsPage } from "../features/AccountsPage";
import { ImportsPage } from "../features/ImportsPage";
import { SimplePage } from "../features/SimplePage";
import { LoginPage } from "../features/LoginPage";

type Session = { authenticated: true; username: string };

function Shell() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/api/auth/session"),
    retry: false
  });
  if (session.isLoading) return <div className="screen-center">正在加载…</div>;
  if (session.isError) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    window.location.assign("/login");
  };
  const links = [
    ["/accounts", "抖音账号", Users],
    ["/imports", "导入记录", FileClock],
    ["/logs", "操作日志", ListChecks],
    ["/settings", "系统设置", Settings]
  ] as const;
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">抖</span><strong>账号管理台</strong></div>
      <nav>{links.map(([to, label, Icon]) =>
        <NavLink key={to} to={to}><Icon size={19}/><span>{label}</span></NavLink>
      )}</nav>
      <button className="logout" onClick={logout}><LogOut size={18}/><span>退出登录</span></button>
    </aside>
    <main className="main"><Routes>
      <Route path="/accounts" element={<AccountsPage/>}/>
      <Route path="/imports" element={<ImportsPage/>}/>
      <Route path="/logs" element={<SimplePage type="logs"/>}/>
      <Route path="/settings" element={<SimplePage type="settings"/>}/>
      <Route path="*" element={<Navigate to="/accounts" replace/>}/>
    </Routes></main>
  </div>;
}

export function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/*" element={<Shell/>}/>
  </Routes>;
}
