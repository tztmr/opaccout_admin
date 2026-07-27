import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AccountDto, AccountStats, PagedResponse } from "@douyin-admin/shared";
import { ACCOUNT_STATUS_LABELS, SALE_STATUS_LABELS } from "@douyin-admin/shared";
import { api } from "../api";
import { buildAccountExportParams } from "./account-filter-state";

type ListResponse = PagedResponse<AccountDto> & { stats: AccountStats };
const blank = { douyinId:"", registeredAt:new Date().toISOString().slice(0,10), opName:"", opSecret:"", owner:"", saleStatus:"recovered", remark:"" };
type AccountFormValue = typeof blank;
type AccountSubmitValue = Omit<AccountFormValue, "opSecret"> & { opSecret?: string };

export function AccountsPage() {
  const client = useQueryClient();
  const [urlParams, setUrlParams] = useSearchParams();
  const [keyword, setKeyword] = useState(urlParams.get("keyword")||"");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<null | { mode:"create"|"edit"; value: typeof blank; id?:string }>(null);
  const [message, setMessage] = useState("");
  const page = Math.max(1,Number(urlParams.get("page"))||1);
  const saleStatus = urlParams.get("saleStatus")||"";
  const accountStatus = urlParams.get("accountStatus")||"";
  const owner = urlParams.get("owner")||"";
  const registeredFrom = urlParams.get("registeredFrom")||"";
  const registeredTo = urlParams.get("registeredTo")||"";
  const search = urlParams.get("keyword")||"";
  const updateParams=(patch:Record<string,string>)=>setUrlParams((current)=>{const next=new URLSearchParams(current);for(const [key,value] of Object.entries(patch)){if(value)next.set(key,value);else next.delete(key)}return next},{replace:true});
  useEffect(() => { const timer=setTimeout(()=>updateParams({keyword,page:""}),300); return()=>clearTimeout(timer); },[keyword]);
  useEffect(()=>setSelected(new Set()),[urlParams.toString()]);
  const params = new URLSearchParams(urlParams);
  params.set("page",String(page));params.set("pageSize","20");
  const query = useQuery({ queryKey:["accounts",params.toString()], queryFn:()=>api<ListResponse>(`/api/accounts?${params}`) });
  const ownersQuery = useQuery({
    queryKey:["account-owners"],
    queryFn:()=>api<{items:string[]}>("/api/accounts/owners")
  });
  const owners=ownersQuery.data?.items??[];
  const mutate = useMutation({
    mutationFn: async ({id,value}:{id?:string;value:AccountSubmitValue}) => api(id?`/api/accounts/${id}`:"/api/accounts", {method:id?"PATCH":"POST",body:JSON.stringify(value)}),
    onSuccess:()=>{setDrawer(null);setMessage("保存成功");void client.invalidateQueries({queryKey:["accounts"]});void client.invalidateQueries({queryKey:["account-owners"]})},
    onError:(error)=>setMessage(error instanceof Error?error.message:"保存失败")
  });
  const remove = async(id:string)=>{if(!confirm("确定删除这条账号吗？"))return;await api(`/api/accounts/${id}`,{method:"DELETE"});void client.invalidateQueries({queryKey:["accounts"]});void client.invalidateQueries({queryKey:["account-owners"]})};
  const reveal = async(id:string)=>{const value=await api<{opSecret:string}>(`/api/accounts/${id}/reveal-secret`,{method:"POST"});await navigator.clipboard.writeText(value.opSecret);setMessage("OP卡密已复制，页面仍保持隐藏")};
  const recheck = async(id:string)=>{await api(`/api/accounts/${id}/recheck`,{method:"POST"});setMessage("检测完成");void client.invalidateQueries({queryKey:["accounts"]})};
  const runBatch = async(action:"status"|"owner"|"recheck"|"delete")=>{
    const ids=[...selected];if(!ids.length)return;
    if(action==="delete"&&!confirm(`确定删除选中的 ${ids.length} 条账号吗？`))return;
    if(action==="recheck"){await api("/api/accounts/batch-recheck",{method:"POST",body:JSON.stringify({ids})});setMessage(`已完成 ${ids.length} 条账号检测`)}
    if(action==="delete"){await api("/api/accounts/batch-delete",{method:"POST",body:JSON.stringify({ids})});setMessage(`已删除 ${ids.length} 条账号`)}
    if(action==="status"){const value=prompt("请输入售卖状态：未售卖 / 已售卖 / 已停用 / 已找回");const key=Object.entries(SALE_STATUS_LABELS).find(([,label])=>label===value)?.[0];if(!key)return;await api("/api/accounts/batch-update",{method:"POST",body:JSON.stringify({ids,saleStatus:key})});setMessage(`已修改 ${ids.length} 条售卖状态`)}
    if(action==="owner"){const owner=prompt("请输入新的归属人");if(!owner?.trim())return;await api("/api/accounts/batch-update",{method:"POST",body:JSON.stringify({ids,owner:owner.trim()})});setMessage(`已修改 ${ids.length} 条归属人`)}
    setSelected(new Set());void client.invalidateQueries({queryKey:["accounts"]});if(action==="owner"||action==="delete")void client.invalidateQueries({queryKey:["account-owners"]});
  };
  const data=query.data;
  const currentIds=data?.items.map((item)=>item._id)??[];
  const allChecked=currentIds.length>0&&currentIds.every((id)=>selected.has(id));
  const exportParams=buildAccountExportParams(urlParams,selected);
  return <section>
    <header className="page-head"><div><h1>抖音账号管理</h1><p>统一维护账号归属、售卖和账号状态</p></div><button className="primary" onClick={()=>setDrawer({mode:"create",value:{...blank}})}><Plus size={17}/>新增账号</button></header>
    <div className="stats">
      {[["全部账号",data?.stats.total??0],["未售卖",data?.stats.unsold??0],["已售卖",data?.stats.sold??0],["异常账号",data?.stats.abnormal??0]].map(([label,value])=><div className="stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    {message&&<button className="notice" onClick={()=>setMessage("")}>{message}<X size={14}/></button>}
    <div className="table-panel">
      <div className="toolbar">
        <label className="search"><Search size={17}/><input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="搜索抖音号 / sec_uid / 归属人"/></label>
        <select value={saleStatus} onChange={e=>updateParams({saleStatus:e.target.value,page:""})}><option value="">售卖状态</option>{Object.entries(SALE_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <select value={accountStatus} onChange={e=>updateParams({accountStatus:e.target.value,page:""})}><option value="">账号状态</option>{Object.entries(ACCOUNT_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <select aria-label="归属人" value={owner} onChange={e=>updateParams({owner:e.target.value,page:""})}><option value="">全部归属人</option>{owners.map(value=><option key={value} value={value}>{value}</option>)}</select>
        <details className="date-filter"><summary>注册时间</summary><div><label>开始<input type="date" value={registeredFrom} onChange={e=>updateParams({registeredFrom:e.target.value,page:""})}/></label><label>结束<input type="date" value={registeredTo} onChange={e=>updateParams({registeredTo:e.target.value,page:""})}/></label></div></details>
        {(search||saleStatus||accountStatus||owner||registeredFrom||registeredTo)&&<button onClick={()=>{setKeyword("");setUrlParams({}, {replace:true})}}>清空</button>}
        <span className="toolbar-space"/><Link className="button" to="/imports"><Upload size={16}/>导入 Excel</Link><a className="button" href={`/api/exports/accounts?${exportParams}`}><Download size={16}/>{selected.size?`导出已选 ${selected.size} 条`:"导出数据"}</a>
      </div>
      {selected.size>0&&<div className="batch-bar"><strong>已选择 {selected.size} 条</strong><button onClick={()=>runBatch("status")}>修改售卖状态</button><button onClick={()=>runBatch("owner")}>修改归属人</button><button onClick={()=>runBatch("recheck")}><RefreshCw size={14}/>重新检测</button><button className="danger-text" onClick={()=>runBatch("delete")}><Trash2 size={14}/>删除</button></div>}
      <div className="table-scroll"><table><thead><tr><th className="check-cell"><input aria-label="选择当前页" type="checkbox" checked={allChecked} onChange={()=>setSelected(allChecked?new Set():new Set(currentIds))}/></th>{["抖音号","sec_uid","注册时间","OP名称","OP卡密","OP到期时间","归属人","售卖状态","账号状态","备注","操作"].map(v=><th key={v}>{v}</th>)}</tr></thead>
      <tbody>{query.isLoading?<tr><td colSpan={12} className="empty">正在加载…</td></tr>:data?.items.length?data.items.map(row=><tr key={row._id}>
        <td className="check-cell"><input aria-label={`选择账号 ${row.douyinId}`} type="checkbox" checked={selected.has(row._id)} onChange={()=>setSelected((current)=>{const next=new Set(current);next.has(row._id)?next.delete(row._id):next.add(row._id);return next})}/></td><td>{row.douyinId}</td><td title={row.secUid}>{row.secUid.slice(0,15)}…</td><td>{row.registeredAt.slice(0,10)}</td><td>{row.opName||"—"}</td><td><button className="link" onClick={()=>reveal(row._id)}>•••••• <Eye size={14}/></button></td><td>{new Date(row.opExpiresAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</td><td>{row.owner}</td>
        <td><span className={`tag sale-${row.saleStatus}`}>{SALE_STATUS_LABELS[row.saleStatus]}</span></td><td><span className={`tag account-${row.accountStatus}`}>{ACCOUNT_STATUS_LABELS[row.accountStatus]}</span></td><td title={row.remark}>{row.remark||"—"}</td>
        <td><div className="actions"><button className="link" onClick={()=>setDrawer({mode:"edit",id:row._id,value:{douyinId:row.douyinId,registeredAt:row.registeredAt.slice(0,10),opName:row.opName,opSecret:"",owner:row.owner,saleStatus:row.saleStatus,remark:row.remark}})}>编辑</button><button className="icon-button" title="重新检测" onClick={()=>recheck(row._id)}><RefreshCw size={14}/></button><button className="icon-button danger" title="删除" onClick={()=>remove(row._id)}><Trash2 size={14}/></button></div></td>
      </tr>):<tr><td colSpan={12} className="empty">{search||saleStatus||accountStatus||owner||registeredFrom||registeredTo?"当前筛选无结果":"尚无账号数据"}</td></tr>}</tbody></table></div>
      <div className="pager"><span>共 {data?.total??0} 条</span><div><button disabled={page<=1} onClick={()=>updateParams({page:String(page-1)})}>上一页</button><b>{page} / {data?.totalPages||1}</b><button disabled={page>=(data?.totalPages||1)} onClick={()=>updateParams({page:String(page+1)})}>下一页</button></div></div>
    </div>
    {drawer&&<AccountDrawer state={drawer} owners={owners} busy={mutate.isPending} close={()=>setDrawer(null)} submit={value=>mutate.mutate(drawer.id?{id:drawer.id,value}:{value})}/>}
  </section>;
}

function AccountDrawer({state,owners,busy,close,submit}:{state:{mode:"create"|"edit";value:AccountFormValue};owners:string[];busy:boolean;close():void;submit(v:AccountSubmitValue):void}) {
  const [detected,setDetected]=useState<{secUid:string;accountStatus:string}|null>(state.mode==="edit"?{secUid:"已保存",accountStatus:"按需重新检测"}:null);
  const [checking,setChecking]=useState(false);
  const check=async(form:HTMLFormElement)=>{const id=String(new FormData(form).get("douyinId")||"");setChecking(true);try{setDetected(await api("/api/accounts/check-douyin",{method:"POST",body:JSON.stringify({douyinId:id})}))}finally{setChecking(false)}};
  const onSubmit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!detected&&state.mode==="create")return;const d=new FormData(event.currentTarget);const opSecret=String(d.get("opSecret")||"");const value:AccountSubmitValue={douyinId:String(d.get("douyinId")),registeredAt:String(d.get("registeredAt")),opName:String(d.get("opName")),owner:String(d.get("owner")),saleStatus:String(d.get("saleStatus")),remark:String(d.get("remark"))};if(opSecret)value.opSecret=opSecret;submit(value)};
  return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><form className="drawer" onSubmit={onSubmit}><header><div><h2>{state.mode==="create"?"新增账号":"编辑账号"}</h2><p>派生字段由服务端自动计算</p></div><button type="button" className="icon-button" onClick={close}><X/></button></header>
    <div className="form-grid"><label>抖音号<div className="input-action"><input name="douyinId" defaultValue={state.value.douyinId} required/><button type="button" onClick={e=>check(e.currentTarget.form!)} disabled={checking}>{checking?"检测中":"检测"}</button></div></label>
    {detected&&<div className="detected">sec_uid：{detected.secUid}<br/>账号状态：{ACCOUNT_STATUS_LABELS[detected.accountStatus as keyof typeof ACCOUNT_STATUS_LABELS]??detected.accountStatus}</div>}
    <label>注册时间<input type="date" name="registeredAt" defaultValue={state.value.registeredAt} required/></label><label>OP名称<input name="opName" defaultValue={state.value.opName} maxLength={100}/></label>
    <label>OP卡密<input name="opSecret" defaultValue="" required={state.mode==="create"} placeholder={state.mode==="edit"?"不修改请留空":"末段必须为10位时间戳"}/></label><label>归属人<input name="owner" list="owner-options" defaultValue={state.value.owner} required/><datalist id="owner-options">{owners.map(value=><option key={value} value={value}/>)}</datalist></label>
    <label>售卖状态<select name="saleStatus" defaultValue={state.value.saleStatus}>{Object.entries(SALE_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>备注<textarea name="remark" defaultValue={state.value.remark} maxLength={1000}/></label></div>
    <footer><button type="button" onClick={close}>取消</button><button className="primary" disabled={busy}>{busy?"保存中…":"保存"}</button></footer></form></div>;
}
