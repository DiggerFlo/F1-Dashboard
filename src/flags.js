// Länderflaggen (flag-icons, MIT, lokal eingebunden): nur die Länder, in denen F1 fährt oder gefahren ist.
const files = import.meta.glob('../node_modules/flag-icons/flags/4x3/{au,bh,cn,jp,sa,us,it,mc,es,ca,at,gb,be,hu,nl,az,sg,mx,br,qa,ae,fr,de,pt,tr,ru,kr,in,za,my,vn,ar,ma,se,ch,fi}.svg', { query: '?url', import: 'default', eager: true });
const byCode = Object.fromEntries(Object.entries(files).map(([p, u]) => [p.match(/([a-z]+)\.svg$/)[1], u]));

const ISO = {
  australia: 'au', bahrain: 'bh', china: 'cn', japan: 'jp', 'saudi arabia': 'sa', 'united states': 'us', 'united states of america': 'us', usa: 'us', america: 'us', italy: 'it', monaco: 'mc', spain: 'es',
  canada: 'ca', austria: 'at', 'united kingdom': 'gb', uk: 'gb', 'great britain': 'gb', england: 'gb', belgium: 'be', hungary: 'hu', netherlands: 'nl', holland: 'nl',
  azerbaijan: 'az', singapore: 'sg', mexico: 'mx', brazil: 'br', qatar: 'qa', 'united arab emirates': 'ae', uae: 'ae', france: 'fr', germany: 'de', portugal: 'pt',
  turkey: 'tr', turkiye: 'tr', russia: 'ru', 'south korea': 'kr', korea: 'kr', india: 'in', 'south africa': 'za', malaysia: 'my', vietnam: 'vn', argentina: 'ar',
  morocco: 'ma', sweden: 'se', switzerland: 'ch', finland: 'fi',
};

const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();

/** URL der Flagge zu einem Ländernamen (englisch, auch USA/UK/UAE), sonst null. */
export const flagUrl = (country) => byCode[ISO[norm(country)]] || null;

/** Land aus Texten wie "Baku · Azerbaijan" (letzter Teil nach " · "). */
export const countryOf = (text) => String(text || '').split(' · ').pop();
