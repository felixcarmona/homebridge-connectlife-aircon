const assert = require('node:assert/strict');
const test = require('node:test');
const {TimerController} = require('../dist/timer-controller');

class FakeCharacteristic {
    value = false;

    onGet(handler) {
        this.getHandler = handler;
        return this;
    }

    onSet(handler) {
        this.setHandler = handler;
        return this;
    }

    updateValue(value) {
        this.value = value;
        return this;
    }
}

class FakeService {
    constructor(displayName, subtype) {
        this.displayName = displayName;
        this.subtype = subtype;
        this.characteristics = new Map();
    }

    setCharacteristic(characteristic, value) {
        this.getCharacteristic(characteristic).value = value;
        return this;
    }

    getCharacteristic(characteristic) {
        if (!this.characteristics.has(characteristic)) {
            this.characteristics.set(characteristic, new FakeCharacteristic());
        }
        return this.characteristics.get(characteristic);
    }

    updateCharacteristic(characteristic, value) {
        this.getCharacteristic(characteristic).updateValue(value);
        return this;
    }
}

function harness({now = 1_000_000, context = {}, setActive} = {}) {
    const Switch = function Switch() {};
    Switch.UUID = 'switch-uuid';
    const HeaterCooler = function HeaterCooler() {};
    HeaterCooler.UUID = 'heater-cooler-uuid';
    const Name = {name: 'Name'};
    const On = {name: 'On'};
    const Active = {name: 'Active', INACTIVE: 0, ACTIVE: 1};
    const TargetHeaterCoolerState = {
        name: 'TargetHeaterCoolerState',
        HEAT: 1,
        COOL: 2,
    };
    const CurrentHeaterCoolerState = {
        name: 'CurrentHeaterCoolerState',
        INACTIVE: 0,
        IDLE: 1,
        HEATING: 2,
        COOLING: 3,
    };
    const heaterCooler = new FakeService('Test AC');
    const services = [];
    const scheduled = [];
    const cleared = [];
    const updates = [];
    const calls = [];
    const accessory = {
        context,
        services,
        getServiceById: (_constructor, subtype) =>
            services.find((service) => service.subtype === subtype),
        getService: (constructor) =>
            constructor === HeaterCooler ? heaterCooler : undefined,
        addService: (_constructor, name, subtype) => {
            const service = new FakeService(name, subtype);
            services.push(service);
            return service;
        },
        removeService: (service) => {
            const index = services.indexOf(service);
            if (index >= 0) services.splice(index, 1);
        },
    };
    const platform = {
        Service: {Switch, HeaterCooler},
        Characteristic: {
            Name,
            On,
            Active,
            TargetHeaterCoolerState,
            CurrentHeaterCoolerState,
        },
        api: {
            updatePlatformAccessories: (accessories) => updates.push(accessories),
        },
        log: {info: () => {}, warn: () => {}},
    };
    const appliance = {
        active: false,
        getActive() {
            return this.active;
        },
        getTargetMode: () => TargetHeaterCoolerState.COOL,
        getTargetTemperature: () => 22,
        getCurrentTemperature: () => 25,
        async setActive(value) {
            calls.push(value);
            if (setActive) {
                await setActive(value, calls.length);
            }
            this.active = value;
        },
    };
    const runtime = {
        now: () => now,
        setTimeout: (callback, delayMs) => {
            const handle = {callback, delayMs};
            scheduled.push(handle);
            return handle;
        },
        clearTimeout: (handle) => cleared.push(handle),
        retryBaseMs: 100,
    };
    const controller = new TimerController(
        platform,
        accessory,
        appliance,
        'Test AC',
        {durationMinutes: 60, turnOnWhenStarted: true},
        runtime,
    );
    const service = services[0];
    const on = service.getCharacteristic(On);

    return {
        accessory,
        appliance,
        calls,
        cleared,
        controller,
        heaterCooler,
        on,
        platform,
        runtime,
        scheduled,
        services,
        updates,
        setNow: (value) => { now = value; },
    };
}

async function flushPromises() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('creates one stable Timer 1h switch and starts a persistent timer', async () => {
    const h = harness();

    await h.on.setHandler(true);

    assert.equal(h.services.length, 1);
    assert.equal(h.services[0].subtype, 'timer-1h');
    assert.deepEqual(h.calls, [true]);
    assert.equal(h.accessory.context.connectLifeTimer.expiresAt, 4_600_000);
    assert.equal(h.accessory.context.connectLifeTimer.expiredPendingOff, false);
    assert.equal(h.on.value, true);
    assert.equal(h.scheduled.at(-1).delayMs, 3_600_000);
    assert.equal(
        h.heaterCooler.getCharacteristic(h.platform.Characteristic.Active).value,
        h.platform.Characteristic.Active.ACTIVE,
    );
    assert.equal(
        h.heaterCooler
            .getCharacteristic(h.platform.Characteristic.TargetHeaterCoolerState)
            .value,
        h.platform.Characteristic.TargetHeaterCoolerState.COOL,
    );
    assert.equal(
        h.heaterCooler
            .getCharacteristic(h.platform.Characteristic.CurrentHeaterCoolerState)
            .value,
        h.platform.Characteristic.CurrentHeaterCoolerState.COOLING,
    );
});

test('manual switch OFF cancels the timer without switching off the AC', async () => {
    const h = harness();
    await h.on.setHandler(true);
    await h.on.setHandler(false);

    assert.deepEqual(h.calls, [true]);
    assert.equal(h.accessory.context.connectLifeTimer.expiresAt, 0);
    assert.equal(h.on.value, false);
    assert.equal(h.cleared.length, 1);
});

test('appliance OFF cancels an active timer without sending another command', async () => {
    const h = harness();
    await h.on.setHandler(true);
    h.appliance.active = false;

    h.controller.cancelForApplianceOff();

    assert.deepEqual(h.calls, [true]);
    assert.equal(h.accessory.context.connectLifeTimer.expiresAt, 0);
    assert.equal(h.on.value, false);
    assert.equal(h.cleared.length, 1);
});

test('appliance OFF reconciliation is a no-op without an active timer', () => {
    const h = harness();

    h.controller.cancelForApplianceOff();

    assert.deepEqual(h.calls, []);
    assert.equal(h.on.value, false);
    assert.equal(h.cleared.length, 0);
});

test('starting again replaces the previous expiry and timeout', async () => {
    const h = harness();
    h.appliance.active = true;
    await h.on.setHandler(true);
    h.setNow(1_300_000);
    await h.on.setHandler(true);

    assert.deepEqual(h.calls, []);
    assert.equal(h.accessory.context.connectLifeTimer.expiresAt, 4_900_000);
    assert.equal(h.cleared.length, 1);
    assert.equal(h.scheduled.length, 2);
});

test('does not persist an active timer when starting the AC fails', async () => {
    const h = harness({
        setActive: async () => {
            throw new Error('start failed');
        },
    });

    await assert.rejects(h.on.setHandler(true), /start failed/);
    assert.equal(h.accessory.context.connectLifeTimer.expiresAt, 0);
    assert.equal(h.on.value, false);
    assert.equal(h.scheduled.length, 0);
});

test('expiry switches off once and clears persistent state', async () => {
    const h = harness();
    await h.on.setHandler(true);
    h.setNow(4_600_000);
    h.scheduled.at(-1).callback();
    await flushPromises();

    assert.deepEqual(h.calls, [true, false]);
    assert.equal(h.accessory.context.connectLifeTimer.expiresAt, 0);
    assert.equal(h.accessory.context.connectLifeTimer.expiredPendingOff, false);
    assert.equal(h.on.value, false);
    assert.equal(
        h.heaterCooler.getCharacteristic(h.platform.Characteristic.Active).value,
        h.platform.Characteristic.Active.INACTIVE,
    );
    assert.equal(
        h.heaterCooler
            .getCharacteristic(h.platform.Characteristic.CurrentHeaterCoolerState)
            .value,
        h.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE,
    );
});

test('restores a future timer after restart without creating a duplicate service', () => {
    const context = {
        connectLifeTimer: {
            version: 1,
            serviceSubtype: 'timer-1h',
            expiresAt: 1_300_000,
            expiredPendingOff: false,
        },
    };
    const h = harness({context});

    assert.equal(h.services.length, 1);
    assert.equal(h.on.value, true);
    assert.equal(h.scheduled[0].delayMs, 300_000);
    assert.deepEqual(h.calls, []);

    h.controller.shutdown();
    new TimerController(
        h.platform,
        h.accessory,
        h.appliance,
        'Test AC',
        {durationMinutes: 60, turnOnWhenStarted: true},
        h.runtime,
    );
    assert.equal(h.services.length, 1);
});

test('keeps an expired timer pending and retries after a cloud failure', async () => {
    let failures = 1;
    const context = {
        connectLifeTimer: {
            version: 1,
            serviceSubtype: 'timer-1h',
            expiresAt: 900_000,
            expiredPendingOff: false,
        },
    };
    const h = harness({
        context,
        setActive: async (value) => {
            if (!value && failures-- > 0) {
                throw new Error('cloud unavailable');
            }
        },
    });

    assert.equal(h.scheduled[0].delayMs, 0);
    h.scheduled[0].callback();
    await flushPromises();
    assert.equal(h.accessory.context.connectLifeTimer.expiredPendingOff, true);
    assert.equal(h.on.value, true);
    assert.equal(h.scheduled.at(-1).delayMs, 100);

    h.scheduled.at(-1).callback();
    await flushPromises();
    assert.deepEqual(h.calls, [false, false]);
    assert.equal(h.accessory.context.connectLifeTimer.expiresAt, 0);
    assert.equal(h.on.value, false);
});

test('shutdown clears only the in-memory timeout and preserves expiry', async () => {
    const h = harness();
    await h.on.setHandler(true);
    const expiresAt = h.accessory.context.connectLifeTimer.expiresAt;

    h.controller.shutdown();

    assert.equal(h.cleared.length, 1);
    assert.equal(h.accessory.context.connectLifeTimer.expiresAt, expiresAt);
    assert.equal(h.on.value, true);
});

test('removes only its persisted switch when the timer is disabled', async () => {
    const h = harness();
    await h.on.setHandler(true);

    TimerController.removePersistedService(h.platform, h.accessory);

    assert.equal(h.services.length, 0);
    assert.equal(h.accessory.context.connectLifeTimer, undefined);
});
