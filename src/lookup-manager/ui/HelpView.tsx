import { useEffect, useMemo, useState } from 'react';
import { CodeBlock } from './components';
import { GUIDE, type GuideBlock, type GuideSection } from './guide';

const textOf = (s: GuideSection) =>
  [s.title, s.summary, ...s.blocks.flatMap((b: GuideBlock) => ('text' in b ? [b.text] : 'items' in b ? b.items : 'code' in b ? [b.title, b.code, b.note ?? ''] : [...b.head, ...b.rows.flat()]))]
    .join(' ')
    .toLowerCase();

function Block({ b }: { b: GuideBlock }) {
  switch (b.type) {
    case 'p':
      return <p>{b.text}</p>;
    case 'steps':
      return (
        <ol className="lm-guide-steps">
          {b.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      );
    case 'list':
      return (
        <ul>
          {b.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      );
    case 'tip':
      return (
        <div className="lm-callout lm-callout-tip">
          <strong>Tip</strong> {b.text}
        </div>
      );
    case 'warn':
      return (
        <div className="lm-callout lm-callout-warn">
          <strong>Note</strong> {b.text}
        </div>
      );
    case 'example':
      return (
        <div className="lm-guide-example">
          <CodeBlock label={`Example: ${b.title}`} code={b.code} />
          {b.note && <p className="lm-hint">{b.note}</p>}
        </div>
      );
    case 'table':
      return (
        <div className="lm-table-wrap">
          <table className="lm-table">
            <thead>
              <tr>
                {b.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.join('|')}>
                  {r.map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** The guide: topic list and the selected topic. */
export function HelpView({ section, compact }: { section?: string; compact?: boolean }) {
  const [current, setCurrent] = useState(section && GUIDE.some((s) => s.id === section) ? section : GUIDE[0].id);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (section && GUIDE.some((s) => s.id === section)) setCurrent(section);
  }, [section]);
  const visible = useMemo(() => (filter.trim() ? GUIDE.filter((s) => textOf(s).includes(filter.trim().toLowerCase())) : GUIDE), [filter]);
  const idx = GUIDE.findIndex((s) => s.id === current);
  const s = GUIDE[idx];

  return (
    <div className={compact ? 'lm-guide lm-guide-compact' : 'lm-guide'}>
      <nav className="lm-guide-nav" aria-label="Guide topics">
        <input placeholder="Search the guide" aria-label="Search the guide" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul>
          {visible.map((g) => (
            <li key={g.id}>
              <button type="button" className={g.id === current ? 'lm-guide-link lm-guide-current' : 'lm-guide-link'} aria-current={g.id === current ? 'page' : undefined} onClick={() => setCurrent(g.id)}>
                {g.title}
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="lm-hint">No topics match.</li>}
        </ul>
      </nav>
      <article className="lm-guide-body" aria-labelledby={`lm-guide-${s.id}`}>
        <h2 id={`lm-guide-${s.id}`}>{s.title}</h2>
        <p className="lm-hint lm-guide-summary">{s.summary}</p>
        {s.blocks.map((b, i) => (
          <Block key={i} b={b} />
        ))}
        <div className="lm-row lm-between lm-guide-pager">
          <button type="button" className="lm-btn" disabled={idx === 0} onClick={() => setCurrent(GUIDE[idx - 1].id)}>
            {idx > 0 ? `← ${GUIDE[idx - 1].title}` : '←'}
          </button>
          <button type="button" className="lm-btn" disabled={idx === GUIDE.length - 1} onClick={() => setCurrent(GUIDE[idx + 1].id)}>
            {idx < GUIDE.length - 1 ? `${GUIDE[idx + 1].title} →` : '→'}
          </button>
        </div>
      </article>
    </div>
  );
}

/** The guide in a side panel, so it can be read without leaving the editor. */
export function HelpDrawer({ section, onClose }: { section: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lm-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="lm-drawer" role="dialog" aria-modal="true" aria-label="Lookup Forge guide">
        <div className="lm-row lm-between lm-drawer-head">
          <strong>Guide</strong>
          <button type="button" className="lm-btn lm-btn-small" onClick={onClose}>
            Close
          </button>
        </div>
        <HelpView section={section} compact />
      </aside>
    </div>
  );
}
