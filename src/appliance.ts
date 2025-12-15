import { ConnectLifeAppliance, ConnectLifeApi } from './connect-life';
import {Logging} from 'homebridge';
import {HomeKitApplianceState, mapConnectLifeToHomeKit, mapHomeKitToConnectLife,} from './appliance-state';

export class ApplianceOfflineError extends Error {
    constructor(name: string) {
        super(`appliance "${name}" offline`);
    }
}

export class Appliance {
    public online = false;

    private puid: string | null = null;
    private state: HomeKitApplianceState = {
        active: false,
        targetTemp: 16,
        currentTemp: 0,
        targetMode: 0,
        rotationSpeed: 0,
        swingMode: 0,
        tempUnit: 0,
    };

    constructor(
        private readonly name: string,
        private readonly api: ConnectLifeApi,
        private readonly log: Logging,
    ) {}

    public updateFromApi(connectLifeAppliance: ConnectLifeAppliance): void {
        this.puid = connectLifeAppliance.puid;
        this.state = mapConnectLifeToHomeKit(connectLifeAppliance.state);
        this.online = true;
    }

    getActive(): boolean {
        return this.online ? this.state.active : false;
    }

    getTargetTemperature(): number {
        return this.state.targetTemp;
    }

    getCurrentTemperature(): number {
        return this.state.currentTemp;
    }

    getTargetMode(): number {
        return this.state.targetMode;
    }

    getRotationSpeed(): number {
        return this.state.rotationSpeed;
    }

    getSwingMode(): number {
        return this.state.swingMode;
    }

    getTemperatureDisplayUnits() {
        return this.state.tempUnit
    }

    async setActive(value: boolean): Promise<void> {
        this.ensureOnline();

        const prev = this.state.active;
        this.state.active = value;

        try {
            const payload = mapHomeKitToConnectLife({ active: value }, this.state.tempUnit);
            await this.api.setApplianceStatus(this.puid!, payload);
        } catch (err) {
            this.state.active = prev;
            throw err;
        }
    }

    async setTargetTemperature(value: number, targetMode: number): Promise<void> {
        this.ensureOnline();

        const prev = this.state.targetTemp;

        this.state.targetTemp = value;

        try {
            const payload = mapHomeKitToConnectLife({
                targetTemp: value,
            }, this.state.tempUnit);

            await this.api.setApplianceStatus(this.puid!, payload);
        } catch (err) {
            this.state.targetTemp = prev;
            throw err;
        }

        // changing target temperature may change target mode. reapply it.
        await this.setTargetMode(targetMode);
    }

    async setTargetMode(value: number): Promise<void> {
        this.ensureOnline();

        const prev = this.state.targetMode;
        this.state.targetMode = value;
        const rotationSpeed = this.state.rotationSpeed;
        try {
            await this.api.setApplianceStatus(this.puid!, mapHomeKitToConnectLife({targetMode: value}, this.state.tempUnit));
        } catch (err) {
            this.state.targetMode = prev;
            throw err;
        }

        // switching target mode will reset rotation speed, reapply it.
        await this.setRotationSpeed(rotationSpeed);
    }

    async setRotationSpeed(value: number): Promise<void> {
        this.ensureOnline();

        const prev = this.state.rotationSpeed;
        this.state.rotationSpeed = value;

        try {
            const payload = mapHomeKitToConnectLife({ rotationSpeed: value }, this.state.tempUnit);
            await this.api.setApplianceStatus(this.puid!, payload);
        } catch (err) {
            this.state.rotationSpeed = prev;
            throw err;
        }
    }

    async setSwingMode(value: number): Promise<void> {
        this.ensureOnline();

        const prev = this.state.swingMode;
        this.state.swingMode = value;

        try {
            const payload = mapHomeKitToConnectLife({ swingMode: value }, this.state.tempUnit);
            await this.api.setApplianceStatus(this.puid!, payload);
        } catch (err) {
            this.state.swingMode = prev;
            throw err;
        }
    }

    private ensureOnline(): void {
        if (!this.online || !this.puid) {
            throw new ApplianceOfflineError(this.name);
        }
    }
}
