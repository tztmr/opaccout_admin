import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { AccountColumnId, AccountKind } from "@douyin-admin/shared";
import {
  ACCOUNT_COLUMN_LABELS,
  DEFAULT_ACCOUNT_COLUMN_ORDER,
  normalizeAccountColumnOrder
} from "@douyin-admin/shared";

type AccountColumnOrderDialogProps = {
  open: boolean;
  accountKind: AccountKind;
  order: unknown;
  busy?: boolean;
  onChange(order: AccountColumnId[]): void;
  onSave(order: AccountColumnId[]): Promise<void> | void;
  onClose(): void;
};

export function AccountColumnOrderDialog({
  open,
  accountKind,
  order,
  busy = false,
  onChange,
  onSave,
  onClose
}: AccountColumnOrderDialogProps) {
  const [draft, setDraft] = useState<AccountColumnId[]>(() =>
    normalizeAccountColumnOrder(accountKind, order)
  );
  const [dragging, setDragging] = useState<AccountColumnId | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const isBusy = busy || saving;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(isBusy);
  const onCloseRef = useRef(onClose);
  busyRef.current = isBusy;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setDraft(normalizeAccountColumnOrder(accountKind, order));
    setDragging(null);
    setSaveError("");
  }, [open, accountKind, order]);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const initialFocus = closeButtonRef.current;
    if (initialFocus && !initialFocus.disabled) initialFocus.focus();
    else dialog?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const updateDraft = (next: AccountColumnId[]) => {
    setDraft(next);
    setSaveError("");
    onChange(next);
  };
  const moveBefore = (source: AccountColumnId | null, target: AccountColumnId) => {
    if (!source || source === target || isBusy) return;
    const next = draft.filter((id) => id !== source);
    next.splice(next.indexOf(target), 0, source);
    updateDraft(next);
    setDragging(null);
  };
  const moveBy = (id: AccountColumnId, offset: -1 | 1) => {
    if (isBusy) return;
    const index = draft.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target]!, next[index]!];
    updateDraft(next);
  };
  const save = async () => {
    if (isBusy) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave([...draft]);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存顺序失败");
    } finally {
      setSaving(false);
    }
  };

  return <div className="overlay overlay-center" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !isBusy) onClose();
  }}>
    <div ref={dialogRef} tabIndex={-1} className="dialog-card column-order-dialog" role="dialog" aria-modal="true" aria-labelledby="column-order-title">
      <header><div><h2 id="column-order-title">表头设置</h2><p>{accountKind === "email" ? "抖音邮箱号" : "抖音谷歌账号"}业务列顺序</p></div><button ref={closeButtonRef} type="button" className="icon-button" aria-label="关闭表头设置" disabled={isBusy} onClick={onClose}><X /></button></header>
      <div className="dialog-body">
        <p className="column-order-help">拖动调整顺序，触屏或键盘可使用上移、下移按钮。</p>
        <ul className="column-order-list" aria-label="可排序业务列">
          {draft.map((id, index) => <li
            key={id}
            aria-label={ACCOUNT_COLUMN_LABELS[id]}
            draggable={!isBusy}
            onDragStart={() => setDragging(id)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => moveBefore(dragging, id)}
          >
            <button type="button" aria-label={`拖动${ACCOUNT_COLUMN_LABELS[id]}`} className="drag-handle" disabled={isBusy}>⋮⋮</button>
            <span className="column-order-label">{ACCOUNT_COLUMN_LABELS[id]}</span>
            <button type="button" aria-label={`上移${ACCOUNT_COLUMN_LABELS[id]}`} disabled={isBusy || index === 0} onClick={() => moveBy(id, -1)}>↑</button>
            <button type="button" aria-label={`下移${ACCOUNT_COLUMN_LABELS[id]}`} disabled={isBusy || index === draft.length - 1} onClick={() => moveBy(id, 1)}>↓</button>
          </li>)}
        </ul>
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
      </div>
      <footer>
        <button type="button" disabled={isBusy} onClick={() => updateDraft([...DEFAULT_ACCOUNT_COLUMN_ORDER[accountKind]])}>恢复默认顺序</button>
        <span className="column-order-footer-space" />
        <button type="button" disabled={isBusy} onClick={onClose}>取消</button>
        <button type="button" className="primary" disabled={isBusy} onClick={() => void save()}>{isBusy ? "保存中…" : "保存"}</button>
      </footer>
    </div>
  </div>;
}
