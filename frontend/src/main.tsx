import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import './index.css';
import Layout from '@/components/Layout';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';
// Route-level code splitting: each view is its own chunk, loaded on first
// navigation (Vite emits per-lazy-import chunks + a vendor chunk below).
const PasswordFlow = lazy(() => import('@/views/PasswordFlow'));
const Account = lazy(() => import('@/views/Account'));
const KnowledgeBase = lazy(() => import('@/views/KnowledgeBase'));
const Dashboard = lazy(() => import('@/views/Dashboard'));
const Assets = lazy(() => import('@/views/Assets'));
const Tickets = lazy(() => import('@/views/Tickets'));
const CMDB = lazy(() => import('@/views/CMDB'));
const AuditLog = lazy(() => import('@/views/AuditLog'));
const Masters = lazy(() => import('@/views/Masters'));
const Offline = lazy(() => import('@/views/Offline'));
const Login = lazy(() => import('@/views/Login'));
const WarrantyView = lazy(() => import('@/views/Warranty'));
const Onboarding = lazy(() => import('@/views/Onboarding'));
const Notifications = lazy(() => import('@/views/Notifications'));
const Requests = lazy(() => import('@/views/Requests'));
const Licenses = lazy(() => import('@/views/Licenses'));
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
      <div className="flex min-h-dvh items-center justify-center bg-base">
        <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
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

/** Shown while a lazy route chunk downloads (first visit to a view). */
function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-base">
      <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <RouteErrorBoundary>
            <Routes>
              <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<PasswordFlow />} />
                <Route path="/reset-password" element={<PasswordFlow />} />
              <Route
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route path="/" element={<Dashboard />} />
                <Route path="/assets" element={<Assets />} />
                <Route path="/warranty" element={<WarrantyView />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/requests" element={<Requests />} />
                <Route path="/licenses" element={<Licenses />} />
                <Route path="/tickets" element={<Tickets />} />
                <Route path="/cmdb" element={<CMDB />} />
                <Route path="/audit" element={<AuditLog />} />
                <Route path="/masters" element={<Masters />} />
                <Route path="/offline" element={<Offline />} />
                <Route path="/account" element={<Account />} />
                <Route path="/kb" element={<KnowledgeBase />} />
              </Route>
            </Routes>
          </RouteErrorBoundary>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
