const assert = require('node:assert/strict');
const test = require('node:test');
const {validApplianceConfigs} = require('../dist/platform');

test('filters empty and malformed appliance entries before accessory creation', () => {
    const timer = {
        enabled: true,
        durationMinutes: 2,
        turnOnWhenStarted: true,
    };
    const valid = {name: 'Bedroom AC', timer};

    assert.deepEqual(validApplianceConfigs([
        valid,
        {name: ''},
        {name: '   '},
        {},
        null,
        'invalid',
    ]), [valid]);
    assert.deepEqual(validApplianceConfigs(undefined), []);
    assert.deepEqual(validApplianceConfigs({name: 'not-an-array'}), []);
});
