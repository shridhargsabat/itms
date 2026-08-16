import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, FileText, Plus, Search, Trash2, Zap } from 'lucide-react';
import {
  createCanned, createKbArticle, deleteCanned, deleteKbArticle,
  listCanned, listKbArticles, updateKbArticle,
} from '@/api/client';
import { getCachedUser } from '@/api/client';
import { cn, formatDate, inputCls } from '@/lib/utils';
import type { KbArticle } from '@/api/types';

// P1-7 (issue #48): lite knowledge base — articles by ticket type + canned
// responses. Guardrails: created_by/updated_by shown (single KB owner),
// capture-at-close via the ticket detail convert button.

const TYPES = ['INCIDENT', 'REQUEST', 'CHANGE', 'PROBLEM', 'ACCESS', 'OTHER'];

export default function KnowledgeBase() {
  const user = getCachedUser();
  const isStaff = user?.role !== 'EMPLOYEE';
  const isAdmin = user?.role === 'ADMIN';
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'articles' | 'canned'>('articles');
  const [editing, setEditing] = useState<KbArticle | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCannedForm, setShowCannedForm] = useState(false);
  const [params] = useSearchParams();
  const openId = params.get('open');

  const articles = useQuery({
    queryKey: ['kb-articles', typeFilter, search],
    queryFn: () => listKbArticles({ ticket_type: typeFilter, search: search || undefined, limit: 100 }),
  });
  const canned = useQuery({ queryKey: ['kb-canned'], queryFn: () => listCanned() });

  const delArticle = useMutation({
    mutationFn: (id: string) => deleteKbArticle(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-articles'] }); },
  });
  const delCanned = useMutation({
    mutationFn: (id: string) => deleteCanned(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-canned'] }); },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-secondary" />
        <div>
          <h1 className="text-xl font-bold text-primary">Knowledge Base</h1>
          <p className="text-xs text-muted">Solutions by ticket type · canned responses for agents</p>
        </div>
        {isStaff && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25"
          >
            <Plus className="h-4 w-4" /> New article
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {['ALL', ...TYPES].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              typeFilter === t
                ? 'border-indigo-500/60 bg-indigo-500/15 text-accent'
                : 'border-edge text-muted hover:border-edge2 hover:text-primary',
            )}
          >
            {t === 'ALL' ? 'All types' : t}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search articles…"
            className={cn(inputCls, 'w-56 pl-8')}
          />
        </div>
      </div>

      {tab === 'canned' && (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => setTab('articles')} className="text-xs text-accent hover:underline">
            ← Articles
          </button>
          {isStaff && (
            <button
              type="button"
              onClick={() => setShowCannedForm((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-edge px-2.5 py-1 text-xs text-accent hover:bg-elevated"
            >
              <Zap className="h-3.5 w-3.5" /> {showCannedForm ? 'Close' : 'New canned response'}
            </button>
          )}
        </div>
      )}

      {(creating || editing) && (
        <ArticleForm
          article={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
      {showCannedForm && <CannedForm onDone={() => setShowCannedForm(false)} />}

      <div className="mt-5">
        {tab === 'articles' ? (
          <div className="space-y-2">
            {articles.isLoading && <p className="text-sm text-muted">Loading…</p>}
            {articles.data?.length === 0 && (
              <p className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">
                No articles yet{isStaff ? ' — capture your first resolved ticket via “Convert to article”' : ''}.
              </p>
            )}
            {articles.data?.map((a) => (
              <div key={a.id} className={cn(
                'rounded-xl border bg-surface/60 p-4',
                a.id === openId ? 'border-indigo-500/60 ring-1 ring-indigo-500/40' : 'border-edge',
              )}>
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                        {a.ticket_type}
                      </span>
                      {a.source_ticket_id && (
                        <span className="text-[10px] text-muted">from ticket</span>
                      )}
                      <h3 className="text-sm font-semibold text-primary">{a.title}</h3>
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{a.body}</p>
                    <p className="mt-2 text-[10px] text-muted">
                      {a.updated_by_name ?? '—'} · {formatDate(a.updated_at)}
                    </p>
                  </div>
                  {isStaff && (
                    <button type="button" onClick={() => setEditing(a)}
                      className="rounded-lg border border-edge px-2 py-1 text-[11px] text-accent hover:bg-elevated">
                      Edit
                    </button>
                  )}
                  {isAdmin && (
                    <button type="button" onClick={() => delArticle.mutate(a.id)}
                      className="rounded-lg border border-edge px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {canned.data?.map((c) => (
              <div key={c.id} className="rounded-xl border border-edge bg-surface/60 p-4">
                <div className="flex items-start gap-3">
                  <Zap className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-primary">{c.title}</h3>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{c.body}</p>
                  </div>
                  {isAdmin && (
                    <button type="button" onClick={() => delCanned.mutate(c.id)}
                      className="rounded-lg border border-edge px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {canned.data?.length === 0 && (
              <p className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">
                No canned responses yet.
              </p>
            )}
          </div>
        )}
      </div>

      {tab === 'articles' && isStaff && (
        <button
          type="button"
          onClick={() => setTab('canned')}
          className="mt-6 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          <Zap className="h-3.5 w-3.5" /> Canned responses for agents →
        </button>
      )}
    </div>
  );
}

function ArticleForm({ article, onClose }: { article: KbArticle | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(article?.title ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [type, setType] = useState(article?.ticket_type ?? 'INCIDENT');
  const mutation = useMutation({
    mutationFn: () =>
      article
        ? updateKbArticle(article.id, { title, body, ticket_type: type })
        : createKbArticle({ title, body, ticket_type: type }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb-articles'] });
      onClose();
    },
  });

  return (
    <div className="mt-4 rounded-xl border border-edge bg-surface p-4">
      <h2 className="text-sm font-bold text-primary">{article ? 'Edit article' : 'New article'}</h2>
      <div className="mt-3 space-y-3">
        <select value={type} onChange={(e) => setType(e.target.value)} className={cn(inputCls, 'w-48')}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className={inputCls} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          className={cn(inputCls, 'min-h-32 resize-y')}
          placeholder="Solution / steps…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!title.trim() || !body.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {article ? 'Save changes' : 'Create article'}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-edge px-3 py-2 text-xs text-muted hover:bg-elevated">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CannedForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const mutation = useMutation({
    mutationFn: () => createCanned({ title, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb-canned'] });
      setTitle(''); setBody(''); onDone();
    },
  });

  return (
    <div className="mt-4 rounded-xl border border-edge bg-surface p-4">
      <h2 className="text-sm font-bold text-primary">New canned response</h2>
      <div className="mt-3 space-y-3">
        <input className={inputCls} placeholder="Title (e.g. Password reset steps)" value={title}
          onChange={(e) => setTitle(e.target.value)} />
        <textarea className={cn(inputCls, 'min-h-24 resize-y')} placeholder="Template body…" value={body}
          onChange={(e) => setBody(e.target.value)} />
        <button
          type="button"
          disabled={!title.trim() || !body.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}
