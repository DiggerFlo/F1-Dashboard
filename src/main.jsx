import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import deDE from 'antd/locale/de_DE';
import enGB from 'antd/locale/en_GB';
import { App } from './App.jsx';
import { scaledTheme } from './theme.js';
import { initLang } from '../js/i18n.js';
import { useLang } from './useLang.js';
import { useScale } from './useScale.js';
import './styles.css';

initLang();

/** Ant-Design-Texte (Platzhalter, Leerzustände) folgen der gewählten Sprache. */
function Root() {
  const lang = useLang();
  const k = useScale();
  return (
    <ConfigProvider theme={scaledTheme(k)} locale={lang === 'de' ? deDE : enGB}>
      <App />
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
