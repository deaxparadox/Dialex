'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { humanizeSlug } from '@/lib/humanize-slug';
import { useAuth } from '@/lib/auth-context';
import { useDebatesApi, type ApiCase, type ApiDebate } from '@/lib/debates-api';
import { useDebateStream } from '@/lib/debate-stream';
import {
  agentOrderOf,
  fillRespondsToLabels,
  initialFor,
  mapArgument,
  type DebateArgument,
} from '@/lib/debate-thread-model';
import { TypingIndicator } from '../../_components/typing-indicator';

function timeFor(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function colorFor(arg: DebateArgument): string {
  return arg.leaning >= 0.5 ? 'var(--convergence)' : 'var(--divergence)';
}

interface GeneratingTurn {
  agentPersonaId: number;
  agentName: string;
  stage: 'opening_statement' | 'argument' | 'verdict';
  roundNumber: number | null;
}

const ACTIVE_STATUSES = new Set(['OPEN', 'ARGUING', 'CONVERGING']);
const POLL_INTERVAL_MS = 4000;

// Ported from frontend/src/app/features/debate/debate-thread — completes
// Phase 4 (spec 0038), adding the live half spec 0037 deferred: WebSocket
// token streaming, "who's generating" indicators, and the swap-gap/
// reconnect handling specs 0018/0019/0020/0021/0029 accumulated.
export default function DebateThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = use(params);
  const debateId = Number(idParam);

  const api = useDebatesApi();
  const { accessToken } = useAuth();
  const debateStream = useDebateStream();
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

  const [generatingTurn, setGeneratingTurnState] = useState<GeneratingTurn | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const generatingTurnRef = useRef<GeneratingTurn | null>(null);
  function setGeneratingTurn(value: GeneratingTurn | null): void {
    generatingTurnRef.current = value;
    setGeneratingTurnState(value);
  }

  const threadRef = useRef<HTMLDivElement>(null);
  const streamingRef = useRef(false);
  const pollHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // "Latest ref" pattern: the long-lived WS onMessage closure (built once
  // per connect() call, not recreated every render) needs the freshest
  // loadDebate/accessToken, not whatever was captured when connect() first
  // ran — an access token can legitimately refresh mid-debate. Updated via
  // an effect (not during render — refs must not be written mid-render)
  // every render, so the ref is current without forcing a reconnect.
  const loadDebateRef = useRef<() => Promise<void>>(async () => {});
  const accessTokenRef = useRef<string | null>(accessToken);
  useEffect(() => {
    accessTokenRef.current = accessToken;
  });

  async function loadDebate(): Promise<void> {
    try {
      const [d, apiArguments] = await Promise.all([api.getDebate(debateId), api.getArguments(debateId)]);
      setDebate(d);
      setArgs(fillRespondsToLabels(apiArguments.map(mapArgument)));
      if (!caseData) setCaseData(await api.getCase(d.case_id));

      if (ACTIVE_STATUSES.has(d.status)) {
        openStream();
      } else {
        closeStream();
        stopPolling();
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadDebateRef.current = loadDebate;
  });

  function openStream(): void {
    if (streamingRef.current) return;
    const token = accessTokenRef.current;
    if (!token) {
      // Shouldn't happen — the route is already auth-guarded — but fail
      // visibly rather than silently leaving the view with no live updates.
      console.error(`No access token available to open the debate stream for debate ${debateId}`);
      startPolling();
      return;
    }
    streamingRef.current = true;
    debateStream.connect(
      debateId,
      token,
      (event) => {
        if (event.type === 'turn_started') {
          setStreamingText('');
          setGeneratingTurn({
            agentPersonaId: event.agent_persona_id,
            agentName: event.agent_name,
            stage: event.stage,
            roundNumber: event.round_number,
          });
        } else if (event.type === 'turn_token') {
          setStreamingText((text) => text + event.token);
        } else if (event.type === 'turn_token_reset') {
          setStreamingText('');
        } else {
          // streamingText is left as-is deliberately — already-streamed text
          // should keep showing, not revert to a loading indicator, until
          // the next turn_started naturally clears it.
          //
          // generatingTurn is NOT cleared synchronously here (spec 0029) —
          // the refetch below is async, and clearing immediately leaves a
          // gap where the "thinking" UI has already disappeared but the
          // "final" UI isn't ready yet. Only clear once the refetch lands,
          // and only if nothing newer already replaced it — the backend
          // graph is fully sequential, but the *next* turn's turn_started
          // can arrive while this refetch is still in flight.
          const completingTurn = generatingTurnRef.current;
          void loadDebateRef.current().then(() => {
            if (generatingTurnRef.current === completingTurn) {
              setGeneratingTurn(null);
            }
          });
        }
      },
      () => {
        streamingRef.current = false;
        console.warn(`WebSocket dropped for debate ${debateId}, falling back to polling`);
        startPolling();
      }
    );
  }

  function closeStream(): void {
    if (streamingRef.current) {
      debateStream.disconnect();
      streamingRef.current = false;
    }
  }

  function startPolling(): void {
    if (pollHandleRef.current) return;
    pollHandleRef.current = setInterval(() => void loadDebateRef.current(), POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollHandleRef.current) {
      clearInterval(pollHandleRef.current);
      pollHandleRef.current = null;
    }
  }

  useEffect(() => {
    void loadDebateRef.current();
    return () => {
      closeStream();
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debateId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [args, generatingTurn, streamingText]);

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
  if (generatingTurn?.stage === 'argument' && !agentOrder.includes(generatingTurn.agentPersonaId)) {
    agentOrder.push(generatingTurn.agentPersonaId);
  }
  const isLeft = (agentId: number) => agentOrder.indexOf(agentId) === 0;
  const agentSlot = (agentId: number) => (agentOrder.indexOf(agentId) === 0 ? 'a' : 'b');

  const realRounds = new Set(args.map((a) => a.round));
  if (generatingTurn?.stage === 'argument' && generatingTurn.roundNumber !== null) {
    realRounds.add(generatingTurn.roundNumber + 1);
  }
  const rounds = [...realRounds].sort((a, b) => a - b);

  const isActive = ACTIVE_STATUSES.has(debate.status);
  const openingGeneratingTurn = generatingTurn?.stage === 'opening_statement' ? generatingTurn : null;

  const avatar = (agentId: number, name: string) => (
    <span
      className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold text-page"
      style={{ background: agentSlot(agentId) === 'b' ? 'var(--agent-b)' : 'var(--agent-a)' }}
    >
      {initialFor(name)}
    </span>
  );

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

      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto rounded-[14px] border border-line bg-ground p-5 shadow-[var(--panel-shadow)]">
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
        ) : openingGeneratingTurn ? (
          <div className="mb-5 rounded-[14px] border border-dashed border-line bg-page p-4">
            <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-judge">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-judge text-[8.5px] text-page">
                {initialFor(openingGeneratingTurn.agentName)}
              </span>
              {streamingText ? openingGeneratingTurn.agentName : `${openingGeneratingTurn.agentName} is preparing opening remarks…`}
            </div>
            {streamingText ? (
              <p className="text-[13px] leading-[1.55] text-ink-muted">{streamingText}</p>
            ) : (
              <TypingIndicator />
            )}
          </div>
        ) : isActive && debate.status !== 'OPEN' ? (
          // Reconnecting mid-generation: a turn_started event already fired
          // before this page/socket existed, and Redis pub/sub has no
          // replay — so generatingTurn is null here even though the
          // opening statement is actively generating server-side.
          <div className="mb-5 rounded-[14px] border border-line bg-page p-4">
            <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-judge">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-judge text-[8.5px] text-page">
                {initialFor(debate.judge_persona.name)}
              </span>
              Opening Statement · {debate.judge_persona.name}
            </div>
            <div className="flex items-center gap-2.5">
              {streamingText ? (
                <p className="text-[13px] leading-[1.55] text-ink-muted">{streamingText}</p>
              ) : (
                <>
                  <span className="text-[13.5px] text-ink-faint">Generating opening statement…</span>
                  <TypingIndicator />
                </>
              )}
            </div>
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
                  {isLeft(arg.agentId) && avatar(arg.agentId, arg.agentName)}
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
                  {!isLeft(arg.agentId) && avatar(arg.agentId, arg.agentName)}
                </div>
              ))}
            {generatingTurn?.stage === 'argument' && (generatingTurn.roundNumber ?? -1) + 1 === round && (
              <div className={`mb-3.5 flex items-start gap-2 ${isLeft(generatingTurn.agentPersonaId) ? 'justify-start' : 'justify-end'}`}>
                {isLeft(generatingTurn.agentPersonaId) && avatar(generatingTurn.agentPersonaId, generatingTurn.agentName)}
                <div
                  className={`w-fit max-w-[72%] rounded-2xl border border-line p-3.5 ${isLeft(generatingTurn.agentPersonaId) ? 'rounded-tl-md' : 'rounded-tr-md'}`}
                  style={{ background: agentSlot(generatingTurn.agentPersonaId) === 'b' ? 'var(--agent-b-bg)' : 'var(--agent-a-bg)' }}
                >
                  <div className="mb-1 flex items-baseline gap-2.5">
                    <span className="font-[family-name:var(--font-display)] text-[13px] font-semibold text-ink">
                      {streamingText ? generatingTurn.agentName : `${generatingTurn.agentName} is thinking…`}
                    </span>
                  </div>
                  {streamingText ? (
                    <div className="text-sm leading-[1.6] text-ink">{streamingText}</div>
                  ) : (
                    <TypingIndicator />
                  )}
                </div>
                {!isLeft(generatingTurn.agentPersonaId) && avatar(generatingTurn.agentPersonaId, generatingTurn.agentName)}
              </div>
            )}
          </div>
        ))}

        {debate.verdict ? (
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
        ) : generatingTurn?.stage === 'verdict' ? (
          <>
            <div className="my-4 flex items-center gap-2.5">
              <span className="h-px flex-1 bg-line" />
              <span className="whitespace-nowrap rounded-full border border-line bg-page px-2.5 py-1 font-mono text-[11px] font-semibold text-ink-muted">
                Verdict
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="rounded-[14px] border border-dashed border-line bg-page p-4">
              <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-judge">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-judge text-[8.5px] text-page">
                  {initialFor(generatingTurn.agentName)}
                </span>
                {streamingText ? generatingTurn.agentName : `${generatingTurn.agentName} is preparing a verdict…`}
              </div>
              {streamingText ? (
                <p className="text-[13px] leading-[1.55] text-ink-muted">{streamingText}</p>
              ) : (
                <TypingIndicator />
              )}
            </div>
          </>
        ) : (
          !debate.verdict &&
          debate.status !== 'OPEN' &&
          args.length >= debate.max_rounds * 2 && (
            // Reconnecting mid-verdict-generation — same reasoning as the
            // opening-statement equivalent above. Deliberately never shows
            // streamingText here (spec 0029's second fix): this branch only
            // renders while generatingTurn is null, i.e. before the
            // verdict's own turn_started arrives, so any streamingText
            // present can only be stale leftover from the last argument's
            // turn — showing it produced a one-frame stale-content flash.
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
                <TypingIndicator />
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
