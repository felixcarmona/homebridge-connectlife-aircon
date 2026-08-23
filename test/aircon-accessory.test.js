const assert = require('node:assert/strict');
const test = require('node:test');
const {AirconAccessory} = require('../dist/aircon-accessory');

class FakeCharacteristic {
    onGet(handler) {
        this.getHandler = handler;
        return this;
    }

    onSet(handler) {
        this.setHandler = handler;
        return this;
    }

    setProps() {
        return this;
    }
}

class FakeService {
    constructor() {
        this.values = new Map();
        this.characteristics = new Map();
    }

    getCharacteristic(characteristic) {
        if (!this.characteristics.has(characteristic)) {
            this.characteristics.set(characteristic, new FakeCharacteristic());
        }
        return this.characteristics.get(characteristic);
    }

    setCharacteristic(characteristic, value) {
        this.values.set(characteristic, value);
        return this;
    }

    updateCharacteristic(characteristic, value) {
        this.values.set(characteristic, value);
        return this;
    }

    setPrimaryService() {}
}

test('pushes a polled remote OFF state to the HomeKit service', () => {
    const HeaterCooler = function HeaterCooler() {};
    HeaterCooler.UUID = 'heater-cooler';
    const characteristic = (name, values = {}) => ({name, ...values});
    const Characteristic = {
        Name: characteristic('Name'),
        StatusActive: characteristic('StatusActive'),
        StatusFault: characteristic('StatusFault', {NO_FAULT: 0, GENERAL_FAULT: 1}),
        Active: characteristic('Active', {INACTIVE: 0, ACTIVE: 1}),
        CurrentHeaterCoolerState: characteristic('CurrentHeaterCoolerState', {
            INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3,
        }),
        TargetHeaterCoolerState: characteristic('TargetHeaterCoolerState', {
            AUTO: 0, HEAT: 1, COOL: 2,
        }),
        CurrentTemperature: characteristic('CurrentTemperature'),
        CoolingThresholdTemperature: characteristic('CoolingThresholdTemperature'),
        HeatingThresholdTemperature: characteristic('HeatingThresholdTemperature'),
        TargetTemperature: characteristic('TargetTemperature'),
        RotationSpeed: characteristic('RotationSpeed'),
        SwingMode: characteristic('SwingMode'),
        TemperatureDisplayUnits: characteristic('TemperatureDisplayUnits'),
    };
    const service = new FakeService();
    const accessory = {
        context: {},
        getService: (constructor) => constructor === HeaterCooler ? service : undefined,
        addService: () => service,
    };
    const appliance = {
        online: true,
        getActive: () => false,
        getTargetMode: () => Characteristic.TargetHeaterCoolerState.COOL,
        getTargetTemperature: () => 22,
        getCurrentTemperature: () => 25,
        getRotationSpeed: () => 75,
        getSwingMode: () => 1,
        getTemperatureDisplayUnits: () => 0,
    };
    const platform = {
        Service: {HeaterCooler},
        Characteristic,
    };

    const aircon = new AirconAccessory(
        platform,
        accessory,
        appliance,
        'Test AC',
    );
    aircon.refreshFromApplianceState();

    assert.equal(
        service.values.get(Characteristic.Active),
        Characteristic.Active.INACTIVE,
    );
    assert.equal(
        service.values.get(Characteristic.CurrentHeaterCoolerState),
        Characteristic.CurrentHeaterCoolerState.INACTIVE,
    );
    assert.equal(service.values.get(Characteristic.CurrentTemperature), 25);
    assert.equal(service.values.get(Characteristic.TargetTemperature), 22);
    assert.equal(service.values.get(Characteristic.RotationSpeed), 75);
    assert.equal(service.values.get(Characteristic.SwingMode), 1);
});
