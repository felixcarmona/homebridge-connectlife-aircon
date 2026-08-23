const assert = require('node:assert/strict');
const test = require('node:test');
const {Appliance} = require('../dist/appliance');

function onlineAppliance(api) {
    const appliance = new Appliance('Test AC', api);
    appliance.updateFromApi({
        puid: 'test-puid',
        online: true,
        state: {
            t_power: 1,
            t_temp: 22,
            t_temp_type: 0,
            t_fan_speed: 8,
            t_up_down: 0,
            t_work_mode: 4,
            f_temp_in: 24,
        },
    });
    return appliance;
}

test('changes mode and reapplies fan speed in one API request', async () => {
    const calls = [];
    const appliance = onlineAppliance({
        setApplianceStatus: async (puid, properties) => {
            calls.push({puid, properties});
        },
    });

    await appliance.setTargetMode(2);

    assert.deepEqual(calls, [{
        puid: 'test-puid',
        properties: {
            t_work_mode: 2,
            t_fan_speed: 8,
        },
    }]);
    assert.equal(appliance.getTargetMode(), 2);
    assert.equal(appliance.getRotationSpeed(), 75);
});

test('rolls back local mode when the combined API request fails', async () => {
    const appliance = onlineAppliance({
        setApplianceStatus: async () => {
            throw new Error('test failure');
        },
    });

    await assert.rejects(appliance.setTargetMode(2), /test failure/);
    assert.equal(appliance.getTargetMode(), 0);
    assert.equal(appliance.getRotationSpeed(), 75);
});

test('merges partial cloud states while preserving previous valid values', () => {
    const appliance = onlineAppliance({setApplianceStatus: async () => {}});

    appliance.updateFromApi({
        puid: 'test-puid',
        online: true,
        state: {t_power: 0, f_temp_in: 25},
    });

    assert.equal(appliance.getActive(), false);
    assert.equal(appliance.getCurrentTemperature(), 25);
    assert.equal(appliance.getTargetTemperature(), 22);
    assert.equal(appliance.getRotationSpeed(), 75);
});
