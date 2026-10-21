import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff } from 'lucide-react';
import { getNotifications, getUnreadCount, markAllNotificationsRead, markNotificationRead } from '@/api/client';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/Button';

const KIND_ICON: Record<string, string> = {
  TICKET_ASSIGNED: '🎫',
  TICKET_STATUS: '🔄',
  TICKET_COMMENT: '💬',
  REQUEST_ASSIGNED: '📨',
  REQUEST_APPROVED: '✅',
  REQUEST_REJECTED: '⛔',
};

export default function NotificationsBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320 });
  const navigate = useNavigate();
  const qc = useQueryClient();

  // poll unread count every 45s + on visibility regain
  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  });
  const items = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getNotifications({ limit: 15 }),
    enabled: open,
  });

  // Place the dropdown as a FIXED, PORTALED panel measured from the bell's
  // live rect. Anchoring it with `absolute right-0` inside the header clips
  // it: on mobile the bell sits mid-header (Download/Theme/Logout are to its
  // right), so a right-anchored 320px panel runs off the LEFT edge of the
  // viewport ("Notifications" → "s", titles truncated at the left). Same trap
  // on desktop with an expanded sidebar (bell at x≈180, panel needed −140).
  // Portal to body also escapes the header's backdrop-blur containing block.
  const place = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const width = vw < 640 ? vw - 24 : Math.min(320, vw - 24); // mobile: full-bleed, desktop: 320
    const left =
      vw < 640
        ? 12 // mobile: full-width panel below the header
        : Math.max(12, Math.min(r.left, vw - width - 12));
    setPos({ top: r.bottom + 8, left, width });
  };

  // Measure + place synchronously after the panel is committed (before
  // paint) — same pattern as Select's useLayoutEffect placement.
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const reposition = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    const onDown = (e: MouseEvent) => {
      // Ignore mousedowns inside the trigger OR the portaled panel —
      // otherwise the click that opens a notification never lands (the
      // panel would unmount between mousedown and click).
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Follow the header while the page scrolls (sticky header / fixed
    // sidebar — belt and braces, same as Select).
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  // Refresh on window focus (user returns to the tab/PWA).
  useEffect(() => {
    const onFocus = () => {
      qc.invalidateQueries({ queryKey: ['unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [qc]);

  const count = visible ? (unread.data?.unread ?? 0) : 0;

  const openItem = (n: { id: string; ref_type: string | null; ref_id: string | null }) => {
    markNotificationRead(n.id).then(() => qc.invalidateQueries({ queryKey: ['unread-count'] }));
    setOpen(false);
    if (n.ref_type === 'ticket') navigate(`/tickets?open=${n.ref_id}`);
    else if (n.ref_type === 'service_request') navigate(`/requests?open=${n.ref_id}`);
  };

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <Button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        variant="ghost"
        className="relative h-11 w-11 shrink-0 hover:text-accent"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="animate-menu-in z-[70] overflow-hidden rounded-xl glass-chrome"
          >
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Notifications</p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  onClick={() => markAllNotificationsRead().then(() => {
                    qc.invalidateQueries({ queryKey: ['unread-count'] });
                    qc.invalidateQueries({ queryKey: ['notifications'] });
                  })}
                  variant="ghost"
                  className="px-2 py-0.5 text-[10px] text-accent"
                >
                  Mark all read
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setVisible((v) => !v);
                    if (!visible) qc.invalidateQueries({ queryKey: ['unread-count'] });
                  }}
                  aria-label="Toggle badge"
                  variant="ghost"
                  className="px-1.5 py-0.5 text-muted"
                >
                  <BellOff className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.data?.items.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-muted">No notifications yet.</p>
              )}
              {(items.data?.items ?? []).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn(
                    'flex w-full items-start gap-2.5 border-b border-edge/50 px-3 py-2.5 text-left transition-colors hover:bg-elevated/40',
                    !n.read_at && 'bg-accent/5',
                  )}
                >
                  <span className="mt-0.5 shrink-0 text-sm">{KIND_ICON[n.kind] ?? '🔔'}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-xs font-medium', n.read_at ? 'text-secondary' : 'text-primary')}>
                      {n.title}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted">{n.body}</span>
                    <span className="mt-0.5 block font-mono text-[9px] text-muted">{formatDate(n.created_at)}</span>
                  </span>
                  {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                </button>
              ))}
            </div>
            <Button
              type="button"
              onClick={() => { setOpen(false); navigate('/notifications'); }}
              variant="ghost"
              className="w-full border-t border-edge px-3 py-2 text-[11px] text-accent"
            >
              View all notifications
            </Button>
          </div>,
          document.body,
        )}
    </div>
  );
}
