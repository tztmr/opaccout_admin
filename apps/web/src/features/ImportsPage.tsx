import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../api";

type Preview = {
  previewId: string;
  totalRows: number;
  validRows: number;
  errors: Array<{ row: number; field?: string; message: string }>;
  rows: Array<Record<string, unknown>>;
};

type ImportJob = {
  _id: string;
  fileName: string;
  duplicateStrategy: "skip" | "update";
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  processed: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errorSummary?: string;
  createdAt: string;
};

const jobLabels: Record<ImportJob["status"], string> = {
  queued: "等待中",
  running: "导入中",
  completed: "已完成",
  failed: "失败"
};

export function ImportsPage() {
  const client = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [strategy, setStrategy] = useState<"skip" | "update">("skip");
  const [notice, setNotice] = useState("");
  const jobs = useQuery({
    queryKey: ["import-jobs"],
    queryFn: () => api<ImportJob[]>("/api/imports"),
    refetchInterval: (query) => query.state.data?.some((job) => job.status === "queued" || job.status === "running") ? 1500 : false
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<Preview>("/api/imports/preview", { method: "POST", body: form });
    },
    onSuccess: (value) => { setPreview(value); setNotice(""); },
    onError: (error) => setNotice(error instanceof Error ? error.message : "文件解析失败")
  });
  const execute = useMutation({
    mutationFn: () => api<{ jobId: string }>("/api/imports/execute", {
      method: "POST",
      body: JSON.stringify({ previewId: preview?.previewId, duplicateStrategy: strategy })
    }),
    onSuccess: () => {
      setPreview(null);
      setNotice("导入任务已提交，将在后台继续处理");
      void client.invalidateQueries({ queryKey: ["import-jobs"] });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : "提交导入失败")
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("file");
    if (file instanceof File && file.size) upload.mutate(file);
  };

  return <section>
    <header className="page-head"><div><h1>导入记录</h1><p>批量导入 Excel、XLS 或 CSV，并追踪后台处理结果</p></div><a className="button" href="/api/imports/template?format=xlsx"><Download size={16}/>下载模板</a></header>
    {notice && <div className="notice-static">{notice}</div>}
    <div className="import-grid">
      <form className="upload-card" onSubmit={submit}>
        <div className="upload-icon"><UploadCloud size={28}/></div>
        <h2>上传账号文件</h2>
        <p>文件最大 10 MB。OP卡密只在服务端加密暂存，预览不显示明文。</p>
        <label className="file-picker"><input name="file" type="file" accept=".xlsx,.xls,.csv" required/><span>选择文件</span></label>
        <button className="primary" disabled={upload.isPending}>{upload.isPending ? "解析中…" : "解析并预览"}</button>
      </form>
      <div className="guide-card">
        <FileSpreadsheet size={25}/><h2>表头要求</h2>
        <p>抖音号、注册时间、OP名称、OP卡密、归属人、售卖状态、备注。</p>
        <p>sec_uid、OP到期时间和账号状态会由系统自动获取或计算，无需导入。</p>
      </div>
    </div>
    {preview && <div className="panel preview-panel">
      <div className="panel-head"><div><h2>导入预览</h2><p>共 {preview.totalRows} 行，可导入 {preview.validRows} 行，错误 {preview.errors.length} 行</p></div></div>
      {preview.errors.length > 0 && <div className="error-list"><AlertTriangle size={18}/><div>{preview.errors.slice(0, 8).map((item) => <p key={`${item.row}-${item.field}-${item.message}`}>第 {item.row} 行{item.field ? ` · ${item.field}` : ""}：{item.message}</p>)}</div></div>}
      <div className="preview-options"><label><input type="radio" checked={strategy==="skip"} onChange={()=>setStrategy("skip")}/>重复抖音号跳过</label><label><input type="radio" checked={strategy==="update"} onChange={()=>setStrategy("update")}/>重复抖音号更新</label><button className="primary" disabled={!preview.validRows||execute.isPending} onClick={()=>execute.mutate()}>{execute.isPending ? "提交中…" : `确认导入 ${preview.validRows} 行`}</button></div>
    </div>}
    <div className="panel">
      <div className="panel-head"><div><h2>历史任务</h2><p>最近 100 次导入</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>文件名</th><th>状态</th><th>总数</th><th>新增</th><th>更新</th><th>跳过</th><th>失败</th><th>提交时间</th></tr></thead>
      <tbody>{jobs.data?.length ? jobs.data.map((job) => <tr key={job._id}><td>{job.fileName}</td><td><span className={`tag job-${job.status}`}>{job.status==="completed"&&<CheckCircle2 size={13}/>} {jobLabels[job.status]}</span></td><td>{job.total}</td><td>{job.createdCount}</td><td>{job.updatedCount}</td><td>{job.skippedCount}</td><td title={job.errorSummary}>{job.failedCount}</td><td>{new Date(job.createdAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</td></tr>) : <tr><td className="empty" colSpan={8}>{jobs.isLoading ? "正在加载…" : "暂无导入任务"}</td></tr>}</tbody></table></div>
    </div>
  </section>;
}
