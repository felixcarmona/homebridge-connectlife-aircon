import {
    API,
    Logging,
    PlatformConfig,
    DynamicPlatformPlugin,
    PlatformAccessory,
} from 'homebridge';
import { AirconAccessory } from './aircon-accessory';
import { ConnectLifeApi } from './connect-life';
import { Appliance } from './appliance';
import {FileConnectLifeTokenStore} from './token-store';
import path from 'node:path';
import {AdaptivePoller} from './adaptive-poller';

export interface ApplianceConfig {
    name: string;
    timer?: {
        enabled?: boolean;
        durationMinutes?: number;
        turnOnWhenStarted?: boolean;
    };
}

export function validApplianceConfigs(value: unknown): ApplianceConfig[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((candidate): candidate is ApplianceConfig => {
        if (!candidate || typeof candidate !== 'object') {
            return false;
        }
        const name = (candidate as {name?: unknown}).name;
        return typeof name === 'string' && name.trim().length > 0;
    });
}

interface ConnectLifeConfig extends PlatformConfig {
    email?: string;
    password?: string;
    appliances?: ApplianceConfig[];
    pollIntervalSeconds?: number;
    diagnosticLogging?: boolean;
}

export class ConnectLifeAirconPlatform implements DynamicPlatformPlugin {
    public readonly Service = this.api.hap.Service;
    public readonly Characteristic = this.api.hap.Characteristic;

    private accessories: PlatformAccessory[] = [];
    private appliances: Map<string, Appliance> = new Map();
    private airconAccessories: AirconAccessory[] = [];
    private readonly apiClient: ConnectLifeApi;

    private poller?: AdaptivePoller;
    private readonly pollIntervalMs: number;

    constructor(
        public readonly log: Logging,
        public readonly config: ConnectLifeConfig,
        public readonly api: API,
    ) {
        this.apiClient = new ConnectLifeApi(
            config?.email ?? '',
            config?.password ?? '',
            {
                tokenStore: new FileConnectLifeTokenStore(
                    path.join(
                        this.api.user.storagePath(),
                        'connectlife-aircon.tokens.json',
                    ),
                ),
            },
        );

        const applianceConfigs = validApplianceConfigs(config?.appliances);
        const configuredCount = Array.isArray(config?.appliances)
            ? config.appliances.length
            : 0;
        if (applianceConfigs.length !== configuredCount) {
            this.log.warn(
                'Ignoring appliance configuration entries with an empty name',
            );
        }

        for (const applianceConfig of applianceConfigs) {
            const appliance = new Appliance(
                applianceConfig.name,
                this.apiClient
            );
            this.appliances.set(applianceConfig.name, appliance);
        }

        this.pollIntervalMs = (config?.pollIntervalSeconds ?? 30) * 1000;

        this.api.on('didFinishLaunching', async () => {
            if (!config?.email || !config?.password) {
                this.log.error(
                    'Plugin disabled due to missing configuration',
                );
                return;
            }

            await this.setupAccessories();
            this.startPolling();
        });

        this.api.on('shutdown', () => {
            for (const accessory of this.airconAccessories) {
                accessory.shutdown();
            }
            this.stopPolling();
        });
    }

    configureAccessory(accessory: PlatformAccessory): void {
        this.accessories.push(accessory);
    }

    private startPolling(): void {
        const run = async () => {
            const apiAppliances = await this.apiClient.getAppliances();

            for (const [name, appliance] of this.appliances) {
                const apiAppliance = apiAppliances.get(name);

                if (!apiAppliance) {
                    appliance.online = false;
                    this.log.error(`Appliance not found: ${name}`);
                    continue;
                }

                appliance.updateFromApi(apiAppliance);
            }
        };

        this.poller = new AdaptivePoller(
            run,
            this.pollIntervalMs,
            Math.max(this.pollIntervalMs, 15 * 60 * 1000),
            (err, failures) => {
                this.log.error(
                    `Refresh failed (${failures} consecutive failure${failures === 1 ? '' : 's'}):`,
                    err,
                );

                if (failures >= 3) {
                    for (const appliance of this.appliances.values()) {
                        appliance.online = false;
                    }
                }
            },
        );
        this.poller.start();
    }

    private stopPolling(): void {
        this.poller?.stop();
        this.poller = undefined;
    }

    private async setupAccessories(): Promise<void> {
        const applianceConfigs = validApplianceConfigs(this.config.appliances);
        const applianceNames: string[] = applianceConfigs.map(
            (d) => d.name,
        );

        // Remove stale accessories
        for (const accessory of this.accessories) {
            if (!applianceNames.includes(accessory.displayName)) {
                this.log.info(
                    'Removing unused accessory:',
                    accessory.displayName,
                );

                this.api.unregisterPlatformAccessories(
                    'homebridge-connectlife-aircon',
                    'ConnectLifeAircon',
                    [accessory],
                );
            }
        }

        // Register / restore accessories
        for (const name of applianceNames) {
            const uuid = this.api.hap.uuid.generate(
                `connectlife-aircon-${name}`,
            );

            let platformAccessory = this.accessories.find(
                (acc) => acc.UUID === uuid,
            );
            const restoredFromCache = Boolean(platformAccessory);

            if (!platformAccessory) {
                platformAccessory = new this.api.platformAccessory(name, uuid);

                this.api.registerPlatformAccessories(
                    'homebridge-connectlife-aircon',
                    'ConnectLifeAircon',
                    [platformAccessory],
                );
            }

            const heaterCoolerServices = platformAccessory.services.filter(
                (service) => service.UUID === this.Service.HeaterCooler.UUID,
            );
            if (heaterCoolerServices.length > 1) {
                for (const duplicate of heaterCoolerServices.slice(1)) {
                    platformAccessory.removeService(duplicate);
                }
                this.log.warn(
                    `Removed ${heaterCoolerServices.length - 1} duplicate ` +
                    `HeaterCooler service(s) from ${name}`,
                );
            }

            const applianceConfig = applianceConfigs.find(
                (candidate) => candidate.name === name,
            );
            const timerConfig = applianceConfig?.timer?.enabled
                ? {
                    durationMinutes: this.validTimerDuration(
                        applianceConfig.timer.durationMinutes,
                    ),
                    turnOnWhenStarted:
                        applianceConfig.timer.turnOnWhenStarted ?? true,
                }
                : undefined;

            const airconAccessory = new AirconAccessory(
                this,
                platformAccessory,
                this.appliances.get(name)!,
                name,
                timerConfig,
            );
            this.airconAccessories.push(airconAccessory);

            // Persist normalized characteristic properties while preserving the
            // accessory UUID and therefore the existing HomeKit pairing.
            this.api.updatePlatformAccessories([platformAccessory]);

            if (this.config.diagnosticLogging) {
                this.logAccessoryServices(platformAccessory, restoredFromCache);
            }
        }
    }

    private logAccessoryServices(
        accessory: PlatformAccessory,
        restoredFromCache: boolean,
    ): void {
        this.log.info(
            `[diagnostic] ${accessory.displayName} UUID=${accessory.UUID} ` +
            `source=${restoredFromCache ? 'cache' : 'new'}`,
        );

        for (const service of accessory.services) {
            const characteristics = service.characteristics
                .map((characteristic) => characteristic.displayName)
                .sort()
                .join(', ');
            this.log.info(
                `[diagnostic] service=${service.displayName} ` +
                `UUID=${service.UUID} subtype=${service.subtype ?? '-'} ` +
                `characteristics=[${characteristics}]`,
            );
        }
    }

    private validTimerDuration(value: number | undefined): number {
        if (value === undefined || !Number.isFinite(value)) {
            return 60;
        }
        return Math.min(10_080, Math.max(1, Math.trunc(value)));
    }

}
