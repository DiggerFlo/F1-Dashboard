import { theme } from 'antd';

// Ant Design im dunklen Pitwall-Look: kantig, Rennrot als Akzent.
const BASE = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#e8112d',
    colorBgBase: '#0b0b0e',
    colorBgContainer: '#17171c',
    colorBgElevated: '#1e1e25',
    colorBorder: '#2e2e37',
    colorBorderSecondary: '#2e2e37',
    colorTextBase: '#f5f5f3',
    colorSuccess: '#00d26a',
    colorWarning: '#ffcc00',
    colorError: '#e8112d',
    borderRadius: 2,
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: 14,
  },
  components: {
    Menu: { horizontalItemSelectedColor: '#f5f5f3', itemBg: 'transparent', activeBarHeight: 3 },
    Table: { headerBg: '#17171c', rowHoverBg: '#1e1e25', cellPaddingBlockSM: 6 },
  },
};

/** Theme für den Skalierungsfaktor k: Schrift, Abstände und Steuerelementhöhen von Ant Design wachsen mit der Oberfläche. */
export function scaledTheme(k = 1) {
  if (k === 1) return BASE;
  return {
    ...BASE,
    token: { ...BASE.token, fontSize: Math.round(14 * k * 10) / 10, sizeUnit: 4 * k, sizeStep: 4 * k, controlHeight: Math.round(32 * k) },
    components: { ...BASE.components, Table: { ...BASE.components.Table, cellPaddingBlockSM: Math.round(6 * k) } },
  };
}

export const pitwallTheme = BASE;
