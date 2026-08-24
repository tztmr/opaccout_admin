import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import type { AccountColumnId, AccountDto, AccountKind } from "@douyin-admin/shared";
import {
  ACCOUNT_COLUMN_LABELS,
  ACCOUNT_STATUS_LABELS,
  OP_PROJECTS,
  PUBLIC_OP_ORIGIN,
  SALE_STATUS_LABELS,
  normalizeAccountColumnOrder
} from "@douyin-admin/shared";

export type AccountTableColumn = {
  id: AccountColumnId;
  header: string;
  className: string;
  render(row: AccountDto): ReactNode;
};

export type AccountTableColumnActions = {
  reveal(id: string): void;
  copyText(value: string, successMessage: string): void;
};

type AccountTableColumnDefinition = {
  render(row: AccountDto, actions: AccountTableColumnActions): ReactNode;
};

export const ACCOUNT_TABLE_COLUMNS: Record<AccountColumnId, AccountTableColumnDefinition> = {
  douyin: {
    render: (row) => row.douyinId
  },
  email: {
    render: (row) => <span title={row.email || undefined}>{row.email || "—"}</span>
  },
  password: {
    render: (row) => (
      <span className="account-password-cell" title={row.accountPassword || undefined}>
        {row.accountPassword || "—"}
      </span>
    )
  },
  secuid: {
    render: (row) => row.secUid
      ? <span title={row.secUid}><a className="link" href={`https://www.douyin.com/user/${row.secUid}`} target="_blank" rel="noreferrer">{row.secUid}</a></span>
      : "—"
  },
  date: {
    render: (row) => row.registeredAt.slice(0, 10)
  },
  opname: {
    render: (row) => <span title={row.opName || undefined}>{row.opName || "—"}</span>
  },
  opsecret: {
    render: (row, actions) => (
      <button type="button" className="link" aria-label="显示 OP 卡密" onClick={() => actions.reveal(row._id)}>
        •••••• <Eye size={14} aria-hidden="true" />
      </button>
    )
  },
  shortop: {
    render: (row, actions) => row.shortOpCode
      ? <span className="short-op-cell"><button type="button" className="link mono short-op-value" aria-label={`复制短 OP 链接 ${row.shortOpCode}`} onClick={() => actions.copyText(`${PUBLIC_OP_ORIGIN}/${row.shortOpCode}`, "短 OP 链接已复制")}>{row.shortOpCode}</button><button type="button" className="link" aria-label={`复制短 OP ${row.shortOpCode}`} onClick={() => actions.copyText(row.shortOpCode, "短 OP 已复制")}>复制</button></span>
      : "—"
  },
  mobile: {
    render: (row) => <span title={row.mobile || undefined}>{row.mobile || "—"}</span>
  },
  project: {
    render: (row) => OP_PROJECTS[row.opProject]?.name ?? "未知项目"
  },
  expiry: {
    render: (row) => new Date(row.opExpiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
  },
  owner: {
    render: (row) => row.owner
  },
  region: {
    render: (row) => row.registeredRegion || "—"
  },
  sale: {
    render: (row) => <span className={`tag sale-${row.saleStatus}`}>{SALE_STATUS_LABELS[row.saleStatus]}</span>
  },
  status: {
    render: (row) => <span className={`tag account-${row.accountStatus}`}>{ACCOUNT_STATUS_LABELS[row.accountStatus]}</span>
  },
  remark: {
    render: (row) => <span title={row.remark || undefined}>{row.remark || "—"}</span>
  }
};

export function buildAccountTableColumns(
  accountKind: AccountKind,
  order: unknown,
  actions: AccountTableColumnActions
): AccountTableColumn[] {
  return normalizeAccountColumnOrder(accountKind, order).map((id) => ({
    id,
    header: ACCOUNT_COLUMN_LABELS[id],
    className: `col-${id}`,
    render: (row) => ACCOUNT_TABLE_COLUMNS[id].render(row, actions)
  }));
}
