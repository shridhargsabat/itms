import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import './index.css';
import Layout from '@/components/Layout';
import Dashboard from '@/views/Dashboard';
import Assets from '@/views/Assets';
import Tickets from '@/views/Tickets';
import CMDB from '@/views/CMDB';
import AuditLog from '@/views/AuditLog';
import Offline from '@/views/Offline';
import Login from '@/views/Login';
import { captureInstallPrompt, initSwUpdateHandling } from '@/lib/pwa';
import { ApiError, clearSession, getCachedUser, getToken, me } from '@/api/client';

captureInstallPrompt();
initSwUpdateHandling();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/** Real auth gate: token present AND valid against /auth/me.
 *  Offline (network failure) falls back to the cached session so the SWR
 *  data cache still renders; only a hard 401 bounces to /login. */
function RequireAuth({ children }: { children: ReactNode }) {
  const token = getToken();
  const cached = getCachedUser();
  const location = useLocation();
  const { isLoading, isError, error } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    enabled: !!token,
    retry: false,
  });

  if (!token) return <Navigate to="/login" replace />;
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950">
        <LoaderCircle className="h-6 w-6 animate-spin text-indigo-400" />
      </div>
    );
  }
  if (isError) {
    const real401 = error instanceof ApiError && error.status === 401;
    if (!real401 && cached) {
      return <>{children}</>; // offline — cached session, cached data
    }
    clearSession();
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
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
