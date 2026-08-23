import {PlatformAccessory, Service} from 'homebridge';
import {ConnectLifeAirconPlatform} from './platform';
import {Appliance} from './appliance';
import {TimerController, TimerControllerConfig} from './timer-controller';

export class AirconAccessory {
    private service: Service;
    private timerController?: TimerController;

    constructor(
        private readonly platform: ConnectLifeAirconPlatform,
        private readonly accessory: PlatformAccessory,
        private readonly appliance: Appliance,
        private readonly name: string,
        timerConfig?: TimerControllerConfig,
    ) {
        this.service =
            this.accessory.getService(this.platform.Service.HeaterCooler) ??
            this.accessory.addService(this.platform.Service.HeaterCooler);

        this.service.setCharacteristic(
            this.platform.Characteristic.Name,
            this.name,
        );
        this.service.setPrimaryService();

        this.registerCharacteristics();

        if (timerConfig) {
            this.timerController = new TimerController(
                platform,
                accessory,
                appliance,
                name,
                timerConfig,
            );
        } else {
            TimerController.removePersistedService(platform, accessory);
        }
    }

    public shutdown(): void {
        this.timerController?.shutdown();
    }

    public refreshFromApplianceState(): void {
        const {Characteristic} = this.platform;
        const active = this.appliance.getActive();

        this.service.updateCharacteristic(
            Characteristic.StatusActive,
            this.appliance.online,
        );
        this.service.updateCharacteristic(
            Characteristic.StatusFault,
            this.appliance.online
                ? Characteristic.StatusFault.NO_FAULT
                : Characteristic.StatusFault.GENERAL_FAULT,
        );
        this.service.updateCharacteristic(
            Characteristic.Active,
            active
                ? Characteristic.Active.ACTIVE
                : Characteristic.Active.INACTIVE,
        );
        this.service.updateCharacteristic(
            Characteristic.CurrentHeaterCoolerState,
            this.currentHeaterCoolerState(active),
        );
        this.service.updateCharacteristic(
            Characteristic.TargetHeaterCoolerState,
            this.appliance.getTargetMode(),
        );
        this.service.updateCharacteristic(
            Characteristic.CurrentTemperature,
            this.appliance.getCurrentTemperature(),
        );
        this.service.updateCharacteristic(
            Characteristic.CoolingThresholdTemperature,
            this.appliance.getTargetTemperature(),
        );
        this.service.updateCharacteristic(
            Characteristic.HeatingThresholdTemperature,
            this.appliance.getTargetTemperature(),
        );
        this.service.updateCharacteristic(
            Characteristic.TargetTemperature,
            this.appliance.getTargetTemperature(),
        );
        this.service.updateCharacteristic(
            Characteristic.RotationSpeed,
            this.appliance.getRotationSpeed(),
        );
        this.service.updateCharacteristic(
            Characteristic.SwingMode,
            this.appliance.getSwingMode(),
        );

        if (this.appliance.online && !this.appliance.getActive()) {
            this.timerController?.cancelForApplianceOff();
        }
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
                const active = value === Characteristic.Active.ACTIVE;
                await this.appliance.setActive(active);
                if (!active) {
                    this.timerController?.cancelForApplianceOff();
                }
            });

        this.service
            .getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 32,
                minStep: 1,
            });

        this.service
            .getCharacteristic(Characteristic.TargetTemperature)
            .setProps({
                minValue: 16,
                maxValue: 32,
                minStep: 1,
            });

        this.service
            .getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .onGet(() => {
                return this.appliance.getTargetMode();
            })
            .onSet(async (value) => {
                await this.appliance.setTargetMode(value as number);
            });

        this.service
            .getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .onGet(() => {
                return this.appliance.getTargetTemperature();
            })
            .onSet(async (value) => {
                await this.appliance.setTargetTemperature(value as number);
            });

        this.service
            .getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .onGet(() => {
                return this.appliance.getTargetTemperature();
            })
            .onSet(async (value) => {
                await this.appliance.setTargetTemperature(value as number);
            });

        this.service
            .getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 32,
                minStep: 1,
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
                await this.appliance.setRotationSpeed(value as number);
            });

        this.service
            .getCharacteristic(Characteristic.SwingMode)
            .onGet(() => {
                return this.appliance.getSwingMode();
            })
            .onSet(async (value) => {
                await this.appliance.setSwingMode(value as number);
            });

        this.service
            .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .onGet(() => this.currentHeaterCoolerState(
                this.appliance.getActive(),
            ));
    }

    private currentHeaterCoolerState(active: boolean): number {
        const {Characteristic} = this.platform;
        if (!active) {
            return Characteristic.CurrentHeaterCoolerState.INACTIVE;
        }

        const delta = this.appliance.getTargetTemperature() -
            this.appliance.getCurrentTemperature();
        if (Math.abs(delta) < 0.3) {
            return Characteristic.CurrentHeaterCoolerState.IDLE;
        }

        const mode = this.appliance.getTargetMode();
        if (mode === Characteristic.TargetHeaterCoolerState.HEAT) {
            return Characteristic.CurrentHeaterCoolerState.HEATING;
        }
        if (mode === Characteristic.TargetHeaterCoolerState.COOL) {
            return Characteristic.CurrentHeaterCoolerState.COOLING;
        }
        return Characteristic.CurrentHeaterCoolerState.IDLE;
    }
}
