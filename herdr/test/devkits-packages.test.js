import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDevkits, devkitsCatalog, devkitsPlan, applyDevkitsPlan, resourceProblems, devkitsGuidance, mcpUsers, resourceSupported } from '../mods/devkits-agents/devkits-model.js';
import { parseSharedMcp, platformSharedMcp, sharedMcpSupported } from '../mods/devkits/components/shared-mcp-model.js';
import { saveDevkitsConfig, writeChecked } from '../mods/devkits-agents/devkits-save.js';
import { evaluateNative } from './source-harness.js';

const configText = (skills = {}, workflows = {}) => JSON.stringify({ version: 1, skills, workflows });
const mcpText = servers => JSON.stringify({ version: 1, servers });
const catalog = devkitsCatalog('/herdr');
const off = Object.fromEntries(catalog.skills.map(item => [item.id, false]));
const on = Object.fromEntries(catalog.skills.map(item => [item.id, true]));

test('Devkits follows ECC resource categories and preserves previous explicit choices', async () => {
  assert.deepEqual(catalog.rules.map(item => item.id), ['core', 'tasks']);
  assert.deepEqual(catalog.skills.map(item => item.id), ['shared-mcp', 'visual-studio']);
  assert.equal(catalog.workflows, undefined);
  const config = parseDevkits(configText({ core: false, tasks: true, 'shared-mcp': false }, { tasks: false }));
  assert.deepEqual(config, { version: 2, rules: { core: false, tasks: true }, skills: { 'shared-mcp': false, 'visual-studio': true } });
  assert.deepEqual(parseDevkits(JSON.stringify(config)), config);
  for (const item of [...catalog.rules, ...catalog.skills]) {
    const source = await readFile(new URL(`../mods/devkits-agents/${item.path.slice('/herdr/mods/devkits-agents/'.length)}`, import.meta.url), 'utf8');
    assert.match(source, /^---\nname: [a-z0-9-]+\ndescription: .+/);
  }
  for (const value of [{ version: 2, rules: {}, skills: { core: true } }, { version: 2, rules: { unknown: true }, skills: {} },
    { version: 2, rules: [], skills: {} }, { version: 1, skills: { tasks: 'yes' }, workflows: {} }]) assert.throws(() => parseDevkits(JSON.stringify(value)));
});

test('linked Skill selection stages MCP enablement once and preserves unrelated connections and platform gates', () => {
  const config = parseDevkits(configText({ core: false, tasks: false, 'shared-mcp': false, 'visual-studio': false }));
  const mcp = { version: 1, servers: { visual_studio: { command: 'vs', args: ['--stdio'], enabled: false }, personal: { command: 'own' } } };
  const plan = devkitsPlan(config, catalog, { skills: ['visual-studio'] }, mcp.servers, 'windows');
  assert.deepEqual(plan.addedSkills, ['visual-studio']); assert.deepEqual(plan.enable, ['visual_studio']);
  const result = applyDevkitsPlan(config, mcp, plan);
  assert.equal(result.config.skills['visual-studio'], true); assert.deepEqual(result.config.rules, config.rules);
  assert.deepEqual(result.mcp.servers.visual_studio, { command: 'vs', args: ['--stdio'], enabled: true });
  assert.deepEqual(result.mcp.servers.personal, mcp.servers.personal); assert.equal(mcp.servers.visual_studio.enabled, false);
  const missing = devkitsPlan(config, catalog, { skills: ['visual-studio'] }, {}, 'windows');
  assert.deepEqual(missing.missing, ['visual_studio']); assert.throws(() => applyDevkitsPlan(config, mcp, missing), /setup/);
  for (const platform of ['macos', 'linux']) {
    assert.ok(devkitsPlan(config, catalog, { skills: ['visual-studio'] }, mcp.servers, platform).blocked.some(text => text.includes('Windows only')));
    assert.equal(sharedMcpSupported('visual_studio', platform), false);
    const effective = platformSharedMcp(mcp, platform); assert.equal(effective.servers.visual_studio, undefined);
    assert.deepEqual(effective.servers.personal, mcp.servers.personal);
  }
});

test('selected Rules inject their content while Skills remain references without duplicate workflows', () => {
  const config = parseDevkits(null), rules = catalog.rules.map(item => ({ ...item, text: `Saved rule: ${item.id}` }));
  const text = devkitsGuidance(config, { ...catalog, rules }, {}, 'macos');
  assert.match(text, /Saved rule: core/); assert.match(text, /Saved rule: tasks/);
  assert.match(text, /shared-mcp\/SKILL.md/); assert.doesNotMatch(text, /Visual Studio|workflow/);
  assert.equal(mcpUsers('visual_studio', config, catalog).length, 1);
  config.rules.tasks = false;
  assert.doesNotMatch(devkitsGuidance(config, { ...catalog, rules }, {}, 'macos'), /Saved rule: tasks/);
});

test('session guidance skips other providers and unavailable Windows-only resources without blocking usable skills', async () => {
  const reads = [], config = configText({ tasks: true, 'visual-studio': true }, { tasks: true });
  const { sessionDevkits } = await evaluateNative('../mods/devkits-agents/devkits.js', {
    parseDevkits, devkitsCatalog, devkitsGuidance, resourceSupported, parseSharedMcp, appHome: () => '/herdr', window: () => ({ platform: 'macos' }), sessionKind: agent => agent.kind,
    sharedMcpPath: () => '/mcp.json', readTextFile: async path => {
      reads.push(path); return path.endsWith('/capabilities.json') ? config : path === '/mcp.json' ? mcpText({ visual_studio: { command: 'vs' } }) : '# Skill';
    },
  }, 'sessionDevkits');
  assert.equal(await sessionDevkits({ kind: 'terminal' }), ''); assert.deepEqual(reads, []);
  const text = await sessionDevkits({ kind: 'codex' }); assert.match(text, /Task progress/); assert.doesNotMatch(text, /Visual Studio/);
});

test('saving capability and MCP drafts checks both revisions and rolls back a failed second write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devkits-save-'));
  const dir = join(root, 'data/devkits'); await mkdir(dir, { recursive: true });
  const cap = join(dir, 'capabilities.json'), mcp = join(dir, 'codex-mcp.json');
  const payload = { capabilities: { expected: null, text: configText({ tasks: true }) }, mcp: { expected: null, text: mcpText({ browser: { command: 'browser' } }) } };
  try {
    await assert.rejects(saveDevkitsConfig(root, payload, { write: async (path, text, expected) => {
      if (path === cap) throw Error('Simulated write failure'); await writeChecked(path, text, expected);
    } }), /Simulated write failure/);
    await assert.rejects(access(mcp)); await assert.rejects(access(cap));
    await saveDevkitsConfig(root, payload);
    assert.equal(await readFile(cap, 'utf8'), payload.capabilities.text);
    assert.equal(await readFile(mcp, 'utf8'), payload.mcp.text);
    await assert.rejects(saveDevkitsConfig(root, payload), /changed in another window/);
    assert.equal(await readFile(mcp, 'utf8'), payload.mcp.text);
    const changed = { ...payload, capabilities: { expected: payload.capabilities.text, text: configText({ core: true }) },
      mcp: { expected: payload.mcp.text, text: mcpText({ browser: { command: 'new' } }) } };
    await assert.rejects(saveDevkitsConfig(root, changed, { write: async (path, text, expected) => {
      if (path === cap) { await writeFile(mcp, 'concurrent edit'); throw Error('Failure'); }
      await writeChecked(path, text, expected);
    } }), /another writer changed/);
    assert.equal(await readFile(mcp, 'utf8'), 'concurrent edit', 'rollback preserves independently edited settings');
    await assert.rejects(access(join(dir, '.capabilities-save.lock')));
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('missing selection files load default usable guidance without installing or enabling missing MCPs', async () => {
  const config = parseDevkits(null);
  const mac = devkitsGuidance(config, catalog, {}, 'macos');
  assert.match(mac, /Herdr Core/); assert.match(mac, /Task progress/); assert.match(mac, /Shared MCP installation/);
  assert.doesNotMatch(mac, /Visual Studio/);
  const windowsMissing = devkitsGuidance(config, catalog, {}, 'windows');
  assert.doesNotMatch(windowsMissing, /Visual Studio/);
  const windowsReady = devkitsGuidance(config, catalog, { visual_studio: { command: 'vs', enabled: true } }, 'windows');
  assert.match(windowsReady, /Visual Studio builds/);
});

test('moved saved Skill text takes precedence and survives independently of Global Rules', async () => {
  const reads = [], custom = '# My shared MCP policy\nUse my approved shared directory.';
  const { readDevkitsSkills } = await evaluateNative('../mods/devkits-agents/devkits.js', {
    readTextFile: async path => { reads.push(path); return path.includes('/data/devkits/skills/shared-mcp/') ? custom : path.includes('/data/devkits/skills/') ? null : '# Bundled policy'; },
  }, 'readDevkitsSkills');
  const result = await readDevkitsSkills(catalog.skills.filter(item => ['shared-mcp', 'visual-studio'].includes(item.id)));
  const mcp = result.find(item => item.id === 'shared-mcp'), vs = result.find(item => item.id === 'visual-studio');
  assert.equal(mcp.text, custom); assert.match(mcp.path, /data\/devkits\/skills\/shared-mcp\/SKILL.md/);
  assert.ok(!reads.includes(catalog.skills.find(item => item.id === 'shared-mcp').path));
  assert.equal(vs.text, '# Bundled policy'); assert.match(vs.path, /mods\/devkits-agents\/assets\/skills/);
});

test('Claude retains access to moved policies through its own MCP tools without reading shared Codex configuration', async () => {
  const off = Object.fromEntries(catalog.skills.map(item => [item.id, false]));
  const config = configText({ ...off, 'shared-mcp': true, 'visual-studio': true }, off), reads = [];
  const { sessionDevkits } = await evaluateNative('../mods/devkits-agents/devkits.js', {
    parseDevkits, devkitsCatalog, devkitsGuidance, resourceSupported, parseSharedMcp, appHome: () => '/herdr', window: () => ({ platform: 'windows' }), sessionKind: agent => agent.kind,
    sharedMcpPath: () => '/codex-mcp.json', readTextFile: async path => {
      reads.push(path);
      if (path === '/codex-mcp.json') throw Error('Claude must not use the Codex connection store');
      if (path.endsWith('/capabilities.json')) return config;
      return path.includes('/data/devkits/skills/') ? null : '# Bundled policy';
    },
  }, 'sessionDevkits');
  const guidance = await sessionDevkits({ kind: 'claude' });
  assert.match(guidance, /shared-mcp\/SKILL.md/); assert.match(guidance, /visual-studio\/SKILL.md/);
  assert.match(guidance, /only when the required MCP tools are available in this Claude session/);
  assert.ok(!reads.includes('/codex-mcp.json'));
});
