import type { ApiArgument } from './debates-api';

// Ported from frontend/src/app/features/debate/debate-thread/debate-thread.ts.
export interface DebateArgument {
  id: string;
  agentId: number;
  agentName: string;
  agentRole: string;
  round: number;
  leaning: number;
  position: string | null;
  confidence: number | null;
  text: string;
  createdAt: string;
  respondsToId: string | null;
  respondsToLabel: string | null;
}

export function mapArgument(api: ApiArgument): DebateArgument {
  return {
    id: String(api.id),
    agentId: api.agent_persona.id,
    agentName: api.agent_persona.name,
    agentRole: api.agent_persona.role_description || api.agent_persona.role,
    round: api.round_number + 1,
    leaning: api.leaning,
    position: api.position,
    confidence: api.confidence,
    text: api.content,
    createdAt: api.created_at,
    respondsToId: api.responds_to_id !== null ? String(api.responds_to_id) : null,
    respondsToLabel: null,
  };
}

export function fillRespondsToLabels(args: DebateArgument[]): DebateArgument[] {
  const byId = new Map(args.map((a) => [a.id, a]));
  return args.map((a) => {
    if (!a.respondsToId) return a;
    const target = byId.get(a.respondsToId);
    if (!target) return a;
    return { ...a, respondsToLabel: `Responds to ${target.agentName}, round ${target.round}` };
  });
}

export function initialFor(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function agentOrderOf(args: DebateArgument[]): number[] {
  const seen: number[] = [];
  for (const a of args) {
    if (!seen.includes(a.agentId)) seen.push(a.agentId);
  }
  return seen;
}
