import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './range/RangeApp';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './range/range.css';
import './range/ux.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
