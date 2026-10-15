// Role agents ("Researcher", "Coder", ...): markdown files with frontmatter, like skills.
// User agents live in <userData>/agents/<slug>.md, project agents in <project folder>/.ares/agents/<slug>.md.
// Built-in roles are used when no file with the same slug exists; saving a role writes a file that overrides it.
const fs = require('fs');
const path = require('path');

const MAX_BODY = 20000;
const MAX_DESC = 300;

// Tool groups an agent can be given. Deleting files, shell, computer control and Make are never available to agents.
const GROUPS = {
  read: ['list_dir', 'read_file', 'search_files'],
  write: ['write_file', 'edit_file', 'write_spreadsheet', 'update_cells', 'create_folder', 'move_file'],
  web: ['web_search', 'web_fetch'],
  chats: ['search_chats', 'read_chat']
};
const GROUP_LABELS = { read: 'Read project files', write: 'Write and edit files (asks you each time)', web: 'Search and read the web', chats: 'Search your saved chats' };

const BUILTIN = [
  {
    name: 'Athena', role: 'Researcher', description: 'Finds and checks facts on the web and in project files. Good for lookups, comparisons and summaries.',
    model: '', tools: ['web', 'read', 'chats'],
    body: 'You are a careful researcher. Find the answer with as few searches as possible, open the best sources and check dates. Report findings as short bullet points with the source URL next to each claim. Say clearly what you could not verify. Do not pad.'
  },
  {
    name: 'Hephaestus', role: 'Coder', description: 'Writes and edits code and project files. Reads the existing code first and keeps changes small.',
    model: '', tools: ['read', 'write'],
    body: 'You are a senior engineer. Read the relevant files before changing anything, follow the existing style, and make the smallest change that solves the task. After writing, say which files you changed and anything the caller should double-check. Never invent APIs; if unsure, read the code or say so.'
  },
  {
    name: 'Calliope', role: 'Writer', description: 'Drafts and edits text: emails, docs, posts, summaries. Matches the tone you ask for.',
    model: '', tools: ['read', 'write'],
    body: 'You are a clear, concise writer. Match the requested language, tone and length. Return the finished text, not commentary about it. Save it to a file only when the task asks for one.'
  },
  {
    name: 'Themis', role: 'Reviewer', description: 'Checks other agents\' output for mistakes, gaps and unsupported claims. Read-only.',
    model: '', tools: ['read', 'web'],
    body: 'You are a strict reviewer. You get the original request and the work done by other agents. Check facts against the sources you can reach, look for errors, gaps, contradictions and things that were claimed but not done. Reply with: verdict (OK / needs fixes), then a short numbered list of concrete problems with how to fix each. If everything is fine, say so in one line.'
  }
];

const slugOf = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function parseAgent(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(s);
  const meta = {};
  let body = s;
  if (m) {
    body = m[2];
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: body.trim() };
}

const parseTools = (v) => [...new Set(String(v || '').split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => GROUPS[x]))];

function render({ name, role, description, model, tools, body }) {
  const fm = [`name: ${oneLine(name)}`, `role: ${oneLine(role)}`, `description: ${oneLine(description).slice(0, MAX_DESC)}`, `model: ${oneLine(model)}`, `tools: ${(tools || []).join(', ')}`];
  return `---\n${fm.join('\n')}\n---\n\n${String(body).trim()}\n`;
}

/** Tool names an agent may call, from its groups. */
const toolNames = (groups) => new Set((groups || []).flatMap((g) => GROUPS[g] || []));

/** deps: { userDir } */
function createAgents(deps) {
  const dirs = (root) => [['user', deps.userDir], ...(root ? [['project', path.join(root, '.ares', 'agents')]] : [])];

  function fromFile(source, base, file) {
    let text; try { text = fs.readFileSync(path.join(base, file), 'utf8'); } catch { return null; }
    const { meta, body } = parseAgent(text);
    const slug = file.replace(/\.md$/i, '');
    return {
      name: meta.name || slug, role: meta.role || '', slug, description: meta.description || '', model: meta.model || '',
      tools: parseTools(meta.tools), body, source, builtin: false, file: path.join(base, file)
    };
  }

  function list(root) {
    const out = [];
    for (const [source, base] of dirs(root)) {
      let entries = []; try { entries = fs.readdirSync(base); } catch { continue; }
      for (const f of entries.sort()) {
        if (!/\.md$/i.test(f)) continue;
        const a = fromFile(source, base, f);
        if (a && !out.some((x) => x.slug === a.slug)) out.push(a); // user agents win over project agents with the same slug
      }
    }
    for (const b of BUILTIN) {
      const slug = slugOf(b.name);
      if (!out.some((x) => x.slug === slug)) out.push({ ...b, slug, source: 'built-in', builtin: true, file: '' });
      else out.find((x) => x.slug === slug).overrides = true;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const find = (name, root) => {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    const all = list(root);
    return all.find((a) => a.slug === slugOf(q) || a.name.toLowerCase() === q) || all.find((a) => a.role && a.role.toLowerCase() === q) || null;
  };

  function save(a, root) {
    const name = oneLine(a && a.name).slice(0, 40);
    const slug = slugOf(name);
    if (!slug) return { ok: false, error: 'Give the agent a name.' };
    const body = String((a && a.body) || '').trim();
    if (!body) return { ok: false, error: 'Write instructions for the agent.' };
    if (body.length > MAX_BODY) return { ok: false, error: `Instructions are too long (max ${MAX_BODY} characters).` };
    const scope = a.scope === 'project' && root ? 'project' : 'user';
    const base = scope === 'project' ? path.join(root, '.ares', 'agents') : deps.userDir;
    fs.mkdirSync(base, { recursive: true });
    const tools = (Array.isArray(a.tools) ? a.tools : parseTools(a.tools)).filter((g) => GROUPS[g]);
    fs.writeFileSync(path.join(base, slug + '.md'), render({ name, role: oneLine(a.role).slice(0, 40), description: a.description, model: a.model, tools, body }), 'utf8');
    deps.notify?.();
    return { ok: true, slug, name };
  }

  /** Deletes the agent's file(s). A built-in role comes back in its default form. */
  function remove(name, root) {
    const slug = slugOf(name);
    let n = 0;
    for (const [, base] of dirs(root)) {
      const f = path.join(base, slug + '.md');
      if (fs.existsSync(f)) { fs.unlinkSync(f); n++; }
    }
    if (n) deps.notify?.();
    return { ok: n > 0 };
  }

  /** One line per agent for the system prompt. */
  function indexText(root) {
    return list(root).map((a) => `- ${a.name}${a.role ? ` (${a.role})` : ''}: ${a.description || 'no description'}${a.tools.includes('write') ? ' (can write files)' : ''}`).join('\n');
  }

  return { list, find, save, remove, indexText, dir: deps.userDir };
}

module.exports = { createAgents, parseAgent, render, slugOf, toolNames, GROUPS, GROUP_LABELS, BUILTIN };
