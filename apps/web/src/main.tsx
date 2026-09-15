import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { HealthPage } from './health/HealthPage';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing in index.html');

const queryClient = new QueryClient();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HealthPage />
    </QueryClientProvider>
  </StrictMode>,
);
