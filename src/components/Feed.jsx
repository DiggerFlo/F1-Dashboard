import { useState } from 'react';
import { Alert, Badge, Button, Empty, Segmented, Select } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { fmtTime } from '../../js/format.js';
import { enginesFor, transcribe } from '../../js/transcribe.js';
import { Swatch } from './bits.jsx';
import { RadioPlayer } from './RadioPlayer.jsx';
import { safeColor } from '../../js/format.js';
import { teamColor } from '../../js/teams.js';

const FILTERS = [{ value: 'all', label: 'Alle' }, { value: 'radio', label: 'Funk' }, { value: 'rc', label: 'Race Control' }];

function Transcript({ st }) {
  if (!st) return null;
  if (st.status === 'loading') return <p className="tr muted" role="status">{st.pct != null ? `Modell wird geladen … ${st.pct} %` : 'Transkribiere …'}</p>;
  if (st.status === 'error') return <Alert className="tr" type="warning" showIcon role="alert" message={st.error} />;
  return <p className="tr"><span className="label">Transkript</span><br />{st.text}</p>;
}

function Message({ m, st, onTranscribe, driver, proxy }) {
  if (m.kind !== 'radio') {
    const cls = m.level === 'red' ? ' rf' : m.level === 'yellow' ? ' fy' : '';
    return (
      <div className={`msg rc${cls}`}>
        <div className="meta"><span className="label">Race Control</span><span className="t mono">{fmtTime(m.t)}</span><span className={`tag${m.level === 'yellow' ? ' y' : ''}`}>{m.tag || 'INFO'}</span></div>
        <p>{m.text}</p>
      </div>
    );
  }
  return (
    <div className="msg">
      <div className="meta"><Swatch color={driver?.color} team={driver?.team} /><span className="who">{m.code || '—'}</span>{driver?.team && <span className="team muted">{driver.team}</span>}<span className="t mono">{fmtTime(m.t)}</span><span className="tag">{m.tag || 'FUNK'}</span></div>
      {m.text && <p>{m.text}</p>}
      {m.origin && <span className="origin muted">Original-Funk · {m.origin}</span>}
      {(m.url || m.speech) && <RadioPlayer m={m} proxy={proxy} color={safeColor(driver?.color) || teamColor(driver?.team)} />}
      {(m.url || m.speech) && (
        <Select
          size="small" value={null} placeholder="Transkribieren …" aria-label="Funkspruch transkribieren" className="trsel"
          options={enginesFor(m).map((e) => ({ value: e.id, label: e.label }))} onChange={(v) => v && onTranscribe(m, v)}
        />
      )}
      <Transcript st={st} />
    </div>
  );
}

/**
 * Seitenleiste mit Funk und Race-Control. Nachrichten haben stabile Keys, damit Audio,
 * offene Dropdowns und Transkripte beim Live-Update erhalten bleiben.
 */
export function Feed({ items, drivers = [], filter, onFilter, collapsed = false, onToggle, sub, note, proxy = null, getKey = () => null }) {
  const [tstate, setT] = useState({}); // id -> { status, text, pct, error }
  const put = (id, v) => setT((s) => ({ ...s, [id]: v }));

  async function run(m, engine) {
    put(m.id, { status: 'loading', pct: null });
    try {
      const text = await transcribe(engine, m, { proxy, getKey, onProgress: (pct) => put(m.id, { status: 'loading', pct }) });
      put(m.id, { status: 'done', text: text || '(kein Text erkannt)' });
    } catch (e) {
      put(m.id, { status: 'error', error: e.message });
    }
  }

  const byCode = new Map(drivers.map((d) => [d.code, d]));
  const list = items.slice(0, 40).filter((m) => filter === 'all' || (filter === 'radio' ? m.kind === 'radio' : m.kind !== 'radio'));
  return (
    <aside className={`side${collapsed ? ' collapsed' : ''}`} aria-label="Funk und Race Control">
      <div className="sideh">
        <Button type="text" size="small" className="sidetoggle" aria-expanded={!collapsed} aria-label={collapsed ? 'Funk einblenden' : 'Funk minimieren'} title={collapsed ? 'Funk einblenden' : 'Funk minimieren'}
          icon={collapsed ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={onToggle} />
        <h2>Funk</h2>
        {collapsed && <Badge count={items.length} overflowCount={99} size="small" color="#e8112d" />}
        <span className="label sidesub">{sub}</span>
      </div>
      <Segmented block size="small" className="seg" options={FILTERS} value={filter} onChange={onFilter} aria-label="Meldungen filtern" />
      <div className="sidebody">
        {list.length ? list.map((m) => <Message key={m.id} m={m} st={tstate[m.id]} onTranscribe={run} driver={byCode.get(m.code)} proxy={proxy} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Noch keine Meldungen." />}
      </div>
      <div className="sidefoot">{note}</div>
    </aside>
  );
}
