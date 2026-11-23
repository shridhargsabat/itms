import { useEffect } from 'react';
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
import { useServerPagination } from '@/lib/usePagination';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import PageHeader from '@/components/PageHeader';
import PaginationFooter from '@/components/PaginationFooter';
import { Button } from '@/components/Button';
import Select from '@/components/Select';
import type { KbArticle } from '@/api/types';
import { TICKET_TYPES } from '@/api/types';

// P1-7 (issue #48): lite knowledge base — articles by ticket type + canned
// responses. Guardrails: created_by/updated_by shown (single KB owner),
// capture-at-close via the ticket detail convert button.

const TYPES = TICKET_TYPES;

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

  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);

  const articles = useQuery({
    queryKey: ['kb-articles', typeFilter, search, page, pageSize],
    queryFn: () =>
      listKbArticles({ ticket_type: typeFilter, search: search || undefined, limit: pageSize, offset }),
  });
  // Any type filter or search change resets to page 1.
  useEffect(() => {
    reset();
  }, [typeFilter, search]);
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
      <PageHeader
        title="Knowledge Base"
        description="Solutions by ticket type · canned responses for agents"
        actions={
          isStaff ? (
            <Button
              type="button"
              onClick={() => setCreating(true)}
              variant="primary"
              leftIcon={<Plus className="h-4 w-4" />}
            >
              New article
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        {['ALL', ...TYPES].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              typeFilter === t
                ? 'border-edge2 bg-elevated font-medium text-primary'
                : 'border-edge text-secondary hover:text-primary',
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
      </FilterBar>

      {tab === 'canned' && (
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" onClick={() => setTab('articles')} variant="text" className="text-xs">
            ← Articles
          </Button>
          {isStaff && (
            <Button
              type="button"
              onClick={() => setShowCannedForm((v) => !v)}
              className="ml-auto border-edge px-2.5 py-1 text-xs text-accent"
              variant="secondary"
              size="sm"
              leftIcon={<Zap className="h-3.5 w-3.5" />}
            >
              {showCannedForm ? 'Close' : 'New canned response'}
            </Button>
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
            {!articles.isLoading && (articles.data?.items.length ?? 0) === 0 && (
              <EmptyState
                icon={BookOpen}
                title="No articles yet"
                description={
                  isStaff
                    ? 'Capture your first resolved ticket via “Convert to article”.'
                    : 'No solutions match this search. Try different keywords.'
                }
                action={
                  isStaff ? (
                    <Button
                      type="button"
                      onClick={() => setCreating(true)}
                      variant="primary"
                      leftIcon={<Plus className="h-4 w-4" />}
                    >
                      New article
                    </Button>
                  ) : undefined
                }
              />
            )}
            {articles.data?.items.map((a) => (
              <div key={a.id} className={cn(
                'rounded-xl border border-edge bg-surface p-4',
                a.id === openId && 'border-accent ring-1 ring-accent/30',
              )}>
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-medium text-secondary">
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
                    <Button type="button" onClick={() => setEditing(a)}
                      variant="secondary" size="sm" className="border-edge px-2 py-1 text-[11px] text-accent">
                      Edit
                    </Button>
                  )}
                  {isAdmin && (
                    <Button type="button" onClick={() => delArticle.mutate(a.id)}
                      variant="ghost" size="sm" className="border border-edge px-2 py-1 text-red-400 hover:bg-red-500/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <PaginationFooter
              page={page}
              pageSize={pageSize}
              total={articles.data?.total}
              rowsLength={articles.data?.items.length ?? 0}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        ) : (
          <div className="space-y-2">
            {canned.data?.map((c) => (
              <div key={c.id} className="rounded-xl border border-edge bg-surface p-4">
                <div className="flex items-start gap-3">
                  <Zap className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-primary">{c.title}</h3>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{c.body}</p>
                  </div>
                  {isAdmin && (
                    <Button type="button" onClick={() => delCanned.mutate(c.id)}
                      variant="ghost" size="sm" className="border border-edge px-2 py-1 text-red-400 hover:bg-red-500/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {canned.data?.length === 0 && (
              <EmptyState
                icon={Zap}
                title="No canned responses yet"
                description="Create reusable replies agents can insert into ticket comments."
                action={
                  isStaff ? (
                    <Button
                      type="button"
                      onClick={() => setShowCannedForm(true)}
                      variant="primary"
                      leftIcon={<Plus className="h-4 w-4" />}
                    >
                      New canned response
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        )}
      </div>

      {tab === 'articles' && isStaff && (
        <Button
          type="button"
          onClick={() => setTab('canned')}
          variant="text"
          className="mt-6 text-xs"
          leftIcon={<Zap className="h-3.5 w-3.5" />}
        >
          Canned responses for agents →
        </Button>
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
        <Select
          className="w-48"
          value={type}
          onChange={setType}
          options={TYPES.map((t) => ({ value: t, label: t }))}
        />
        <input className={inputCls} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          className={cn(inputCls, 'min-h-32 resize-y')}
          placeholder="Solution / steps…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={!title.trim() || !body.trim() || mutation.isPending}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
            variant="primary"
            size="sm"
          >
            {article ? 'Save changes' : 'Create article'}
          </Button>
          <Button type="button" onClick={onClose} variant="secondary" size="sm" className="border-edge text-muted">
            Cancel
          </Button>
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
        <Button
          type="button"
          disabled={!title.trim() || !body.trim() || mutation.isPending}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          variant="primary"
          size="sm"
        >
          Save
        </Button>
      </div>
    </div>
  );
}
