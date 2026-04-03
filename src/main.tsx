import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ServerProvider } from './contexts/ServerContext.tsx'
import { I18nextProvider } from 'react-i18next'
import './index.css'
import i18n from './i18n/i18n'
import { LanguageProvider } from './contexts/LanguageContext.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <LanguageProvider>
        <ServerProvider>
          <App />
        </ServerProvider>
      </LanguageProvider>
    </I18nextProvider>
  </React.StrictMode>,
)
