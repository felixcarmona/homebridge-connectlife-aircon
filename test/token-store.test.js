const assert = require('node:assert/strict');
const test = require('node:test');
const {mkdtemp, readFile, readdir, stat, writeFile} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {FileConnectLifeTokenStore} = require('../dist/token-store');

test('atomically saves and reloads a private token cache', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'connectlife-token-test-'));
    const file = path.join(directory, 'tokens.json');
    const store = new FileConnectLifeTokenStore(file);
    const state = {
        accessToken: 'fake-access-token',
        accessTokenExpiresAt: 123456789,
        refreshToken: 'fake-refresh-token',
        refreshTokenExpiresAt: 987654321,
    };

    await store.save(state);

    assert.deepEqual(await store.load(), state);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(
        JSON.parse(await readFile(file, 'utf8')).refreshToken,
        'fake-refresh-token',
    );
});

test('clear removes the cache and is safe when it is already absent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'connectlife-token-test-'));
    const store = new FileConnectLifeTokenStore(
        path.join(directory, 'tokens.json'),
    );

    await store.clear();
    assert.equal(await store.load(), null);
});

test('quarantines malformed JSON instead of failing on every load', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'connectlife-token-test-'));
    const file = path.join(directory, 'tokens.json');
    await writeFile(file, '{not valid json', {mode: 0o600});

    const store = new FileConnectLifeTokenStore(file);
    assert.equal(await store.load(), null);
    assert.equal(await store.load(), null);

    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.match(files[0], /^tokens\.json\.corrupt-\d+$/);
    assert.equal(await readFile(path.join(directory, files[0]), 'utf8'), '{not valid json');
});

test('quarantines a structurally invalid token cache', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'connectlife-token-test-'));
    const file = path.join(directory, 'tokens.json');
    await writeFile(file, JSON.stringify({accessToken: 'incomplete'}), {mode: 0o600});

    const store = new FileConnectLifeTokenStore(file);
    assert.equal(await store.load(), null);
    assert.match((await readdir(directory))[0], /^tokens\.json\.corrupt-\d+$/);
});
