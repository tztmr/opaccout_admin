import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { isValidElement, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import type { AccountColumnId, AccountDto, AccountKind, AccountStats, PagedResponse } from "@douyin-admin/shared";
import {
  ACCOUNT_PAGE_SIZE_ALL,
  ACCOUNT_PAGE_SIZE_OPTIONS,
  ACCOUNT_STATUS_LABELS,
  DEFAULT_OP_PROJECT,
  DEFAULT_REGISTERED_REGION,
  EmailAddressSchema,
  MobileSchema,
  OP_PROJECTS,
  SALE_STATUS_LABELS,
  DEFAULT_ACCOUNT_COLUMN_ORDER,
  normalizeAccountColumnOrder
} from "@douyin-admin/shared";
import { api } from "../api";
import {
  buildAccountExportParams,
  DEFAULT_ACCOUNT_SALE_STATUS
} from "./account-filter-state";
import { ACCOUNT_PAGE_CONFIG } from "./account-page-config";
import { AccountColumnOrderDialog } from "./AccountColumnOrderDialog";
import { buildAccountTableColumns } from "./account-table-columns";

type ListResponse = PagedResponse<AccountDto> & { stats: AccountStats };
const blank = {
  douyinId: "",
  email: "",
  mobile: "",
  registeredAt: new Date().toISOString().slice(0, 10),
  opName: "",
  opSecret: "",
  accountPassword: "",
  opProject: DEFAULT_OP_PROJECT,
  owner: "",
  registeredRegion: DEFAULT_REGISTERED_REGION,
  saleStatus: DEFAULT_ACCOUNT_SALE_STATUS,
  remark: ""
};
type AccountFormValue = typeof blank;
type AccountSubmitValue = Omit<
  AccountFormValue,
  "email" | "opSecret" | "accountPassword"
> & {
  email?: string;
  opSecret?: string;
  accountPassword?: string;
};
type BatchDialogState =
  | { type: "status"; value: AccountFormValue["saleStatus"] }
  | { type: "accountStatus"; value: keyof typeof ACCOUNT_STATUS_LABELS }
  | { type: "owner"; value: string }
  | { type: "registeredRegion"; value: string }
  | { type: "remark"; value: string };

type BatchRecheckResult = {
  succeeded: Array<{ _id: string }>;
  failed: Array<{ id: string; code: string }>;
  skipped?: Array<{ id: string; code: string }>;
};
type AccountColumnOrders = Record<AccountKind, AccountColumnId[]>;

const BATCH_RECHECK_REQUEST_SIZE = 500;

async function requestBatchRecheck(
  path: "/api/accounts/batch-recheck" | "/api/accounts/batch-recheck-op",
  ids: string[]
): Promise<BatchRecheckResult> {
  const aggregate: BatchRecheckResult = { succeeded: [], failed: [], skipped: [] };
  for (let index = 0; index < ids.length; index += BATCH_RECHECK_REQUEST_SIZE) {
    const batchIds = ids.slice(index, index + BATCH_RECHECK_REQUEST_SIZE);
    let result: BatchRecheckResult;
    try {
      result = await api<BatchRecheckResult>(path, {
        method: "POST",
        body: JSON.stringify({ ids: batchIds })
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "BATCH_REQUEST_FAILED";
      aggregate.failed.push(
        ...ids.slice(index).map((id) => ({ id, code }))
      );
      break;
    }
    aggregate.succeeded.push(...(result.succeeded ?? []));
    aggregate.failed.push(...(result.failed ?? []));
    aggregate.skipped?.push(...(result.skipped ?? []));
  }
  return aggregate;
}

function summarizeBatchRecheck(
  result: BatchRecheckResult,
  kind: "account" | "op",
  locallySkipped = 0
) {
  const label = kind === "op" ? "OP" : "账号";
  const succeeded = result.succeeded ?? [];
  const failed = result.failed ?? [];
  const skipped = locallySkipped + (result.skipped?.length ?? 0);
  const completed = failed.length
    ? `已完成 ${succeeded.length} 条${label}检测，失败 ${failed.length} 条，请重新检测失败项`
    : `已完成 ${succeeded.length} 条${label}检测`;
  return skipped ? `${completed}，已跳过 ${skipped} 个封禁账号` : completed;
}

const URL_KEYWORD_MAX_LENGTH = 1500;

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const scheduleFrame =
      window.requestAnimationFrame?.bind(window) ??
      ((callback: FrameRequestCallback) => window.setTimeout(callback, 16));
    scheduleFrame(() => resolve());
  });
}

function renderedTitle(value: ReactNode) {
  return isValidElement<{ title?: string }>(value) ? value.props.title : undefined;
}

function buildAccountListPayload({
  accountKind,
  keyword,
  page,
  pageSize,
  saleStatus,
  accountStatus,
  owner,
  registeredFrom,
  registeredTo,
  sortDirection
}: {
  accountKind: AccountKind;
  keyword: string;
  page: number;
  pageSize: number | typeof ACCOUNT_PAGE_SIZE_ALL;
  saleStatus: string;
  accountStatus: string;
  owner: string;
  registeredFrom: string;
  registeredTo: string;
  sortDirection: "asc" | "desc";
}) {
  return {
    accountKind,
    ...(keyword ? { keyword } : {}),
    ...(saleStatus ? { saleStatus } : {}),
    ...(accountStatus ? { accountStatus } : {}),
    ...(owner ? { owner } : {}),
    ...(registeredFrom ? { registeredFrom } : {}),
    ...(registeredTo ? { registeredTo } : {}),
    page,
    pageSize,
    sortDirection
  };
}

export function AccountsPage({ accountKind }: { accountKind: AccountKind }) {
  const client = useQueryClient();
  const config = ACCOUNT_PAGE_CONFIG[accountKind];
  const [urlParams, setUrlParams] = useSearchParams();
  const [keyword, setKeyword] = useState(urlParams.get("keyword")||"");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<null | { mode:"create"|"edit"; value: typeof blank; id?:string }>(null);
  const [batchDialog, setBatchDialog] = useState<BatchDialogState | null>(null);
  const [columnOrderOpen, setColumnOrderOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [progressText, setProgressText] = useState("");
  useEffect(() => {
    const previousTitle = document.title;
    document.title = config.title;
    return () => {
      document.title = previousTitle;
    };
  }, [config.title]);
  const page = Math.max(1,Number(urlParams.get("page"))||1);
  const rawPageSize = urlParams.get("pageSize") || "20";
  const pageSize =
    rawPageSize === ACCOUNT_PAGE_SIZE_ALL
      ? ACCOUNT_PAGE_SIZE_ALL
      : ACCOUNT_PAGE_SIZE_OPTIONS.includes(Number(rawPageSize) as (typeof ACCOUNT_PAGE_SIZE_OPTIONS)[number])
        ? Number(rawPageSize)
        : 20;
  const saleStatus = urlParams.get("saleStatus")||"";
  const accountStatus = urlParams.get("accountStatus")||"";
  const owner = urlParams.get("owner")||"";
  const registeredFrom = urlParams.get("registeredFrom")||"";
  const registeredTo = urlParams.get("registeredTo")||"";
  const trimmedKeyword = keyword.trim();
  const search = trimmedKeyword || urlParams.get("keyword")||"";
  const sortDirection = urlParams.get("sortDirection")==="desc" ? "desc" : "asc";
  const updateParams=(patch:Record<string,string>)=>setUrlParams((current)=>{const next=new URLSearchParams(current);for(const [key,value] of Object.entries(patch)){if(value)next.set(key,value);else next.delete(key)}return next},{replace:true});
  useEffect(() => {
    const timer=setTimeout(()=>{
      updateParams({
        keyword: trimmedKeyword.length > URL_KEYWORD_MAX_LENGTH ? "" : trimmedKeyword,
        page:""
      });
    },300);
    return()=>clearTimeout(timer);
  },[trimmedKeyword]);
  useEffect(()=>setSelected(new Set()),[urlParams.toString(), accountKind]);
  const effectivePage = pageSize === ACCOUNT_PAGE_SIZE_ALL ? 1 : page;
  const listPayload = buildAccountListPayload({
    accountKind,
    keyword: trimmedKeyword,
    page: effectivePage,
    pageSize,
    saleStatus,
    accountStatus,
    owner,
    registeredFrom,
    registeredTo,
    sortDirection
  });
  const params = new URLSearchParams(urlParams);
  if (trimmedKeyword && trimmedKeyword.length <= URL_KEYWORD_MAX_LENGTH) {
    params.set("keyword", trimmedKeyword);
  } else {
    params.delete("keyword");
  }
  params.set("page", String(effectivePage));
  params.set("pageSize", String(pageSize));
  params.set("sortDirection", sortDirection);
  params.set("accountKind", accountKind);
  const usePostQuery = trimmedKeyword.length > URL_KEYWORD_MAX_LENGTH;
  const query = useQuery({
    queryKey:["accounts", accountKind, JSON.stringify(listPayload)],
    queryFn:()=>usePostQuery
      ? api<ListResponse>("/api/accounts/query",{
          method:"POST",
          body:JSON.stringify(listPayload)
        })
      : api<ListResponse>(`/api/accounts?${params}`)
  });
  const ownersQuery = useQuery({
    queryKey:["account-owners", accountKind],
    queryFn:()=>api<{items:string[]}>(`/api/accounts/owners?accountKind=${accountKind}`)
  });
  const columnOrdersQuery = useQuery({
    queryKey: ["account-column-orders"],
    queryFn: ({ signal }) => api<AccountColumnOrders>("/api/settings/account-columns", { signal })
  });
  const activeColumnOrder = useMemo(
    () => normalizeAccountColumnOrder(accountKind, columnOrdersQuery.data?.[accountKind]),
    [accountKind, columnOrdersQuery.data]
  );
  const owners=ownersQuery.data?.items??[];
  const recheckBusy = progressText.length > 0;
  const runWithProgress = async<T,>(label:string, action:()=>Promise<T>) => {
    flushSync(() => {
      setProgressText(label);
    });
    try {
      await waitForNextPaint();
      return await action();
    } finally {
      setProgressText("");
    }
  };
  const mutate = useMutation({
    mutationFn: async ({id,value}:{id?:string;value:AccountSubmitValue}) => api(id?`/api/accounts/${id}`:"/api/accounts", {method:id?"PATCH":"POST",body:JSON.stringify(id ? value : { ...value, accountKind })}),
    onSuccess:()=>{setDrawer(null);setMessage("保存成功");void client.invalidateQueries({queryKey:["accounts", accountKind]});void client.invalidateQueries({queryKey:["account-owners", accountKind]})},
    onError:(error)=>setMessage(error instanceof Error?error.message:"保存失败")
  });
  const saveColumnOrder = useMutation({
    onMutate: async () => {
      await client.cancelQueries({ queryKey: ["account-column-orders"] });
    },
    mutationFn: (order: AccountColumnId[]) => api<{ order: AccountColumnId[] }>(
      `/api/settings/account-columns/${accountKind}`,
      { method: "PATCH", body: JSON.stringify({ order }) }
    ),
    onSuccess: (value) => {
      const normalized = normalizeAccountColumnOrder(accountKind, value.order);
      client.setQueryData<AccountColumnOrders>(["account-column-orders"], (current) => ({
        google: current?.google ?? [...DEFAULT_ACCOUNT_COLUMN_ORDER.google],
        email: current?.email ?? [...DEFAULT_ACCOUNT_COLUMN_ORDER.email],
        [accountKind]: normalized
      }));
      setColumnOrderOpen(false);
      setMessage("表头顺序已保存");
    }
  });
  const remove = async(id:string)=>{if(!confirm("确定删除这条账号吗？"))return;await api(`/api/accounts/${id}`,{method:"DELETE"});void client.invalidateQueries({queryKey:["accounts", accountKind]});void client.invalidateQueries({queryKey:["account-owners", accountKind]})};
  const reveal = async(id:string)=>{const value=await api<{opSecret:string}>(`/api/accounts/${id}/reveal-secret`,{method:"POST"});await navigator.clipboard.writeText(value.opSecret);setMessage("OP卡密已复制，页面仍保持隐藏")};
  const recheck = async(id:string)=>{await runWithProgress("正在重新检测抖音账号…", async()=>{await api(`/api/accounts/${id}/recheck`,{method:"POST"});setMessage("检测完成");void client.invalidateQueries({queryKey:["accounts", accountKind]})})};
  const recheckOp = async(id:string)=>{await runWithProgress("正在重新检测 OP…", async()=>{await api(`/api/accounts/${id}/recheck-op`,{method:"POST"});setMessage("OP检测完成");void client.invalidateQueries({queryKey:["accounts", accountKind]})})};
  const runBatch = async(action:"recheck"|"recheckOp"|"delete")=>{
    const ids=[...selected];if(!ids.length)return;
    if(action==="delete"&&!confirm(`确定删除选中的 ${ids.length} 条账号吗？`))return;
    if(action==="recheck"){
      await runWithProgress(`正在检测 ${ids.length} 条账号…`, async()=>{
        const result=await requestBatchRecheck("/api/accounts/batch-recheck", ids);
        setMessage(summarizeBatchRecheck(result, "account"));
        if((result.failed ?? []).length){
          setSelected(new Set(result.failed.map((item)=>item.id)));
        }
      });
    }
    if(action==="recheckOp"){
      const bannedIds = new Set(
        (query.data?.items ?? [])
          .filter((item) => selected.has(item._id) && item.accountStatus === "banned")
          .map((item) => item._id)
      );
      const eligibleIds = ids.filter((id) => !bannedIds.has(id));
      await runWithProgress(`正在检测 ${eligibleIds.length} 条 OP…`, async()=>{
        const result = eligibleIds.length
          ? await requestBatchRecheck("/api/accounts/batch-recheck-op", eligibleIds)
          : { succeeded: [], failed: [], skipped: [] };
        setMessage(summarizeBatchRecheck(result, "op", bannedIds.size));
        if((result.failed ?? []).length){
          setSelected(new Set(result.failed.map((item)=>item.id)));
        } else {
          const serverSkippedIds = new Set(
            (result.skipped ?? []).map((item) => item.id)
          );
          setSelected(new Set(eligibleIds.filter((id) => !serverSkippedIds.has(id))));
        }
      });
    }
    if(action==="delete"){
      await api("/api/accounts/batch-delete",{method:"POST",body:JSON.stringify({ids})});
      setMessage(`已删除 ${ids.length} 条账号`);
      setSelected(new Set());
    }
    void client.invalidateQueries({queryKey:["accounts", accountKind]});if(action==="delete")void client.invalidateQueries({queryKey:["account-owners", accountKind]});
  };
  const submitBatchDialog = async() => {
    const ids=[...selected];
    if(!batchDialog||!ids.length)return;
    if(batchDialog.type==="status"){
      await api("/api/accounts/batch-update",{method:"POST",body:JSON.stringify({ids,saleStatus:batchDialog.value})});
      setMessage(`已修改 ${ids.length} 条售卖状态`);
    }
    if(batchDialog.type==="accountStatus"){
      await api("/api/accounts/batch-update",{method:"POST",body:JSON.stringify({ids,accountStatus:batchDialog.value})});
      setMessage(`已修改 ${ids.length} 条账号状态`);
    }
    if(batchDialog.type==="owner"){
      const nextOwner=batchDialog.value.trim();
      if(!nextOwner)return;
      await api("/api/accounts/batch-update",{method:"POST",body:JSON.stringify({ids,owner:nextOwner})});
      setMessage(`已修改 ${ids.length} 条归属人`);
      void client.invalidateQueries({queryKey:["account-owners", accountKind]});
    }
    if(batchDialog.type==="registeredRegion"){
      const nextRegion=batchDialog.value.trim();
      if(!nextRegion)return;
      await api("/api/accounts/batch-update",{method:"POST",body:JSON.stringify({ids,registeredRegion:nextRegion})});
      setMessage(`已修改 ${ids.length} 条注册地区`);
    }
    if(batchDialog.type==="remark"){
      await api("/api/accounts/batch-update",{method:"POST",body:JSON.stringify({ids,remark:batchDialog.value})});
      setMessage(`已修改 ${ids.length} 条备注`);
    }
    setBatchDialog(null);
    void client.invalidateQueries({queryKey:["accounts", accountKind]});
  };
  const data=query.data;
  const searchSummary = data?.searchSummary;
  const missingSummary = searchSummary && searchSummary.missingKeywords.length
    ? `未找到 ${searchSummary.missingKeywords.length} 个抖音号：${searchSummary.missingKeywords.join("、")}`
    : "";
  const currentIds=data?.items.map((item)=>item._id)??[];
  const allChecked=currentIds.length>0&&currentIds.every((id)=>selected.has(id));
  const copyText = (value: string, successMessage: string) => {
    if (!navigator.clipboard?.writeText) {
      setMessage("当前环境不支持复制");
      return;
    }
    void navigator.clipboard.writeText(value).then(
      () => setMessage(successMessage),
      () => setMessage("复制失败，请手动复制")
    );
  };
  const columns = buildAccountTableColumns(accountKind, activeColumnOrder, { reveal, copyText });
  const handleExport = async() => {
    try {
      const payload = buildAccountExportParams(urlParams, selected, accountKind);
      const response = await fetch("/api/exports/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({
          error: { message: "导出失败" }
        }));
        setMessage(body.error?.message ?? "导出失败");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = config.exportFileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败");
    }
  };
  return <section>
    <header className="page-head"><div><h1>{config.title}</h1><p>统一维护账号归属、售卖和账号状态</p></div><button className="primary" onClick={()=>setDrawer({mode:"create",value:{...blank}})}><Plus size={17}/>{config.createLabel}</button></header>
    <div className="stats">
      {[["全部账号",data?.stats.total??0],["未售卖",data?.stats.unsold??0],["已售卖",data?.stats.sold??0],["异常账号",data?.stats.abnormal??0]].map(([label,value])=><div className="stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    {recheckBusy&&<div className="progress-notice" aria-live="polite"><div className="progress-copy"><span>{progressText}</span><span className="mono">请稍候…</span></div><div className="progress-track" role="progressbar" aria-label={progressText}><span className="progress-indicator"/></div></div>}
    {message&&<button className="notice" onClick={()=>setMessage("")}>{message}<X size={14}/></button>}
    {missingSummary&&<div className="notice-static" role="status" title={missingSummary}>{missingSummary}</div>}
    <div className="table-panel">
      <div className="toolbar">
        <label className="search search-multiline"><Search size={17}/><textarea value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="搜索抖音号 / sec_uid / 归属人，支持一行一个抖音号"/></label>
        <select value={saleStatus} onChange={e=>updateParams({saleStatus:e.target.value,page:""})}><option value="">售卖状态</option>{Object.entries(SALE_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <select value={accountStatus} onChange={e=>updateParams({accountStatus:e.target.value,page:""})}><option value="">账号状态</option>{Object.entries(ACCOUNT_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <select aria-label="归属人" value={owner} onChange={e=>updateParams({owner:e.target.value,page:""})}><option value="">全部归属人</option>{owners.map(value=><option key={value} value={value}>{value}</option>)}</select>
        <details className="date-filter"><summary>注册时间</summary><div><label>开始<input type="date" value={registeredFrom} onChange={e=>updateParams({registeredFrom:e.target.value,page:""})}/></label><label>结束<input type="date" value={registeredTo} onChange={e=>updateParams({registeredTo:e.target.value,page:""})}/></label></div></details>
        <button type="button" onClick={()=>updateParams({sortDirection:sortDirection==="asc"?"desc":"asc",page:"1"})}>{`注册时间${sortDirection==="asc"?"升序":"降序"}`}</button>
        {(search||saleStatus||accountStatus||owner||registeredFrom||registeredTo)&&<button onClick={()=>{setKeyword("");setUrlParams({}, {replace:true})}}>清空</button>}
        <span className="toolbar-space"/><button type="button" className="button" disabled={!columnOrdersQuery.isSuccess} onClick={() => setColumnOrderOpen(true)}>表头设置</button><Link className="button" to={`/imports?accountKind=${accountKind}`}><Upload size={16}/>导入 Excel</Link><button type="button" className="button" onClick={()=>void handleExport()}><Download size={16}/>{selected.size?`导出已选 ${selected.size} 条`:"导出数据"}</button>
      </div>
      {selected.size>0&&<div className="batch-bar"><strong>已选择 {selected.size} 条</strong><button onClick={()=>setBatchDialog({type:"status",value:DEFAULT_ACCOUNT_SALE_STATUS})}>修改售卖状态</button><button onClick={()=>setBatchDialog({type:"accountStatus",value:"normal"})}>修改账号状态</button><button onClick={()=>setBatchDialog({type:"owner",value:""})}>修改归属人</button><button onClick={()=>setBatchDialog({type:"registeredRegion",value:""})}>修改注册地区</button><button onClick={()=>setBatchDialog({type:"remark",value:""})}>批量备注</button><button disabled={recheckBusy} onClick={()=>runBatch("recheck")}><RefreshCw size={14}/>重新检测</button><button disabled={recheckBusy} onClick={()=>runBatch("recheckOp")}>重新检测 OP</button><button className="danger-text" onClick={()=>runBatch("delete")}><Trash2 size={14}/>删除</button></div>}
      <div className="table-scroll"><table className={`accounts-table${config.showEmail ? " accounts-table-email" : ""}`}><colgroup><col className="col-check"/><col className="col-index"/>{columns.map((column) => <col key={column.id} className={column.className} />)}<col className="col-actions"/></colgroup><thead><tr><th className="check-cell"><input aria-label="选择当前页" type="checkbox" checked={allChecked} onChange={()=>setSelected(allChecked?new Set():new Set(currentIds))}/></th><th className="index-cell">序号</th>{columns.map((column) => <th key={column.id}>{column.header}</th>)}<th>操作</th></tr></thead>
      <tbody>{query.isLoading?<tr><td colSpan={columns.length + 3} className="empty">正在加载…</td></tr>:data?.items.length?data.items.map((row,index)=><tr key={row._id}>
        <td className="check-cell"><input aria-label={`选择账号 ${row.douyinId}`} type="checkbox" checked={selected.has(row._id)} onChange={()=>setSelected((current)=>{const next=new Set(current);next.has(row._id)?next.delete(row._id):next.add(row._id);return next})}/></td><td className="index-cell">{pageSize===ACCOUNT_PAGE_SIZE_ALL?index+1:(page-1)*Number(pageSize)+index+1}</td>{columns.map((column) => { const rendered = column.render(row); return <td key={column.id} data-column-id={column.id} title={renderedTitle(rendered)}>{rendered}</td>; })}
        <td><div className="actions"><button className="link" onClick={()=>setDrawer({mode:"edit",id:row._id,value:{douyinId:row.douyinId,email:row.email,mobile:row.mobile??"",registeredAt:row.registeredAt.slice(0,10),opName:row.opName,opSecret:"",accountPassword:row.accountPassword,opProject:OP_PROJECTS[row.opProject]?.key??DEFAULT_OP_PROJECT,owner:row.owner,registeredRegion:row.registeredRegion||DEFAULT_REGISTERED_REGION,saleStatus:row.saleStatus,remark:row.remark}})}>编辑</button><button className="link" disabled={recheckBusy||row.accountStatus==="banned"} title={row.accountStatus==="banned"?"封禁账号无需检测 OP":undefined} onClick={()=>recheckOp(row._id)}>重新检测 OP</button><button className="icon-button" disabled={recheckBusy} title="重新检测" onClick={()=>recheck(row._id)}><RefreshCw size={14}/></button><button className="icon-button danger" title="删除" onClick={()=>remove(row._id)}><Trash2 size={14}/></button></div></td>
      </tr>):<tr><td colSpan={columns.length + 3} className="empty">{search||saleStatus||accountStatus||owner||registeredFrom||registeredTo?"当前筛选无结果":"尚无账号数据"}</td></tr>}</tbody></table></div>
      <div className="pager">
        <span>共 {data?.total??0} 条</span>
        <div className="pager-controls">
          <label className="page-size">
            每页
            <select
              aria-label="每页条数"
              value={String(pageSize)}
              onChange={e=>updateParams({pageSize:e.target.value,page:"1"})}
            >
              {ACCOUNT_PAGE_SIZE_OPTIONS.map(size=><option key={size} value={size}>{size}</option>)}
              <option value={ACCOUNT_PAGE_SIZE_ALL}>全部</option>
            </select>
          </label>
          <button disabled={pageSize===ACCOUNT_PAGE_SIZE_ALL || page<=1} onClick={()=>updateParams({page:String(page-1)})}>上一页</button>
          <b>{pageSize===ACCOUNT_PAGE_SIZE_ALL ? "全部" : `${page} / ${data?.totalPages||1}`}</b>
          <button disabled={pageSize===ACCOUNT_PAGE_SIZE_ALL || page>=(data?.totalPages||1)} onClick={()=>updateParams({page:String(page+1)})}>下一页</button>
        </div>
      </div>
    </div>
    {drawer&&<AccountDrawer state={drawer} accountKind={accountKind} owners={owners} busy={mutate.isPending} close={()=>setDrawer(null)} submit={value=>mutate.mutate(drawer.id?{id:drawer.id,value}:{value})}/>}
    {batchDialog&&<BatchUpdateDialog state={batchDialog} owners={owners} close={()=>setBatchDialog(null)} submit={submitBatchDialog} setValue={(value)=>setBatchDialog((current)=>current?{...current,value} as BatchDialogState:current)}/>}
    <AccountColumnOrderDialog open={columnOrderOpen} accountKind={accountKind} order={activeColumnOrder} busy={saveColumnOrder.isPending} onChange={() => undefined} onSave={async (order) => { await saveColumnOrder.mutateAsync(order); }} onClose={() => { saveColumnOrder.reset(); setColumnOrderOpen(false); }}/>
  </section>;
}

function AccountDrawer({state,accountKind,owners,busy,close,submit}:{state:{mode:"create"|"edit";value:AccountFormValue};accountKind:AccountKind;owners:string[];busy:boolean;close():void;submit(v:AccountSubmitValue):void}) {
  const [detected,setDetected]=useState<{secUid:string;accountStatus:string}|null>(state.mode==="edit"?{secUid:"已保存",accountStatus:"按需重新检测"}:null);
  const [checking,setChecking]=useState(false);
  const [emailError,setEmailError]=useState("");
  const [mobileError,setMobileError]=useState("");
  const isEmailPage = accountKind === "email";
  const validateEmail = (value: string) => {
    const email = value.trim();
    if (!email) return "邮箱不能为空";
    return EmailAddressSchema.safeParse(email).success ? "" : "邮箱格式不正确";
  };
  const check=async(form:HTMLFormElement)=>{const id=String(new FormData(form).get("douyinId")||"");setChecking(true);try{setDetected(await api("/api/accounts/check-douyin",{method:"POST",body:JSON.stringify({douyinId:id})}))}finally{setChecking(false)}};
  const onSubmit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const d=new FormData(event.currentTarget);const email=String(d.get("email")||"").trim();if(isEmailPage){const error=validateEmail(email);if(error){setEmailError(error);return;}}const mobileResult=MobileSchema.safeParse(String(d.get("mobile")??""));if(!mobileResult.success){setMobileError(mobileResult.error.issues[0]?.message??"手机号格式不正确");return;}setMobileError("");if(!detected&&state.mode==="create")return;const opSecret=String(d.get("opSecret")||"");const accountPassword=String(d.get("accountPassword")??"");const value:AccountSubmitValue={douyinId:String(d.get("douyinId")),mobile:mobileResult.data,registeredAt:String(d.get("registeredAt")),opName:String(d.get("opName")),opProject:String(d.get("opProject")||DEFAULT_OP_PROJECT) as AccountFormValue["opProject"],owner:String(d.get("owner")),registeredRegion:String(d.get("registeredRegion")||DEFAULT_REGISTERED_REGION),saleStatus:String(d.get("saleStatus")) as AccountFormValue["saleStatus"],remark:String(d.get("remark"))};if(isEmailPage)value.email=email;if(opSecret)value.opSecret=opSecret;if(state.mode === "create" || accountPassword !== state.value.accountPassword)value.accountPassword=accountPassword;submit(value)};
  return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><form className="drawer" onSubmit={onSubmit}><header><div><h2>{state.mode==="create" ? (isEmailPage ? "新增邮箱号" : "新增谷歌账号") : "编辑账号"}</h2><p>派生字段由服务端自动计算</p></div><button type="button" className="icon-button" onClick={close}><X/></button></header>
    <div className="form-grid"><label>抖音号<div className="input-action"><input name="douyinId" defaultValue={state.value.douyinId} required/><button type="button" onClick={e=>check(e.currentTarget.form!)} disabled={checking}>{checking?"检测中":"检测"}</button></div></label>
    {isEmailPage&&<label>邮箱<input type="email" name="email" defaultValue={state.value.email} required maxLength={254} aria-invalid={Boolean(emailError)} aria-describedby="account-email-error" onInvalid={event=>setEmailError(event.currentTarget.validity.valueMissing ? "邮箱不能为空" : "邮箱格式不正确")} onInput={event=>{if(emailError)setEmailError(validateEmail(event.currentTarget.value))}}/>{emailError&&<p id="account-email-error" role="alert">{emailError}</p>}</label>}
    <label>手机号<input name="mobile" defaultValue={state.value.mobile} maxLength={32} placeholder="+86 13037174892" aria-invalid={Boolean(mobileError)} aria-describedby="account-mobile-error" onInput={event=>{if(mobileError){const result=MobileSchema.safeParse(event.currentTarget.value);setMobileError(result.success?"":result.error.issues[0]?.message??"手机号格式不正确")}}}/>{mobileError&&<p id="account-mobile-error" role="alert">{mobileError}</p>}</label>
    {detected&&<div className="detected">sec_uid：{detected.secUid}<br/>账号状态：{ACCOUNT_STATUS_LABELS[detected.accountStatus as keyof typeof ACCOUNT_STATUS_LABELS]??detected.accountStatus}</div>}
    <label>注册时间<input type="date" name="registeredAt" defaultValue={state.value.registeredAt} required/></label><label>OP名称<input name="opName" defaultValue={state.value.opName} maxLength={100}/></label><label>项目<select name="opProject" defaultValue={state.value.opProject}>{Object.values(OP_PROJECTS).map((project)=><option key={project.key} value={project.key}>{project.name}</option>)}</select></label>
    <label>OP卡密<input name="opSecret" defaultValue="" required={state.mode==="create"} placeholder={state.mode==="edit"?"不修改请留空":"末段必须为10位时间戳"}/></label><label>密码<input name="accountPassword" defaultValue={state.value.accountPassword} maxLength={4096}/></label><label>归属人<input name="owner" list="owner-options" defaultValue={state.value.owner} required/><datalist id="owner-options">{owners.map(value=><option key={value} value={value}/>)}</datalist></label>
    <label>注册地区<input name="registeredRegion" defaultValue={state.value.registeredRegion} maxLength={100} required/></label>
    <label>售卖状态<select name="saleStatus" defaultValue={state.value.saleStatus}>{Object.entries(SALE_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>备注<textarea name="remark" defaultValue={state.value.remark} maxLength={1000}/></label></div>
    <footer><button type="button" onClick={close}>取消</button><button className="primary" disabled={busy}>{busy?"保存中…":"保存"}</button></footer></form></div>;
}

function BatchUpdateDialog({state,owners,close,submit,setValue}:{state:BatchDialogState;owners:string[];close():void;submit():void;setValue(value:string):void}) {
  const title = state.type==="status"
    ? "修改售卖状态"
    : state.type==="accountStatus"
      ? "修改账号状态"
      : state.type==="owner"
        ? "修改归属人"
        : state.type==="registeredRegion"
          ? "修改注册地区"
          : "批量备注";
  const confirmDisabled = state.type==="status" || state.type==="accountStatus"
    ? !state.value
    : state.type==="remark"
      ? false
      : !state.value.trim();
  return <div className="overlay overlay-center" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
    <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="batch-dialog-title">
      <header><div><h2 id="batch-dialog-title">{title}</h2><p>将应用到当前选中的账号</p></div><button type="button" className="icon-button" onClick={close}><X/></button></header>
      <div className="dialog-body">
        {state.type==="status"
          ? <label>售卖状态<select aria-label="售卖状态" value={state.value} onChange={e=>setValue(e.target.value)}>{Object.entries(SALE_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          : state.type==="accountStatus"
            ? <label>账号状态<select aria-label="账号状态" value={state.value} onChange={e=>setValue(e.target.value)}>{Object.entries(ACCOUNT_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
            : state.type==="owner"
              ? <label>归属人<input aria-label="归属人" list="batch-owner-options" value={state.value} onChange={e=>setValue(e.target.value)}/><datalist id="batch-owner-options">{owners.map(value=><option key={value} value={value}/>)}</datalist></label>
              : state.type==="registeredRegion"
                ? <label>注册地区<input aria-label="注册地区" value={state.value} onChange={e=>setValue(e.target.value)}/></label>
                : <label>备注<textarea aria-label="备注" value={state.value} onChange={e=>setValue(e.target.value)} maxLength={1000}/></label>}
      </div>
      <footer><button type="button" onClick={close}>取消</button><button type="button" className="primary" disabled={confirmDisabled} onClick={submit}>确定</button></footer>
    </div>
  </div>;
}
