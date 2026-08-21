import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {Appliance} from './appliance';
import {ConnectLifeAirconPlatform} from './platform';

const TIMER_CONTEXT_KEY = 'connectLifeTimer';
const MAX_TIMEOUT_MS = 2_147_000_000;

interface PersistedTimerState {
    version: 1;
    serviceSubtype: string;
    expiresAt: number;
    expiredPendingOff: boolean;
}

export interface TimerControllerConfig {
    durationMinutes: number;
    turnOnWhenStarted: boolean;
}

interface TimerControllerRuntime {
    now?: () => number;
    setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
    retryBaseMs?: number;
}

export class TimerController {
    private readonly service: Service;
    private readonly durationMs: number;
    private readonly subtype: string;
    private readonly now: () => number;
    private readonly scheduleTimeout: NonNullable<TimerControllerRuntime['setTimeout']>;
    private readonly cancelTimeout: NonNullable<TimerControllerRuntime['clearTimeout']>;
    private readonly retryBaseMs: number;
    private timeout?: ReturnType<typeof setTimeout>;
    private retryCount = 0;
    private expiryInProgress = false;
    private stopped = false;

    constructor(
        private readonly platform: ConnectLifeAirconPlatform,
        private readonly accessory: PlatformAccessory,
        private readonly appliance: Appliance,
        private readonly accessoryName: string,
        private readonly config: TimerControllerConfig,
        runtime: TimerControllerRuntime = {},
    ) {
        this.durationMs = config.durationMinutes * 60_000;
        this.subtype = this.durationSubtype(config.durationMinutes);
        this.now = runtime.now ?? Date.now;
        this.scheduleTimeout = runtime.setTimeout ?? setTimeout;
        this.cancelTimeout = runtime.clearTimeout ?? clearTimeout;
        this.retryBaseMs = runtime.retryBaseMs ?? 60_000;

        this.service =
            accessory.getServiceById(platform.Service.Switch, this.subtype) ??
            accessory.addService(
                platform.Service.Switch,
                this.durationLabel(config.durationMinutes),
                this.subtype,
            );

        this.service.setCharacteristic(
            platform.Characteristic.Name,
            this.durationLabel(config.durationMinutes),
        );
        this.service
            .getCharacteristic(platform.Characteristic.On)
            .onGet(() => this.isActive())
            .onSet(async (value) => this.handleSet(value));

        this.restore();
    }

    public static removePersistedService(
        platform: ConnectLifeAirconPlatform,
        accessory: PlatformAccessory,
    ): void {
        const state = accessory.context[TIMER_CONTEXT_KEY];
        const subtype = state?.serviceSubtype;
        if (typeof subtype !== 'string' || !subtype.startsWith('timer-')) {
            return;
        }

        const service = accessory.getServiceById(platform.Service.Switch, subtype);
        if (service) {
            accessory.removeService(service);
        }
        delete accessory.context[TIMER_CONTEXT_KEY];
        platform.api.updatePlatformAccessories([accessory]);
    }

    public shutdown(): void {
        this.stopped = true;
        this.clearScheduledTimeout();
    }

    private async handleSet(value: CharacteristicValue): Promise<void> {
        if (value === true || value === 1) {
            await this.start();
            return;
        }
        this.cancel();
    }

    private async start(): Promise<void> {
        if (this.config.turnOnWhenStarted && !this.appliance.getActive()) {
            await this.appliance.setActive(true);
        }

        const state: PersistedTimerState = {
            version: 1,
            serviceSubtype: this.subtype,
            expiresAt: this.now() + this.durationMs,
            expiredPendingOff: false,
        };
        this.retryCount = 0;
        this.persist(state);
        this.scheduleForState(state);
        this.updateSwitch(true);
        this.platform.log.info(
            `${this.durationLabel(this.config.durationMinutes)} started for ` +
            `${this.accessoryName}`,
        );
    }

    private cancel(): void {
        this.clearScheduledTimeout();
        this.retryCount = 0;
        this.persist(this.emptyState());
        this.updateSwitch(false);
        this.platform.log.info(`Timer cancelled for ${this.accessoryName}`);
    }

    private restore(): void {
        const state = this.readState();
        const previousState = this.accessory.context[TIMER_CONTEXT_KEY];
        const previousSubtype = previousState?.serviceSubtype;
        if (typeof previousSubtype === 'string' &&
            previousSubtype.startsWith('timer-') &&
            previousSubtype !== this.subtype) {
            const obsoleteService = this.accessory.getServiceById(
                this.platform.Service.Switch,
                previousSubtype,
            );
            if (obsoleteService) {
                this.accessory.removeService(obsoleteService);
            }
        }
        if (!state || state.serviceSubtype !== this.subtype ||
            (!state.expiredPendingOff && state.expiresAt <= 0)) {
            this.persist(this.emptyState());
            this.updateSwitch(false);
            return;
        }

        this.updateSwitch(true);
        if (state.expiredPendingOff || state.expiresAt <= this.now()) {
            state.expiredPendingOff = true;
            this.persist(state);
            this.scheduleExpiryRetry(0);
            return;
        }

        this.scheduleForState(state);
    }

    private scheduleForState(state: PersistedTimerState): void {
        this.clearScheduledTimeout();
        const remainingMs = Math.max(0, state.expiresAt - this.now());
        const delayMs = Math.min(remainingMs, MAX_TIMEOUT_MS);
        this.timeout = this.scheduleTimeout(() => {
            this.timeout = undefined;
            if (state.expiresAt > this.now()) {
                this.scheduleForState(state);
                return;
            }
            void this.expire();
        }, delayMs);
    }

    private async expire(): Promise<void> {
        if (this.stopped || this.expiryInProgress) {
            return;
        }
        this.expiryInProgress = true;

        const state = this.readState() ?? this.emptyState();
        state.expiredPendingOff = true;
        this.persist(state);

        try {
            await this.appliance.setActive(false);
            this.retryCount = 0;
            this.persist(this.emptyState());
            this.updateSwitch(false);
            this.platform.log.info(`Timer expired; ${this.accessoryName} switched off`);
        } catch (err) {
            this.retryCount++;
            const retryMs = Math.min(
                this.retryBaseMs * 2 ** (this.retryCount - 1),
                15 * 60_000,
            );
            this.platform.log.warn(
                `Timer could not switch off ${this.accessoryName}; ` +
                `retrying in ${Math.round(retryMs / 1000)} seconds:`,
                err,
            );
            this.scheduleExpiryRetry(retryMs);
        } finally {
            this.expiryInProgress = false;
        }
    }

    private scheduleExpiryRetry(delayMs: number): void {
        this.clearScheduledTimeout();
        this.timeout = this.scheduleTimeout(() => {
            this.timeout = undefined;
            void this.expire();
        }, delayMs);
    }

    private isActive(): boolean {
        const state = this.readState();
        return Boolean(state && (
            state.expiredPendingOff || state.expiresAt > this.now()
        ));
    }

    private readState(): PersistedTimerState | null {
        const value = this.accessory.context[TIMER_CONTEXT_KEY];
        if (!value || value.version !== 1 ||
            typeof value.serviceSubtype !== 'string' ||
            typeof value.expiresAt !== 'number' ||
            !Number.isFinite(value.expiresAt) ||
            typeof value.expiredPendingOff !== 'boolean') {
            return null;
        }
        return {...value};
    }

    private persist(state: PersistedTimerState): void {
        this.accessory.context[TIMER_CONTEXT_KEY] = state;
        this.platform.api.updatePlatformAccessories([this.accessory]);
    }

    private emptyState(): PersistedTimerState {
        return {
            version: 1,
            serviceSubtype: this.subtype,
            expiresAt: 0,
            expiredPendingOff: false,
        };
    }

    private updateSwitch(active: boolean): void {
        this.service
            .getCharacteristic(this.platform.Characteristic.On)
            .updateValue(active);
    }

    private clearScheduledTimeout(): void {
        if (this.timeout !== undefined) {
            this.cancelTimeout(this.timeout);
            this.timeout = undefined;
        }
    }

    private durationSubtype(minutes: number): string {
        return minutes === 60 ? 'timer-1h' : `timer-${minutes}m`;
    }

    private durationLabel(minutes: number): string {
        if (minutes % 60 === 0) {
            return `Timer ${minutes / 60}h`;
        }
        return `Timer ${minutes}m`;
    }
}
