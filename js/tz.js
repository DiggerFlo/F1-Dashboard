// Zeitzonen der Strecken (IANA), damit der Wochenendplan die Ortszeit der Strecke und die Zeit des Nutzers getrennt zeigen kann.
const ZONES = {
  austin: 'America/Chicago', bahrain: 'Asia/Bahrain', baku: 'Asia/Baku', buddh: 'Asia/Kolkata', catalunya: 'Europe/Madrid', hockenheimring: 'Europe/Berlin',
  hungaroring: 'Europe/Budapest', imola: 'Europe/Rome', interlagos: 'America/Sao_Paulo', istanbul: 'Europe/Istanbul', jeddah: 'Asia/Riyadh',
  'las-vegas': 'America/Los_Angeles', lusail: 'Asia/Qatar', madring: 'Europe/Madrid', 'marina-bay': 'Asia/Singapore', melbourne: 'Australia/Melbourne',
  'mexico-city': 'America/Mexico_City', miami: 'America/New_York', monaco: 'Europe/Monaco', montreal: 'America/Toronto', monza: 'Europe/Rome',
  mugello: 'Europe/Rome', nurburgring: 'Europe/Berlin', 'paul-ricard': 'Europe/Paris', portimao: 'Europe/Lisbon', sepang: 'Asia/Kuala_Lumpur',
  shanghai: 'Asia/Shanghai', silverstone: 'Europe/London', sochi: 'Europe/Moscow', 'spa-francorchamps': 'Europe/Brussels', spielberg: 'Europe/Vienna',
  suzuka: 'Asia/Tokyo', valencia: 'Europe/Madrid', 'yas-marina': 'Asia/Dubai', yeongam: 'Asia/Seoul', zandvoort: 'Europe/Amsterdam',
};

/** Zeitzone der Strecke zu einer Layout-Kennung (z. B. 'monza-7', 'demo-monza'), sonst null. */
export function trackZone(layoutId) {
  const id = String(layoutId || '').replace(/^demo-/, '').replace(/-\d+$/, '');
  return ZONES[id] || null;
}

/** Kurzname der Zone zu einem Zeitpunkt (z. B. 'GMT+4', 'CEST'). */
export function zoneName(ms, zone, loc) {
  try {
    const p = new Intl.DateTimeFormat(loc, { timeZone: zone, timeZoneName: 'short' }).formatToParts(ms).find((x) => x.type === 'timeZoneName');
    return p ? p.value : '';
  } catch { return ''; }
}
