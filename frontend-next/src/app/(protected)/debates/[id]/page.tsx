'use client';

import { use, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { humanizeSlug } from '@/lib/humanize-slug';
import { useDebatesApi, type ApiCase, type ApiDebate } from '@/lib/debates-api';
import {
  agentOrderOf,
  fillRespondsToLabels,
  initialFor,
  mapArgument,
  type DebateArgument,
} from '@/lib/debate-thread-model';

function timeFor(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function colorFor(arg: DebateArgument): string {
  return arg.leaning >= 0.5 ? 'var(--convergence)' : 'var(--divergence)';
}

const ACTIVE_STATUSES = new Set(['OPEN', 'ARGUING', 'CONVERGING']);

// Ported from frontend/src/app/features/debate/debate-thread — static
// rendering only (spec 0037, Phase 4a). No WebSocket/live-follow yet: a
// debate still generating shows whatever's already persisted as of the
// last load, not a live "thinking" indicator — that's Phase 4b.
export default function DebateThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = use(params);
  const debateId = Number(idParam);

  const api = useDebatesApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'minimal' ? 'minimal' : 'detail';

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [debate, setDebate] = useState<ApiDebate | null>(null);
  const [caseData, setCaseData] = useState<ApiCase | null>(null);
  const [args, setArgs] = useState<DebateArgument[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function loadDebate(): Promise<void> {
    try {
      const [d, apiArguments] = await Promise.all([api.getDebate(debateId), api.getArguments(debateId)]);
      setDebate(d);
      setArgs(fillRespondsToLabels(apiArguments.map(mapArgument)));
      setCaseData(await api.getCase(d.case_id));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Standard fetch-on-mount, refetch-after-mutation pattern (loadDebate is
    // also called from startDebate below) — not the conditional-cascade
    // shape this lint rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDebate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debateId]);

  function setMode(next: 'minimal' | 'detail'): void {
    const params = new URLSearchParams(searchParams);
    params.set('mode', next);
    router.replace(`?${params.toString()}`);
  }

  async function startDebate(): Promise<void> {
    if (!debate || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      await api.startDebate(debate.id);
      await loadDebate();
    } catch {
      setStartError('Could not start this debate — please try again.');
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-ink-muted">Loading debate…</div>;
  }
  if (notFound || !debate) {
    return <div className="flex h-full items-center justify-center text-ink-muted">Debate not found.</div>;
  }

  const agentOrder = agentOrderOf(args);
  const isLeft = (agentId: number) => agentOrder.indexOf(agentId) === 0;
  const agentSlot = (agentId: number) => (agentOrder.indexOf(agentId) === 0 ? 'a' : 'b');
  const rounds = [...new Set(args.map((a) => a.round))].sort((a, b) => a - b);
  const isActive = ACTIVE_STATUSES.has(debate.status);

  return (
    <div className="mx-auto flex h-full max-w-[1180px] flex-col p-6">
      <div className="mb-5 flex-shrink-0 rounded-[14px] border border-line bg-ground p-5 shadow-[var(--panel-shadow)]">
        <div className="mb-4.5 flex flex-wrap items-center justify-between gap-3.5">
          <div className="flex gap-[3px]">
            <button
              onClick={() => setMode('minimal')}
              className={`rounded-l border border-line px-2.5 py-1 text-xs ${mode === 'minimal' ? 'bg-line text-ink' : 'bg-transparent text-ink-faint'}`}
            >
              Minimal
            </button>
            <button
              onClick={() => setMode('detail')}
              className={`rounded-r border border-l-0 border-line px-2.5 py-1 text-xs ${mode === 'detail' ? 'bg-line text-ink' : 'bg-transparent text-ink-faint'}`}
            >
              Detail
            </button>
          </div>
          {isActive && (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-divergence">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-divergence" />
              Live
            </span>
          )}
        </div>

        <h1 className="mb-1.5 text-balance font-[family-name:var(--font-display)] text-[23px] font-medium text-ink">
          {humanizeSlug(caseData?.type)} — Case #{debate.case_id}
        </h1>
        <div className="flex flex-wrap gap-4.5 text-[12.5px] text-ink-muted">
          <span><b className="font-semibold text-ink">Status</b>&nbsp;{debate.status_display}</span>
          <span><b className="font-semibold text-ink">Strategy</b>&nbsp;{debate.turn_strategy}</span>
          <span><b className="font-semibold text-ink">Round</b>&nbsp;{debate.current_round} of {debate.max_rounds}</span>
          <span><b className="font-semibold text-ink">Judge</b>&nbsp;{debate.judge_persona.name}</span>
        </div>
        {debate.status === 'OPEN' && (
          <button
            onClick={startDebate}
            disabled={starting}
            className="mt-3 rounded-lg bg-convergence px-4 py-2 text-sm font-semibold text-page disabled:opacity-50"
          >
            {starting ? 'Starting…' : 'Start debate'}
          </button>
        )}
        {startError && <p className="mt-2 text-[12.5px] text-divergence">{startError}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-[14px] border border-line bg-ground p-5 shadow-[var(--panel-shadow)]">
        {debate.opening_statement ? (
          <div className="mb-5 rounded-[14px] border border-line bg-page p-4">
            <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-judge">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-judge text-[8.5px] text-page">
                {initialFor(debate.judge_persona.name)}
              </span>
              Opening Statement · {debate.judge_persona.name}
            </div>
            <p className="text-[13px] leading-[1.55] text-ink-muted">{debate.opening_statement}</p>
          </div>
        ) : (
          args.length === 0 && <p className="mt-4 text-[13.5px] text-ink-faint">No arguments yet.</p>
        )}

        {rounds.map((round) => (
          <div key={round}>
            <div className="my-4 flex items-center gap-2.5">
              <span className="h-px flex-1 bg-line" />
              <span className="whitespace-nowrap rounded-full border border-line bg-page px-2.5 py-1 font-mono text-[11px] font-semibold text-ink-muted">
                Round {round}
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
            {args
              .filter((a) => a.round === round)
              .map((arg) => (
                <div key={arg.id} className={`mb-3.5 flex items-start gap-2 ${isLeft(arg.agentId) ? 'justify-start' : 'justify-end'}`}>
                  {isLeft(arg.agentId) && (
                    <span
                      className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold text-page"
                      style={{ background: agentSlot(arg.agentId) === 'b' ? 'var(--agent-b)' : 'var(--agent-a)' }}
                    >
                      {initialFor(arg.agentName)}
                    </span>
                  )}
                  <div
                    className={`max-w-[72%] rounded-2xl border border-line p-3.5 ${isLeft(arg.agentId) ? 'rounded-tl-md' : 'rounded-tr-md'}`}
                    style={{ background: agentSlot(arg.agentId) === 'b' ? 'var(--agent-b-bg)' : 'var(--agent-a-bg)' }}
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-2.5">
                      <span className="font-[family-name:var(--font-display)] text-[13px] font-semibold text-ink">
                        {arg.agentName} · {arg.agentRole}
                      </span>
                      <span className="flex-shrink-0 font-mono text-[10.5px] text-ink-faint">{timeFor(arg.createdAt)}</span>
                    </div>
                    {arg.respondsToLabel && <div className="mb-1.5 text-[11.5px] text-judge">↩ {arg.respondsToLabel}</div>}
                    <div className="text-sm leading-[1.6] text-ink">{arg.text}</div>
                    <div className="mt-2 font-mono text-[11px] font-semibold" style={{ color: colorFor(arg) }}>
                      {arg.position ? `${arg.position} · ${arg.confidence}` : 'generating…'}
                    </div>
                  </div>
                  {!isLeft(arg.agentId) && (
                    <span
                      className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold text-page"
                      style={{ background: agentSlot(arg.agentId) === 'b' ? 'var(--agent-b)' : 'var(--agent-a)' }}
                    >
                      {initialFor(arg.agentName)}
                    </span>
                  )}
                </div>
              ))}
          </div>
        ))}

        {debate.verdict && (
          <>
            <div className="my-4 flex items-center gap-2.5">
              <span className="h-px flex-1 bg-line" />
              <span className="whitespace-nowrap rounded-full border border-line bg-page px-2.5 py-1 font-mono text-[11px] font-semibold text-ink-muted">
                Verdict
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="rounded-[14px] border border-line bg-page p-4">
              <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-judge">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-judge text-[8.5px] text-page">
                  {initialFor(debate.judge_persona.name)}
                </span>
                Verdict · {debate.judge_persona.name}
              </div>
              <p className="mb-1.5 font-mono text-[13.5px] font-bold text-ink">
                {debate.verdict.decision} · {debate.verdict.confidence}
              </p>
              <p className="text-[13px] leading-[1.55] text-ink-muted">{debate.verdict.reasoning}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
