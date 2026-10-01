import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import deDE from 'antd/locale/de_DE';
import { App } from './App.jsx';
import { pitwallTheme } from './theme.js';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <ConfigProvider theme={pitwallTheme} locale={deDE}>
    <App />
  </ConfigProvider>,
);
