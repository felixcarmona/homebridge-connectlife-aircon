export interface HVACState {
    active: boolean;
    mode: number;
    currentTemp: number;
    targetCoolTemp: number;
    targetHeatTemp: number;
    fanSpeed: number;
}

export const DEFAULT_STATE: HVACState = {
    active: false,
    mode: 2, // COOL
    currentTemp: 26,
    targetCoolTemp: 24,
    targetHeatTemp: 20,
    fanSpeed: 50,
};
