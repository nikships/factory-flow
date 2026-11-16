// Resolves what a lead types after /model (worker_model) to one Droid model, the way the owner
// picks in Droid's own /model filter: "Sol" is Factory's GPT-6.1 Sol, "droidproxy sol" DroidProxy's.

import type { DroidModelOption } from './droid-models.js';

export type ModelMatch = { model: DroidModelOption; others: DroidModelOption[] } | { error: string };

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[\s:()[\]_/,|-]+/)
    .filter(Boolean);

/** The gateway a BYOK model goes through: "custom:droidproxy:gpt-6.1-sol" is droidproxy. */
const gatewayOf = (m: DroidModelOption) => (m.custom ? /^custom:([^:]+):/.exec(m.id)?.[1]?.toLowerCase() : undefined);

/**
 * Every word of `query` must start a word of the model's name or id. Among the matches, Factory's
 * own models come before BYOK ones unless the query names the gateway ("droidproxy"), then whole-word
 * matches before prefixes ("opus 5" is Opus 5, not Opus 5.5), then the name with the fewest words
 * besides the query's, then Droid's own order (newest first in each family).
 */
export function matchModel(query: string, models: readonly DroidModelOption[]): ModelMatch {
  const want = query.trim();
  if (!want) return { error: 'Name the model: what you would type after /model in Droid, or an exact id from team_models.' };
  const lower = want.toLowerCase();
  const exactId = models.find((m) => m.id.toLowerCase() === lower);
  if (exactId) return { model: exactId, others: [] };
  // A BYOK entry can reuse a Factory model's display name; Droid lists BYOK first, but Factory wins.
  const named = models.filter((m) => m.displayName.toLowerCase() === lower).sort((a, b) => Number(!!a.custom) - Number(!!b.custom));
  if (named.length) return { model: named[0], others: named.slice(1) };
  const asked = words(want);
  if (!asked.length) return { error: `No model Droid offers here matches "${want}". Call team_models for the ids and names.` };
  const scored = models.flatMap((m, index) => {
    const name = words(m.displayName);
    const pool = [...name, ...words(m.id)];
    if (!asked.every((w) => pool.some((p) => p.startsWith(w)))) return [];
    const gateway = gatewayOf(m);
    const namesGateway = !!gateway && asked.some((w) => gateway.startsWith(w));
    const partial = asked.filter((w) => !pool.includes(w)).length;
    const extra = name.filter((n) => !asked.some((w) => n.startsWith(w))).length;
    return [{ m, rank: [m.custom && !namesGateway ? 1 : 0, partial, extra, index] }];
  });
  if (!scored.length) return { error: `No model Droid offers here matches "${want}". Call team_models for the ids and names.` };
  scored.sort((a, b) => {
    const at = a.rank.findIndex((r, i) => r !== b.rank[i]);
    return at < 0 ? 0 : a.rank[at] - b.rank[at];
  });
  return { model: scored[0].m, others: scored.slice(1).map((s) => s.m) };
}
