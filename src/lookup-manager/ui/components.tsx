import { useState, type ReactNode } from 'react';
import type { RunStatus, TargetResult } from '../core/types';

export function Section({
  title,
  hint,
  help,
  guide,
  onGuide,
  children,
}: {
  title: string;
  hint?: string;
  help?: string;
  /** Guide topic id, opened by the "Guide" link. */
  guide?: string;
  onGuide?: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <section className="lm-section">
      <div className="lm-section-head">
        <h3>{title}</h3>
        <div className="lm-section-links">
          {help && (
            <details className="lm-help">
              <summary aria-label={`About ${title}`}>What is this?</summary>
              <p>{help}</p>
            </details>
          )}
          {guide && onGuide && (
            <button type="button" className="lm-link" onClick={() => onGuide(guide)} aria-label={`Open the guide: ${title}`}>
              Guide ›
            </button>
          )}
        </div>
      </div>
      {hint && <p className="lm-hint">{hint}</p>}
      {children}
    </section>
  );
}

/** Read-only code with a copy button (falls back to selecting the text when the clipboard is blocked). */
export function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState('');
  return (
    <div className="lm-codeblock">
      <div className="lm-row lm-between">
        <strong>{label}</strong>
        <button
          type="button"
          className="lm-btn lm-btn-small"
          onClick={async (e) => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied('Copied');
            } catch {
              const pre = (e.currentTarget.closest('.lm-codeblock') as HTMLElement | null)?.querySelector('pre');
              if (pre) window.getSelection()?.selectAllChildren(pre);
              setCopied('Selected: press Ctrl+C');
            }
            setTimeout(() => setCopied(''), 2500);
          }}
        >
          {copied || 'Copy'}
        </button>
      </div>
      <pre className="lm-code lm-pre">{code}</pre>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="lm-field">
      <span className="lm-label">{label}</span>
      {children}
      {hint && <span className="lm-hint">{hint}</span>}
    </label>
  );
}

const STATUS_TEXT: Record<RunStatus, string> = {
  success: 'Success',
  partial: 'Partial',
  blocked: 'Blocked',
  failed: 'Failed',
  preview: 'Preview',
};

export function StatusBadge({ status }: { status?: RunStatus }) {
  if (!status) return <span className="lm-badge lm-badge-none">Never run</span>;
  return <span className={`lm-badge lm-badge-${status}`}>{STATUS_TEXT[status]}</span>;
}

export function TargetList({ targets }: { targets: TargetResult[] }) {
  if (!targets.length) return null;
  return (
    <ul className="lm-targets">
      {targets.map((t) => (
        <li key={t.target}>
          <span className={`lm-dot lm-dot-${t.status}`} aria-hidden />
          <strong>{t.target}</strong> — {t.detail}
        </li>
      ))}
    </ul>
  );
}

export function Messages({ items, kind }: { items: string[]; kind: 'error' | 'warning' | 'info' }) {
  if (!items.length) return null;
  return (
    <div className={`lm-msg lm-msg-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <ul>
        {items.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

export function PreviewTable({ columns, rows, max = 25 }: { columns: string[]; rows: Record<string, string>[]; max?: number }) {
  return (
    <div className="lm-table-wrap">
      <table className="lm-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>{r[c]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="lm-hint">Showing {max} of {rows.length} rows.</p>}
    </div>
  );
}

export function ConfirmButton({ label, confirmLabel, onConfirm, danger }: { label: string; confirmLabel: string; onConfirm: () => void; danger?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" className={danger ? 'lm-btn lm-btn-danger-ghost' : 'lm-btn'} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <span className="lm-confirm">
      <button type="button" className="lm-btn lm-btn-danger" onClick={() => { setAsking(false); onConfirm(); }}>
        {confirmLabel}
      </button>
      <button type="button" className="lm-btn" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

export function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmtTime = (t?: number) => (t ? new Date(t).toLocaleString() : '—');
