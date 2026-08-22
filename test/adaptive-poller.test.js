const assert = require('node:assert/strict');
const test = require('node:test');
const {AdaptivePoller} = require('../dist/adaptive-poller');

class FakeTimer {
    constructor() {
        this.pending = [];
        this.cleared = [];
        this.nextId = 1;
    }

    set(callback, delayMs) {
        const entry = {id: this.nextId++, callback, delayMs};
        this.pending.push(entry);
        return entry.id;
    }

    clear(handle) {
        this.cleared.push(handle);
        this.pending = this.pending.filter((entry) => entry.id !== handle);
    }

    async runNext() {
        const entry = this.pending.shift();
        assert.ok(entry, 'expected a scheduled timer');
        entry.callback();
        await new Promise((resolve) => setImmediate(resolve));
        return entry;
    }
}

test('runs immediately and schedules only after the task completes', async () => {
    const timer = new FakeTimer();
    let resolveTask;
    let calls = 0;
    const poller = new AdaptivePoller(
        () => {
            calls++;
            return new Promise((resolve) => {
                resolveTask = resolve;
            });
        },
        30_000,
        900_000,
        () => {},
        timer,
    );

    poller.start();
    assert.equal(timer.pending[0].delayMs, 0);
    await timer.runNext();
    assert.equal(calls, 1);
    assert.equal(timer.pending.length, 0);

    resolveTask();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(timer.pending.length, 1);
    assert.equal(timer.pending[0].delayMs, 30_000);
});

test('backs off after failures and resets after success', async () => {
    const timer = new FakeTimer();
    const errors = [];
    const results = ['fail', 'fail', 'fail', 'success'];
    const poller = new AdaptivePoller(
        async () => {
            if (results.shift() === 'fail') {
                throw new Error('temporary failure');
            }
        },
        30_000,
        120_000,
        (_err, failures) => errors.push(failures),
        timer,
    );

    poller.start();

    const delays = [];
    for (let index = 0; index < 4; index++) {
        delays.push((await timer.runNext()).delayMs);
        await new Promise((resolve) => setImmediate(resolve));
    }

    assert.deepEqual(delays, [0, 60_000, 120_000, 120_000]);
    assert.deepEqual(errors, [1, 2, 3]);
    assert.equal(timer.pending[0].delayMs, 30_000);
});

test('start is idempotent and stop cancels the pending timer', () => {
    const timer = new FakeTimer();
    const poller = new AdaptivePoller(
        async () => {},
        30_000,
        900_000,
        () => {},
        timer,
    );

    poller.start();
    poller.start();
    assert.equal(timer.pending.length, 1);

    const handle = timer.pending[0].id;
    poller.stop();
    assert.equal(timer.pending.length, 0);
    assert.deepEqual(timer.cleared, [handle]);
});
