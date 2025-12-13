import {API, Logging, PlatformConfig} from 'homebridge';
import { HVACAccessory } from './hvacAccessory';

export class ConnectLifeHVACPlatform {
    public readonly Service = this.api.hap.Service;
    public readonly Characteristic = this.api.hap.Characteristic;

    constructor(
        public readonly log: Logging,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.api.on('didFinishLaunching', () => {
            this.setupAccessory();
        });
    }

    setupAccessory() {
        const uuid = this.api.hap.uuid.generate('connectlife-hvac-mock');
        const accessory = new this.api.platformAccessory(
            'ConnectLife HVAC',
            uuid,
        );

        new HVACAccessory(this, accessory);
        this.api.registerPlatformAccessories(
            'homebridge-connectlife-hvac',
            'ConnectLifeHVAC',
            [accessory],
        );
    }
}
