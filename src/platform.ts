import {API, Logging, PlatformConfig, DynamicPlatformPlugin, PlatformAccessory} from 'homebridge';
import {AirconAccessory} from './aircon-accessory';
import {ConnectLifeApi} from './connect-life';
import {Appliance} from "./appliance";

interface ApplianceConfig {
    name: string;
}

export class ConnectLifeAirconPlatform implements DynamicPlatformPlugin {
    public readonly Service = this.api.hap.Service;
    public readonly Characteristic = this.api.hap.Characteristic;

    private accessories: PlatformAccessory[] = [];
    private appliances: Map<string, Appliance> = new Map();
    private readonly apiClient: ConnectLifeApi;

    private refreshTimer?: NodeJS.Timeout;
    private readonly pollIntervalMs: number;

    constructor(
        public readonly log: Logging,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.apiClient = new ConnectLifeApi(
            this.config.email,
            this.config.password,
        );

        for (const applianceConfig of this.config.appliances) {
            const appliance = new Appliance(applianceConfig.name, this.apiClient, this.log);
            this.appliances.set(applianceConfig.name, appliance);
        }

        this.pollIntervalMs = (this.config.pollIntervalSeconds ?? 30) * 1000;

        this.api.on('didFinishLaunching', async () => {
            await this.setupAccessories();
            this.startPolling();
        });

        this.api.on('shutdown', () => {
            this.stopPolling();
        });
    }

    configureAccessory(accessory: PlatformAccessory): void {
        this.accessories.push(accessory);
    }

    private startPolling(): void {
        const run = async () => {
            try {
                const apiAppliances = await this.apiClient.getAppliances();
                for (const [name, appliance] of this.appliances) {
                    const apiAppliance = apiAppliances.get(name);
                    if (!apiAppliance) {
                        appliance.online = false;
                        this.log.error(`appliance not found: ${name}`);
                        continue;
                    }

                    appliance.updateFromApi(apiAppliance)
                }
            } catch (err) {
                this.log.error('refresh failed:', err);
            }
        };

        // first refresh immediately
        void run();

        this.refreshTimer = setInterval(() => {
            void run();
        }, this.pollIntervalMs);
    }

    private stopPolling(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    private async setupAccessories(): Promise<void> {
        const applianceNames: string[] = (this.config.appliances ?? []).map(
            (d: ApplianceConfig) => d.name,
        );

        // Remove stale accessories
        for (const accessory of this.accessories) {
            if (!applianceNames.includes(accessory.displayName)) {
                this.log.info('Removing unused accessory:', accessory.displayName,);
                this.api.unregisterPlatformAccessories(
                    'homebridge-connectlife-aircon',
                    'ConnectLifeAircon',
                    [accessory],
                );
            }
        }

        for (const name of applianceNames) {
            const uuid = this.api.hap.uuid.generate(
                `connectlife-aircon-${name}`,
            );

            let platformAccessory = this.accessories.find(
                acc => acc.UUID === uuid,
            );

            if (!platformAccessory) {
                platformAccessory = new this.api.platformAccessory(name, uuid);

                this.api.registerPlatformAccessories(
                    'homebridge-connectlife-aircon',
                    'ConnectLifeAircon',
                    [platformAccessory],
                );
            }

            new AirconAccessory(this, platformAccessory, this.appliances.get(name), name);
        }
    }
}
