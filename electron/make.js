// Make.com REST API client. The token is stored encrypted by main.js and passed in via getAuth().
const ZONES = ['eu1.make.com', 'eu2.make.com', 'us1.make.com', 'us2.make.com', 'eu1.make.celonis.com', 'eu2.make.celonis.com', 'us1.make.celonis.com'];

const cleanZone = (z) => String(z || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
const validZone = (z) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(z);

function createMake({ getAuth, fetchImpl = fetch }) {
  async function call(method, apiPath, { query, body } = {}) {
    const { token, zone } = getAuth();
    if (!token) throw new Error('Make is not connected. Add your API token in Settings → Make.');
    const host = cleanZone(zone || ZONES[0]);
    if (!validZone(host)) throw new Error('The Make zone looks wrong. Use something like eu1.make.com.');
    const p = '/' + String(apiPath || '').replace(/^\/+/, '').replace(/^api\/v2\/?/, '');
    if (!/^\/[A-Za-z0-9_\-/.]*$/.test(p) || p.includes('..')) throw new Error('Invalid Make API path.');
    const u = new URL(`https://${host}/api/v2${p}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k.endsWith('[]') ? k : k + '[]', String(x)));
      else u.searchParams.set(k, String(v));
    }
    const res = await fetchImpl(u, {
      method,
      headers: { authorization: `Token ${token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000)
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const detail = json && (json.detail || json.message || (json.errors && JSON.stringify(json.errors))) || text.slice(0, 300);
      const hint = res.status === 401 ? ' The token was rejected: check the token and the zone.' : res.status === 403 ? ' The token is missing a scope, or this endpoint needs a paid Make plan.' : res.status === 429 ? ' Make rate limit reached; wait a moment.' : '';
      throw new Error(`Make API ${res.status}: ${detail}.${hint}`.replace(/\.\./g, '.'));
    }
    return json;
  }

  /** Orgs and teams, so the user (and the model) can see which teamId to use. */
  async function overview() {
    const orgs = ((await call('GET', '/organizations')) || {}).organizations || [];
    const out = [];
    for (const o of orgs.slice(0, 10)) {
      let teams = [];
      try { teams = ((await call('GET', '/teams', { query: { organizationId: o.id } })) || {}).teams || []; } catch {}
      out.push({ id: o.id, name: o.name, zone: o.zone, teams: teams.map((t) => ({ id: t.id, name: t.name })) });
    }
    return out;
  }

  const jsonStr = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  const DEFAULT_SCHEDULING = { type: 'indefinitely', interval: 900 };
  // "HTTP > Make a request" is the one built-in module that is safe to build without copying: it needs no connection.
  const HTTP_VERSIONS = [3, 4, 2, 1];
  const httpBlueprint = (t, version) => {
    const method = String(t.method || 'get').toLowerCase();
    const hasBody = t.body !== undefined && t.body !== null && t.body !== '' && method !== 'get';
    return {
      name: String(t.name || 'HTTP request'),
      flow: [{
        id: 1, module: 'http:ActionSendData', version,
        parameters: { handleErrors: false, useNewZLibDeCompress: true },
        mapper: {
          url: String(t.url || ''), serializeUrl: false, method,
          headers: (t.headers || []).map((h) => ({ name: String(h.name), value: String(h.value) })),
          qs: (t.query || []).map((h) => ({ name: String(h.name), value: String(h.value) })),
          bodyType: 'raw', ...(hasBody ? { contentType: 'application/json', data: typeof t.body === 'string' ? t.body : JSON.stringify(t.body) } : {}),
          parseResponse: true, authUser: '', authPass: '', timeout: '', shareCookies: false, ca: '', rejectUnauthorized: true, followRedirect: true, useQuerystring: false, gzip: true, useMtls: false, followAllRedirects: false
        },
        metadata: { designer: { x: 0, y: 0 } }
      }],
      metadata: { instant: false, version: 1, scenario: { roundtrips: 1, maxErrors: 3, autoCommit: true, autoCommitTriggerLast: true, sequential: false, confidential: false, dataloss: false, dlq: false, freshVariables: false }, designer: { orphans: [] } }
    };
  };

  const actions = {
    async overview() { return overview(); },
    async listScenarios({ teamId, organizationId, search, limit } = {}) {
      if (!teamId && !organizationId) throw new Error('Pass teamId (see make_overview).');
      const r = await call('GET', '/scenarios', { query: { teamId: teamId || undefined, organizationId: teamId ? undefined : organizationId, search, 'pg[limit]': Math.min(Number(limit) || 50, 100) } });
      return (r.scenarios || []).map((s) => ({ id: s.id, name: s.name, teamId: s.teamId, isActive: s.isActive, folderId: s.folderId, scheduling: s.scheduling, usedPackages: s.usedPackages, lastEdit: s.lastEdit || s.updated }));
    },
    async getScenario({ id }) {
      const sc = await call('GET', `/scenarios/${Number(id)}`);
      let blueprint = null;
      try { blueprint = ((await call('GET', `/scenarios/${Number(id)}/blueprint`)) || {}).response?.blueprint || null; } catch (e) { blueprint = { error: e.message }; }
      return { scenario: sc.scenario, blueprint };
    },
    async createScenario({ teamId, blueprint, template, scheduling, folderId, description, activate }) {
      if (!teamId) throw new Error('teamId is required (see make_overview).');
      if (!blueprint && !template) throw new Error('Pass a template (e.g. {"type":"http_request","url":"https://..."}) or a blueprint.');
      const send = async (bp) => {
        const body = { teamId: Number(teamId), blueprint: jsonStr(bp), scheduling: jsonStr(scheduling || DEFAULT_SCHEDULING) };
        if (folderId) body.folderId = Number(folderId);
        if (description) body.description = String(description);
        const r = await call('POST', '/scenarios', { query: { confirmed: 'true' }, body });
        return r.scenario || r;
      };
      let sc;
      if (blueprint) {
        try { sc = await send(blueprint); }
        catch (e) {
          if (/module not found/i.test(e.message)) throw new Error(e.message + ' Module ids cannot be guessed: copy them from make_get_scenario of an existing scenario, or use a template instead, e.g. {"type":"http_request","url":"https://..."}.');
          throw e;
        }
      } else {
        // The version of a built-in module differs between Make releases, so try the likely ones until one is accepted.
        let last;
        for (const v of HTTP_VERSIONS) {
          try { sc = await send(httpBlueprint(template, v)); break; }
          catch (e) { last = e; if (!/module not found/i.test(e.message)) throw e; }
        }
        if (!sc) throw last;
      }
      if (activate && sc && sc.id) {
        try { await actions.setActive({ id: sc.id, active: true }); sc.isActive = true; }
        catch (e) { sc.activateError = e.message; }
      }
      return sc;
    },
    async updateScenario({ id, blueprint, name, scheduling, folderId }) {
      const body = {};
      if (blueprint !== undefined) body.blueprint = jsonStr(blueprint);
      if (name !== undefined) body.name = String(name);
      if (scheduling !== undefined) body.scheduling = jsonStr(scheduling);
      if (folderId !== undefined) body.folderId = folderId === null ? null : Number(folderId);
      if (!Object.keys(body).length) throw new Error('Nothing to update.');
      const r = await call('PATCH', `/scenarios/${Number(id)}`, { query: { confirmed: 'true' }, body });
      return r.scenario || r;
    },
    async setActive({ id, active }) { return call('POST', `/scenarios/${Number(id)}/${active ? 'start' : 'stop'}`); },
    async run({ id, data, responsive }) {
      const body = {}; if (data && typeof data === 'object') body.data = data; if (responsive) body.responsive = true;
      return call('POST', `/scenarios/${Number(id)}/run`, { body });
    },
    async get({ path, query }) { return call('GET', path, { query }); }
  };
  /** Everything for the Automations page: every team's scenarios in one list, with a link to open each in Make. */
  async function listAll() {
    const { zone } = getAuth();
    const host = cleanZone(zone || ZONES[0]);
    const orgs = await overview();
    const teams = []; const scenarios = [];
    for (const o of orgs) for (const t of o.teams) teams.push({ id: t.id, name: t.name, org: o.name });
    for (const t of teams.slice(0, 12)) {
      let list = [];
      try { list = await actions.listScenarios({ teamId: t.id, limit: 100 }); } catch (e) { t.error = e.message; }
      for (const s of list) scenarios.push({ ...s, teamName: t.name, url: `https://${host}/${t.id}/scenarios/${s.id}/edit` });
    }
    return { teams, scenarios, zone: host };
  }
  /** The latest executions of one scenario. status: 1 success, 2 warning, 3 error (Make's own codes). */
  async function logs({ id, limit = 10 }) {
    const r = await call('GET', `/scenarios/${Number(id)}/logs`, { query: { 'pg[limit]': Math.min(Number(limit) || 10, 30), 'pg[sortBy]': 'date', 'pg[sortDir]': 'desc' } });
    return (r.scenarioLogs || r.logs || []).map((l) => ({ id: l.id || l.imtId, at: l.timestamp || l.date, status: l.status, operations: l.operations, duration: l.duration, transfer: l.transfer }));
  }
  return { call, actions, overview, listAll, logs, ZONES };
}

module.exports = { createMake, ZONES, cleanZone, validZone };
