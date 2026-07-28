import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PagedResponse } from "@douyin-admin/shared";
import { api } from "../api";

type AuditLog = {
  _id: string;
  action: string;
  targetType: string;
  targetIds: string[];
  changedFields: string[];
  count: number;
  ip: string;
  requestId: string;
  createdAt: string;
};

type Settings = {
  defaultPageSize: number;
  sessionHours: number;
  qqOpSocksProxyPool: string;
  updatedAt?: string;
};

const actionLabels: Record<string, string> = {
  "account.created": "新增账号",
  "account.updated": "编辑账号",
  "account.deleted": "删除账号",
  "account.batch_updated": "批量更新",
  "account.batch_deleted": "批量删除",
  "account.rechecked": "检测账号",
  "account.op_rechecked": "检测OP",
  "account.batch_rechecked": "批量检测",
  "account.secret_revealed": "查看OP卡密",
  "account.exported": "导出账号"
};

export function SimplePage({ type }: { type: "logs" | "settings" }) {
  return type === "logs" ? <LogsPage/> : <SettingsPage/>;
}

function LogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const params = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (action) params.set("action", action);
  const query = useQuery({ queryKey: ["audit-logs", params.toString()], queryFn: () => api<PagedResponse<AuditLog>>(`/api/audit-logs?${params}`) });
  const data = query.data;
  return <section>
    <header className="page-head"><div><h1>操作日志</h1><p>查看敏感操作和账号数据变更记录</p></div></header>
    <div className="panel">
      <div className="toolbar"><select value={action} onChange={(event)=>{setAction(event.target.value);setPage(1)}}><option value="">全部操作</option>{Object.entries(actionLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></div>
      <div className="table-scroll"><table><thead><tr><th>操作</th><th>对象</th><th>数量</th><th>变更字段</th><th>IP</th><th>请求ID</th><th>时间</th></tr></thead>
      <tbody>{data?.items.length ? data.items.map((row)=><tr key={row._id}><td>{actionLabels[row.action]||row.action}</td><td>{row.targetType}</td><td>{row.count}</td><td>{row.changedFields.join("、")||"—"}</td><td>{row.ip}</td><td className="mono" title={row.requestId}>{row.requestId.slice(0,12)}…</td><td>{new Date(row.createdAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</td></tr>) : <tr><td colSpan={7} className="empty">{query.isLoading?"正在加载…":"暂无操作日志"}</td></tr>}</tbody></table></div>
      <div className="pager"><span>共 {data?.total??0} 条</span><div><button disabled={page<=1} onClick={()=>setPage((value)=>value-1)}>上一页</button><b>{page} / {data?.totalPages||1}</b><button disabled={page>=(data?.totalPages||1)} onClick={()=>setPage((value)=>value+1)}>下一页</button></div></div>
    </div>
  </section>;
}

function SettingsPage() {
  const client = useQueryClient();
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/api/settings") });
  const mutation = useMutation({
    mutationFn: (value: Settings) => api<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(value) }),
    onSuccess: (value) => { client.setQueryData(["settings"], value); setNotice("设置已保存"); },
    onError: (error) => setNotice(error instanceof Error ? error.message : "保存失败")
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      defaultPageSize: Number(data.get("defaultPageSize")),
      sessionHours: Number(data.get("sessionHours")),
      qqOpSocksProxyPool: String(data.get("qqOpSocksProxyPool") ?? "")
    });
  };
  return <section>
    <header className="page-head"><div><h1>系统设置</h1><p>调整后台列表和登录会话的基础参数</p></div></header>
    <form className="settings-card" onSubmit={submit} key={query.data ? `${query.data.updatedAt ?? "loaded"}-${query.data.defaultPageSize}-${query.data.sessionHours}-${query.data.qqOpSocksProxyPool}` : "loading"}>
      <div><h2>后台偏好</h2><p>管理员账号和密码在首次注册后加密保存在 MongoDB 中，不会显示在页面中。</p></div>
      {notice&&<div className="notice-static">{notice}</div>}
      <label>默认每页条数<input type="number" name="defaultPageSize" min={10} max={100} defaultValue={query.data?.defaultPageSize??20} disabled={query.isLoading}/><small>范围 10–100 条</small></label>
      <label>登录会话时长<input type="number" name="sessionHours" min={1} max={168} defaultValue={query.data?.sessionHours??12} disabled={query.isLoading}/><small>范围 1–168 小时</small></label>
      <label>QQ OP SOCKS 代理池<textarea name="qqOpSocksProxyPool" defaultValue={query.data?.qqOpSocksProxyPool??""} disabled={query.isLoading} placeholder={"一行一个代理\n127.0.0.1:1080\n198.64.244.205:50101:tztright:t5sYiBK8tD"}/><small>一行一个代理。留空时回退到部署环境中的默认代理池。</small></label>
      <button className="primary" disabled={mutation.isPending||query.isLoading}><Save size={16}/>{mutation.isPending?"保存中…":"保存设置"}</button>
    </form>
  </section>;
}
