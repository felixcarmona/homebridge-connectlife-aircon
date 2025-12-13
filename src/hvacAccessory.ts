import {
    PlatformAccessory,
    Service,
} from 'homebridge';
import { ConnectLifeHVACPlatform } from './platform';
import { HVACState, DEFAULT_STATE } from './types';

/**
 * HVACAccessory
 *
 * This class represents a single mocked HVAC device exposed to Apple Home.
 * All state is kept in memory and no real device communication happens here.
 */
export class HVACAccessory {
    private service: Service;
    private state: HVACState;
    private temperatureTimer?: NodeJS.Timeout;

    constructor(
        private readonly platform: ConnectLifeHVACPlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        // In-memory mock state (single source of truth)
        this.state = { ...DEFAULT_STATE };

        // Main HomeKit service
        this.service =
            this.accessory.getService(this.platform.Service.HeaterCooler) ??
            this.accessory.addService(this.platform.Service.HeaterCooler);

        // Accessory name shown in Apple Home
        this.service.setCharacteristic(
            this.platform.Characteristic.Name,
            'ConnectLife HVAC (Mock)',
        );

        // Register HomeKit characteristics
        this.registerCharacteristics();

        // Start temperature simulation loop
        this.startMockTemperature();
    }

    /**
     * Registers all HomeKit characteristics and binds them
     * to the internal mock state.
     */
    private registerCharacteristics(): void {
        const { Characteristic } = this.platform;

        /**
         * Power ON / OFF
         */
        this.service
            .getCharacteristic(Characteristic.Active)
            .onGet(() => (this.state.active ? 1 : 0))
            .onSet(value => {
                this.state.active = value === 1;
                this.platform.log.info('[HVAC] Active →', this.state.active);
            });

        /**
         * Target mode: COOL / HEAT / AUTO
         */
        this.service
            .getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({
                validValues: [
                    Characteristic.TargetHeaterCoolerState.COOL,
                    Characteristic.TargetHeaterCoolerState.HEAT,
                    Characteristic.TargetHeaterCoolerState.AUTO,
                ],
            })
            .onGet(() => this.state.mode)
            .onSet(value => {
                this.state.mode = value as number;
                this.platform.log.info('[HVAC] Mode →', this.state.mode);
            });

        /**
         * Current operating state (derived from internal logic)
         */
        this.service
            .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .onGet(() => this.getCurrentState());

        /**
         * Cooling target temperature
         */
        this.service
            .getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 30,
                minStep: 1,
            })
            .onGet(() => this.state.targetCoolTemp)
            .onSet(value => {
                this.state.targetCoolTemp = value as number;
                this.platform.log.debug(
                    '[HVAC] Target COOL temperature →',
                    this.state.targetCoolTemp,
                );
            });

        /**
         * Heating target temperature
         */
        this.service
            .getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 30,
                minStep: 1,
            })
            .onGet(() => this.state.targetHeatTemp)
            .onSet(value => {
                this.state.targetHeatTemp = value as number;
                this.platform.log.debug(
                    '[HVAC] Target HEAT temperature →',
                    this.state.targetHeatTemp,
                );
            });

        /**
         * Fan speed / power level (mapped as percentage)
         */
        this.service
            .getCharacteristic(Characteristic.RotationSpeed)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: 25,
            })
            .onGet(() => this.state.fanSpeed)
            .onSet(value => {
                this.state.fanSpeed = value as number;
                this.platform.log.debug(
                    '[HVAC] Fan speed →',
                    this.state.fanSpeed,
                );
            });

        /**
         * Current ambient temperature
         */
        this.service
            .getCharacteristic(Characteristic.CurrentTemperature)
            .onGet(() => this.state.currentTemp);
    }

    /**
     * Derives the current HeaterCooler state shown in Apple Home
     * based on power, mode and temperature delta.
     */
    private getCurrentState(): number {
        const { Characteristic } = this.platform;

        if (!this.state.active) {
            return Characteristic.CurrentHeaterCoolerState.INACTIVE;
        }

        const target =
            this.state.mode ===
            Characteristic.TargetHeaterCoolerState.HEAT
                ? this.state.targetHeatTemp
                : this.state.targetCoolTemp;

        const delta = target - this.state.currentTemp;

        if (Math.abs(delta) < 0.3) {
            return Characteristic.CurrentHeaterCoolerState.IDLE;
        }

        return delta > 0
            ? Characteristic.CurrentHeaterCoolerState.HEATING
            : Characteristic.CurrentHeaterCoolerState.COOLING;
    }

    /**
     * Periodically simulates temperature changes to make
     * the accessory feel alive inside Apple Home.
     */
    private startMockTemperature(): void {
        this.temperatureTimer = setInterval(() => {
            if (!this.state.active) {
                return;
            }

            const { Characteristic } = this.platform;

            const target =
                this.state.mode ===
                Characteristic.TargetHeaterCoolerState.HEAT
                    ? this.state.targetHeatTemp
                    : this.state.targetCoolTemp;

            // Simple proportional approach to target temperature
            const delta = target - this.state.currentTemp;
            this.state.currentTemp += delta * 0.1;

            // Update HomeKit with new temperature
            this.service.updateCharacteristic(
                Characteristic.CurrentTemperature,
                this.state.currentTemp,
            );
        }, 10_000);
    }
}
