import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import Layout from '@/components/Layout';
import Dashboard from '@/views/Dashboard';
import Assets from '@/views/Assets';
import Tickets from '@/views/Tickets';
import CMDB from '@/views/CMDB';
import AuditLog from '@/views/AuditLog';
import Offline from '@/views/Offline';
import { captureInstallPrompt } from '@/lib/pwa';

captureInstallPrompt();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/cmdb" element={<CMDB />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/offline" element={<Offline />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
