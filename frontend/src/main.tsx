import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import './index.css';
import Layout from '@/components/Layout';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';
import { RequireAuth } from '@/components/RequireAuth';
import { initGlobalErrorReporting } from '@/lib/errorBeacon';
// Route-level code splitting: each view is its own chunk, loaded on first
// navigation (Vite emits per-lazy-import chunks + a vendor chunk below).
const PasswordFlow = lazy(() => import('@/views/PasswordFlow'));
const Account = lazy(() => import('@/views/Account'));
const KnowledgeBase = lazy(() => import('@/views/KnowledgeBase'));
const Reports = lazy(() => import('@/views/Reports'));
const Scan = lazy(() => import('@/views/Scan'));
const Labels = lazy(() => import('@/views/Labels'));
const Dashboard = lazy(() => import('@/views/Dashboard'));
const Assets = lazy(() => import('@/views/Assets'));
const Tickets = lazy(() => import('@/views/Tickets'));
const CMDB = lazy(() => import('@/views/CMDB'));
const AuditLog = lazy(() => import('@/views/AuditLog'));
const Masters = lazy(() => import('@/views/Masters'));
const Settings = lazy(() => import('@/views/Settings'));
const OAuthCallback = lazy(() => import('@/views/OAuthCallback'));
const Offline = lazy(() => import('@/views/Offline'));
const Login = lazy(() => import('@/views/Login'));
const WarrantyView = lazy(() => import('@/views/Warranty'));
const Onboarding = lazy(() => import('@/views/Onboarding'));
const Notifications = lazy(() => import('@/views/Notifications'));
const Requests = lazy(() => import('@/views/Requests'));
const Licenses = lazy(() => import('@/views/Licenses'));
import { captureInstallPrompt, initSwUpdateHandling } from '@/lib/pwa';

captureInstallPrompt();
initSwUpdateHandling();
initGlobalErrorReporting();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

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
                {/* #53: SSO landing — must be OUTSIDE RequireAuth (token arrives in the URL) */}
                <Route path="/oauth/callback" element={<OAuthCallback />} />
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
                <Route path="/settings" element={<Settings />} />
                <Route path="/offline" element={<Offline />} />
                <Route path="/account" element={<Account />} />
                <Route path="/kb" element={<KnowledgeBase />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/scan" element={<Scan />} />
                <Route path="/labels" element={<Labels />} />
              </Route>
            </Routes>
          </RouteErrorBoundary>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
