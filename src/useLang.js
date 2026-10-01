import { useSyncExternalStore } from 'react';
import { getLang, subscribe } from '../js/i18n.js';

/** Aktuelle Sprache; die Komponente rendert neu, wenn sie gewechselt wird. */
export const useLang = () => useSyncExternalStore(subscribe, getLang, () => 'de');
