export interface PollingTimer {
    set(callback: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
}

const nodePollingTimer: PollingTimer = {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export class AdaptivePoller {
    private timerHandle: unknown;
    private running = false;
    private consecutiveFailures = 0;

    constructor(
        private readonly task: () => Promise<void>,
        private readonly baseIntervalMs: number,
        private readonly maxIntervalMs: number,
        private readonly onError: (err: unknown, failures: number) => void,
        private readonly timer: PollingTimer = nodePollingTimer,
    ) {
        if (!Number.isFinite(baseIntervalMs) || baseIntervalMs <= 0) {
            throw new Error('Polling interval must be greater than zero');
        }
        if (maxIntervalMs < baseIntervalMs) {
            throw new Error('Maximum polling interval cannot be smaller than base interval');
        }
    }

    start(): void {
        if (this.running) {
            return;
        }

        this.running = true;
        this.schedule(0);
    }

    stop(): void {
        this.running = false;
        if (this.timerHandle !== undefined) {
            this.timer.clear(this.timerHandle);
            this.timerHandle = undefined;
        }
    }

    private schedule(delayMs: number): void {
        if (!this.running) {
            return;
        }

        this.timerHandle = this.timer.set(() => {
            this.timerHandle = undefined;
            void this.run();
        }, delayMs);
    }

    private async run(): Promise<void> {
        try {
            await this.task();
            this.consecutiveFailures = 0;
        } catch (err) {
            this.consecutiveFailures++;
            this.onError(err, this.consecutiveFailures);
        } finally {
            if (this.running) {
                this.schedule(this.nextDelayMs());
            }
        }
    }

    private nextDelayMs(): number {
        if (this.consecutiveFailures === 0) {
            return this.baseIntervalMs;
        }

        const multiplier = 2 ** Math.min(this.consecutiveFailures, 20);
        return Math.min(
            this.baseIntervalMs * multiplier,
            this.maxIntervalMs,
        );
    }
}
