import { randomUUID } from 'node:crypto';
import type { BJState } from './blackjack.js';
import type { VPHand }  from './videopoker.js';
import type { CrapsState } from './craps.js';

type AnyState = BJState | VPHand | CrapsState | { kind: 'slots'; bet: number };

export interface BetMix { pp: number; ltc: number }
interface Entry { id: string; discordId: string; game: 'blackjack'|'slots'|'videopoker'|'craps'; state: AnyState; bet: number; mix?: BetMix; }

const map = new Map<string, Entry>();

export function create(discordId: string, game: Entry['game'], state: AnyState, bet: number, mix?: BetMix): Entry {
  const id = randomUUID();
  const e: Entry = { id, discordId, game, state, bet, mix };
  map.set(id, e);
  return e;
}
export const get = (id: string) => map.get(id);
export const drop = (id: string) => map.delete(id);
export function listByUser(discordId: string): Entry[] {
  const out: Entry[] = [];
  for (const e of map.values()) if (e.discordId === discordId) out.push(e);
  return out;
}
