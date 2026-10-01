import { useState } from 'react';
import { Alert, Badge, Button, Empty, Popover, Segmented, Select, Switch } from 'antd';
import { ArrowUpOutlined, AuditOutlined, CarOutlined, CheckCircleFilled, CloudOutlined, FlagFilled, InfoCircleFilled, MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined, StopOutlined, ThunderboltFilled, ToolOutlined, WarningFilled } from '@ant-design/icons';
import { fmtTime } from '../../js/format.js';
import { enginesFor, transcribe } from '../../js/transcribe.js';
import { Swatch, Avatar, Tyre } from './bits.jsx';
import { fmtSecs } from '../../js/pitstops.js';
import { describeRc } from '../../js/racecontrol.js';
import { t } from '../../js/i18n.js';

const RC_ICON = { flag: <FlagFilled />, warn: <WarningFilled />, ok: <CheckCircleFilled />, bolt: <ThunderboltFilled />, car: <CarOutlined />, rain: <CloudOutlined />, steward: <AuditOutlined />, tool: <ToolOutlined />, info: <InfoCircleFilled /> };
import { RadioPlayer } from './RadioPlayer.jsx';
import { safeColor } from '../../js/format.js';
import { teamColor } from '../../js/teams.js';

const ACTIONS = ['overtake', 'pit', 'dnf'];
const CAT_KEYS = ['radio', 'rc', 'overtake', 'pit', 'dnf'];
const catOf = (m) => (m.kind === 'radio' || ACTIONS.includes(m.kind) ? m.kind : 'rc');
/** Reiter: Alle (nur eingeschaltete Arten), Funk, Rennleitung, Aktionen (Überholungen, Boxenstopps, Ausfälle). */
const visible = (m, filter, show) => (filter === 'all' ? show[catOf(m)] !== false : filter === 'radio' ? catOf(m) === 'radio' : filter === 'rc' ? catOf(m) === 'rc' : ACTIONS.includes(catOf(m)));
const filters = (items, show) => {
  const n = (f) => <span className="fcount mono">{items.filter((m) => visible(m, f, show)).length}</span>;
  return [{ value: 'all', label: <>{t('feed.tab.all')}{n('all')}</> }, { value: 'radio', label: <>{t('feed.tab.radio')}{n('radio')}</> }, { value: 'rc', label: <>{t('feed.tab.rc')}{n('rc')}</> }, { value: 'actions', label: <>{t('feed.tab.actions')}{n('actions')}</> }];
};

/** Fahrerbild: Foto, sonst eine Kachel in Teamfarbe mit dem Kürzel. */
function Face({ d, code }) {
  if (d?.photo) return <Avatar d={d} size={42} />;
  return <span className="face" style={{ '--ac': safeColor(d?.color) || teamColor(d?.team) || 'var(--line)' }} aria-hidden="true">{(code || '?').slice(0, 3)}</span>;
}

function Transcript({ st }) {
  if (!st) return null;
  if (st.status === 'loading') return <p className="tr muted" role="status">{st.pct != null ? t('feed.tr.loadingModel', { pct: st.pct }) : t('feed.tr.running')}</p>;
  if (st.status === 'error') return <Alert className="tr" type="warning" showIcon role="alert" message={st.error} />;
  return <p className="tr"><span className="label">{t('feed.tr.label')}</span><br />{st.text}</p>;
}

/** Überholung, Boxenstopp oder Ausfall als kompakte Zeile. */
function EventRow({ m, byCode }) {
  const d = byCode.get(m.code);
  const col = safeColor(m.color) || safeColor(d?.color) || teamColor(d?.team) || 'var(--ink-muted)';
  const who = <><Avatar d={d} size={26} /><Swatch color={col} team={d?.team} /><strong className="code">{m.code}</strong></>;
  let tag, icon, body;
  if (m.kind === 'overtake') {
    const o = byCode.get(m.over);
    tag = t('feed.ev.overtake'); icon = <ArrowUpOutlined />;
    body = <p className="evp">{who}<span className="muted">{t('feed.ev.overtakes')}</span><Swatch color={m.overColor} team={o?.team} /><strong className="code">{m.over}</strong><span className="muted">· P{m.pos}</span></p>;
  } else if (m.kind === 'pit') {
    tag = t('feed.ev.pit'); icon = <ToolOutlined />;
    body = (<>
      <p className="evp">{who}{m.lap ? <span className="muted">{t('feed.ev.lap', { lap: m.lap })}</span> : null}{m.tyre ? <><span className="muted">{t('feed.ev.newTyre')}</span><Tyre c={m.tyre} /></> : null}</p>
      <span className="evnums mono"><span title={t('pit.stationaryTip')}><b>{fmtSecs(m.stop)}</b> {t('feed.ev.stationary')}</span><span title={t('pit.totalTip')}><b>{fmtSecs(m.lane)}</b> {t('feed.ev.inPit')}</span></span>
    </>);
  } else {
    tag = t('feed.ev.dnf'); icon = <StopOutlined />;
    body = <p className="evp">{who}<span className="muted">{t('feed.ev.retired')}</span></p>;
  }
  return (
    <div className={`msg ev ${m.kind}`} style={{ '--team': col }}>
      <div className="meta"><span className="evic" aria-hidden="true">{icon}</span><span className="tag">{tag}</span><span className="t mono">{fmtTime(m.t)}</span></div>
      {body}
    </div>
  );
}

function Message({ m, st, onTranscribe, driver, proxy, byCode }) {
  if (ACTIONS.includes(m.kind)) return <EventRow m={m} byCode={byCode} />;
  if (m.kind !== 'radio') {
    const r = describeRc(m);
    return (
      <div className={`msg rc tone-${r.tone}`}>
        <span className="rcic" aria-hidden="true">{RC_ICON[r.icon] || RC_ICON.info}</span>
        <div className="rcbody">
          <div className="rch"><span className="rccat">{r.cat}</span><span className="t mono">{fmtTime(m.t)}</span></div>
          <strong className="rct">{r.title}</strong>
          {r.detail && <p className="rcd">{r.detail}</p>}
          {r.codes.length > 0 && <div className="rcc">{r.codes.map((c) => <span key={c} className="rcchip"><Swatch color={byCode.get(c)?.color} team={byCode.get(c)?.team} /><span className="code">{c}</span></span>)}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="msg radio" style={{ '--team': safeColor(driver?.color) || teamColor(driver?.team) || 'var(--ink-muted)' }}>
      <div className="mhd">
        <Face d={driver} code={m.code} />
        <div className="who2"><span className="who">{m.code || '—'}</span>{driver?.team && <span className="team muted">{driver.team}</span>}</div>
        <span className="t mono">{fmtTime(m.t)}</span>
      </div>
      {m.text && <p>{m.text}</p>}
      {m.origin && <span className="origin muted">{t('feed.origin', { origin: m.origin })}</span>}
      {(m.url || m.speech) && <RadioPlayer m={m} proxy={proxy} color={safeColor(driver?.color) || teamColor(driver?.team)} />}
      {(m.url || m.speech) && (
        <Select
          size="small" variant="borderless" value={null} placeholder={t('feed.tr.placeholder')} aria-label={t('feed.tr.aria')} className="trsel"
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
export function Feed({ items, show = {}, onShow, drivers = [], filter, onFilter, collapsed = false, onToggle, sub, note, proxy = null, getKey = () => null }) {
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
  const list = items.filter((m) => visible(m, filter, show)).slice(0, 100); // erst filtern, dann kürzen: sonst fehlen ältere Funksprüche trotz Zähler
  const settings = (
    <div className="evset">
      <span className="label">{t('feed.show')}</span>
      {CAT_KEYS.map((k) => (
        <label key={k} className="evrow"><span>{t(`feed.cat.${k}`)}</span><Switch size="small" checked={show[k] !== false} onChange={(v) => onShow?.(k, v)} aria-label={t('feed.showAria', { name: t(`feed.cat.${k}`) })} /></label>
      ))}
    </div>
  );
  return (
    <aside className={`side${collapsed ? ' collapsed' : ''}`} aria-label={t('feed.aria')}>
      <div className="sideh">
        <Button type="text" size="small" className="sidetoggle" aria-expanded={!collapsed} aria-label={collapsed ? t('feed.expand') : t('feed.collapse')} title={collapsed ? t('feed.expand') : t('feed.collapse')}
          icon={collapsed ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={onToggle} />
        <h2>{t('feed.title')}</h2>
        {collapsed && <Badge count={items.filter((m) => visible(m, 'all', show)).length} overflowCount={99} size="small" color="#e8112d" />}
        <span className="label sidesub">{sub}</span>
        <Popover trigger="click" placement="bottomRight" content={settings}>
          <Button type="text" size="small" className="evgear" icon={<SettingOutlined />} aria-label={t('feed.settings')} title={t('feed.settings')} />
        </Popover>
      </div>
      <Segmented block size="small" className="seg" options={filters(items, show)} value={filter} onChange={onFilter} aria-label={t('feed.filter')} />
      <div className="sidebody">
        {list.length ? list.map((m) => <Message key={m.id} m={m} st={tstate[m.id]} onTranscribe={run} driver={byCode.get(m.code)} proxy={proxy} byCode={byCode} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('feed.empty')} />}
      </div>
      <div className="sidefoot">{note}</div>
    </aside>
  );
}
