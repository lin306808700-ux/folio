// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/index.css';

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <ErrorBoundary level="page" regionName="应用">
    <HashRouter>
      <App />
    </HashRouter>
  </ErrorBoundary>
);
