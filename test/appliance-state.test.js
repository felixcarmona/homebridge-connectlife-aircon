const assert = require('node:assert/strict');
const test = require('node:test');
const {
    mapConnectLifeToHomeKit,
    mapHomeKitToConnectLife,
} = require('../dist/appliance-state');

function rawState(overrides = {}) {
    return {
        t_power: 1,
        t_temp: 22,
        t_temp_type: 0,
        t_up_down: 0,
        t_work_mode: 4,
        f_temp_in: 24,
        t_fan_speed: 0,
        ...overrides,
    };
}

test('maps Celsius power, temperature, auto mode, fan and swing', () => {
    assert.deepEqual(mapConnectLifeToHomeKit(rawState()), {
        active: true,
        targetTemp: 22,
        currentTemp: 24,
        targetMode: 0,
        rotationSpeed: 0,
        swingMode: 0,
        tempUnit: 0,
    });
});

test('maps Fahrenheit values to Celsius for HomeKit', () => {
    const mapped = mapConnectLifeToHomeKit(rawState({
        t_temp: 77,
        f_temp_in: 68,
        t_temp_type: 1,
    }));

    assert.equal(mapped.targetTemp, 25);
    assert.equal(mapped.currentTemp, 20);
    assert.equal(mapped.tempUnit, 1);
});

test('maps all supported fan speeds and preserves automatic fan', () => {
    const cases = [
        [0, 0],
        [5, 20],
        [6, 35],
        [7, 50],
        [8, 75],
        [9, 100],
    ];

    for (const [connectLife, homeKit] of cases) {
        assert.equal(
            mapConnectLifeToHomeKit(rawState({t_fan_speed: connectLife}))
                .rotationSpeed,
            homeKit,
        );
        assert.equal(
            mapHomeKitToConnectLife({rotationSpeed: homeKit}, 0)
                .t_fan_speed,
            connectLife,
        );
    }
});

test('maps heat, cool and unsupported modes', () => {
    assert.equal(mapConnectLifeToHomeKit(rawState({t_work_mode: 1})).targetMode, 1);
    assert.equal(mapConnectLifeToHomeKit(rawState({t_work_mode: 2})).targetMode, 2);
    assert.equal(mapConnectLifeToHomeKit(rawState({t_work_mode: 0})).targetMode, 0);
    assert.equal(mapConnectLifeToHomeKit(rawState({t_work_mode: 3})).targetMode, 0);

    assert.equal(mapHomeKitToConnectLife({targetMode: 1}, 0).t_work_mode, 1);
    assert.equal(mapHomeKitToConnectLife({targetMode: 2}, 0).t_work_mode, 2);
    assert.equal(mapHomeKitToConnectLife({targetMode: 0}, 0).t_work_mode, 4);
});

test('maps power and swing in both directions', () => {
    const off = mapConnectLifeToHomeKit(rawState({t_power: 0, t_up_down: 1}));
    assert.equal(off.active, false);
    assert.equal(off.swingMode, 1);

    assert.deepEqual(
        mapHomeKitToConnectLife({active: true, swingMode: 1}, 0),
        {t_power: 1, t_up_down: 1},
    );
});

test('converts HomeKit Celsius target to Fahrenheit when required', () => {
    assert.equal(
        mapHomeKitToConnectLife({targetTemp: 25}, 1).t_temp,
        77,
    );
    assert.equal(
        mapHomeKitToConnectLife({targetTemp: 25}, 0).t_temp,
        25,
    );
});
