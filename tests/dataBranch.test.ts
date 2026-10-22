import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const restore = fileURLToPath(new URL('../scripts/data-branch.sh', import.meta.url));
const snapshot = fileURLToPath(new URL('../scripts/publish-data-snapshot.sh', import.meta.url));
const run = (cwd: string, command: string, args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
const git = (cwd: string, ...args: string[]) => { const result = run(cwd, 'git', args); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };

test('snapshot restore, unchanged skip, single-commit replacements and publish overlay work against a real local Git remote', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pb-data-branch-'));
  try {
    const remote = join(dir, 'remote.git'); const work = join(dir, 'work');
    await mkdir(work); git(dir, 'init', '--bare', remote); git(work, 'init', '-b', 'main');
    git(work, 'config', 'user.name', 'test'); git(work, 'config', 'user.email', 'test@example.invalid');
    await mkdir(join(work, 'public/data'), { recursive: true });
    await writeFile(join(work, 'public/data/archive.json'), '{"old":true}');
    git(work, 'add', '.'); git(work, '-c', 'commit.gpgsign=false', 'commit', '-m', 'main'); git(work, 'remote', 'add', 'origin', remote); git(work, 'push', 'origin', 'main');
    const main = git(work, 'rev-parse', 'HEAD');
    const output = join(dir, 'output'); const environment = join(dir, 'environment');
    const env = { DATA_BRANCH_REMOTE: remote, GITHUB_OUTPUT: output, GITHUB_ENV: environment, PREVIOUS_TREE: '' };
    let result = run(work, 'bash', [restore, 'public/data'], env);
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /No data branch yet/);
    result = run(work, 'bash', [snapshot], env);
    assert.equal(result.status, 0, result.stderr); assert.match(await readFile(output, 'utf8'), /changed=true/);
    assert.equal(git(dir, '--git-dir', remote, 'rev-list', '--count', 'data'), '1');
    await writeFile(join(work, 'public/data/stale.json'), 'removed');
    result = run(work, 'bash', [restore, 'public/data'], env);
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(readFile(join(work, 'public/data/stale.json')), { code: 'ENOENT' });
    const previousTree = git(dir, '--git-dir', remote, 'rev-parse', 'data^{tree}');
    await writeFile(output, '');
    result = run(work, 'bash', [snapshot], { ...env, PREVIOUS_TREE: previousTree });
    assert.equal(result.status, 0, result.stderr); assert.match(await readFile(output, 'utf8'), /changed=false/);
    await writeFile(join(work, 'public/data/archive.json'), '{"new":true}');
    result = run(work, 'bash', [snapshot], { ...env, PREVIOUS_TREE: previousTree });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(dir, '--git-dir', remote, 'rev-list', '--count', 'data'), '1');
    assert.notEqual(git(dir, '--git-dir', remote, 'rev-parse', 'data^{tree}'), previousTree);
    await mkdir(join(work, 'dist/data'), { recursive: true }); await writeFile(join(work, 'dist/data/stale.json'), 'removed');
    result = run(work, 'bash', [restore, 'dist/data'], env);
    assert.equal(result.status, 0, result.stderr); assert.equal(await readFile(join(work, 'dist/data/archive.json'), 'utf8'), '{"new":true}');
    await assert.rejects(readFile(join(work, 'dist/data/stale.json')), { code: 'ENOENT' });
    assert.equal(git(work, 'rev-parse', 'HEAD'), main, 'data publication never changes main');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('lookup, fetch and archive failures retain the previous data rather than falling back to main', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pb-data-failure-'));
  try {
    await mkdir(join(dir, 'bin')); await mkdir(join(dir, 'public/data'), { recursive: true });
    const file = join(dir, 'public/data/archive.json'); await writeFile(file, 'retained');
    for (const phase of ['ls-remote', 'fetch', 'archive']) {
      await writeFile(join(dir, 'bin/git'), `#!/usr/bin/env bash\nif [ "$1" = "${phase}" ]; then exit 128; fi\nif [ "$1" = rev-parse ]; then echo tree; fi\nexit 0\n`, { mode: 0o755 });
      const result = run(dir, 'bash', [restore, 'public/data'], { PATH: `${join(dir, 'bin')}:${process.env.PATH}` });
      assert.notEqual(result.status, 0, `failure in ${phase} must stop restore`);
      assert.equal(await readFile(file, 'utf8'), 'retained');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
