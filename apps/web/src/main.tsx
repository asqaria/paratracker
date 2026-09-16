import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { FlightViewerPage } from './flight/FlightViewerPage';
import { HealthPage } from './health/HealthPage';
import { trackUrlFromHash } from './routing';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing in index.html');

const queryClient = new QueryClient();
const trackUrl = trackUrlFromHash(window.location.hash);

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {trackUrl === null ? <HealthPage /> : <FlightViewerPage trackUrl={trackUrl} />}
    </QueryClientProvider>
  </StrictMode>,
);
