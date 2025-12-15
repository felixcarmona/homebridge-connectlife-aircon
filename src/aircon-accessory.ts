import {PlatformAccessory, Service} from 'homebridge';
import {ConnectLifeAirconPlatform} from './platform';
import {Appliance} from './appliance';

export class AirconAccessory {
    private service: Service;

    constructor(
        private readonly platform: ConnectLifeAirconPlatform,
        private readonly accessory: PlatformAccessory,
        private readonly appliance: Appliance,
        private readonly name: string,
    ) {
        this.service =
            this.accessory.getService(this.platform.Service.HeaterCooler) ??
            this.accessory.addService(this.platform.Service.HeaterCooler);

        this.service.setCharacteristic(
            this.platform.Characteristic.Name,
            this.name,
        );

        this.registerCharacteristics();
    }

    private registerCharacteristics(): void {
        const {Characteristic} = this.platform;

        this.service
            .getCharacteristic(Characteristic.StatusActive)
            .onGet(() => this.appliance.online);

        this.service
            .getCharacteristic(Characteristic.StatusFault)
            .onGet(() => {
                return this.appliance.online
                    ? Characteristic.StatusFault.NO_FAULT
                    : Characteristic.StatusFault.GENERAL_FAULT;
            });

        this.service
            .getCharacteristic(Characteristic.Active)
            .onGet(() => {
                return this.appliance.getActive()
                    ? Characteristic.Active.ACTIVE
                    : Characteristic.Active.INACTIVE;
            })
            .onSet(async (value) => {
                this.appliance.setActive(value === Characteristic.Active.ACTIVE).catch(err => {
                    this.platform.log.error(err);
                });
            });

        this.service
            .getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .onGet(() => {
                return this.appliance.getTargetMode();
            })
            .onSet(async (value) => {
                this.appliance.setTargetMode(value as number).catch(err => {
                    this.platform.log.error(err);
                });
            });

        this.service
            .getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .onGet(() => {
                return this.appliance.getTargetTemperature();
            })
            .onSet(async (value) => {
                this.appliance.setTargetTemperature(value as number, Characteristic.CurrentHeatingCoolingState.COOL).catch(err => {
                    this.platform.log.error(err);
                });
            });

        this.service
            .getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .onGet(() => {
                return this.appliance.getTargetTemperature();
            })
            .onSet(async (value) => {
                this.appliance.setTargetTemperature(value as number, Characteristic.CurrentHeatingCoolingState.HEAT).catch(err => {
                    this.platform.log.error(err);
                });
            });

        this.service
            .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
            .onGet(() => {
                return this.appliance.getTemperatureDisplayUnits();
            });

        this.service
            .getCharacteristic(Characteristic.CurrentTemperature)
            .onGet(() => {
                return this.appliance.getCurrentTemperature();
            });

        this.service
            .getCharacteristic(Characteristic.RotationSpeed)
            .onGet(() => {
                return this.appliance.getRotationSpeed();
            })
            .onSet(async (value) => {
                this.appliance.setRotationSpeed(value as number).catch(err => {
                    this.platform.log.error(err);
                });
            });

        this.service
            .getCharacteristic(Characteristic.SwingMode)
            .onGet(() => {
                return this.appliance.getSwingMode();
            })
            .onSet(async (value) => {
                this.appliance.setSwingMode(value as number).catch(err => {
                    this.platform.log.error(err);
                });
            });

        this.service
            .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .onGet(() => {
                if (!this.appliance.getActive()) {
                    return Characteristic.CurrentHeaterCoolerState.INACTIVE;
                }

                const currentTemp = this.appliance.getCurrentTemperature();
                const targetTemp = this.appliance.getTargetTemperature();
                const delta = targetTemp - currentTemp;
                const mode = this.appliance.getTargetMode();

                if (Math.abs(delta) < 0.3) {
                    return Characteristic.CurrentHeaterCoolerState.IDLE;
                }

                if (mode === Characteristic.TargetHeaterCoolerState.HEAT) {
                    return Characteristic.CurrentHeaterCoolerState.HEATING;
                }

                if (mode === Characteristic.TargetHeaterCoolerState.COOL) {
                    return Characteristic.CurrentHeaterCoolerState.COOLING;
                }

                return Characteristic.CurrentHeaterCoolerState.IDLE;
            });
    }
}
