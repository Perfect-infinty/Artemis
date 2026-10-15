import { priceTag } from './cost.js';

/** Groups for the chat model picker: one group per enabled provider. Ids look like "prov:<providerId>:<modelId>". */
export function modelGroups(current, providers = []) {
  const provGroups = providers.filter((p) => p.enabled !== false && (p.models || []).length).map((p) => ({
    label: p.name + (p.local ? ' (on this computer)' : ''),
    items: p.models.map((m) => { const id = `prov:${p.id}:${m.id}`; const t = priceTag(id); const n = m.name || m.id; return [id, t ? `${n} (${t})` : n]; })
  }));
  const inProv = new Set(provGroups.flatMap((g) => g.items.map(([id]) => id)));
  const c = String(current || '');
  const orphan = c && !inProv.has(c) ? [{ label: 'Unavailable', items: [[c, c.replace(/^prov:[^:]*:/, '') + ' (provider removed or off)']] }] : [];
  return [...provGroups, ...orphan];
}

/** The model new chats start with: the one set in Settings, else the first model of the first enabled provider. */
export function defaultModel(settings, providers = []) {
  if (settings && settings.model) return settings.model;
  const p = providers.find((x) => x.enabled !== false && (x.models || []).length);
  return p ? `prov:${p.id}:${p.models[0].id}` : '';
}
