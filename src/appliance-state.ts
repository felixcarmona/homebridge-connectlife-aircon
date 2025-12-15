/* ===================== RAW (ConnectLife) ===================== */

export type ConnectLifeApplianceState = {
    t_power: number;       // 0 | 1
    t_temp: number;        // °C
    t_temp_type: number;   // 0=C, 1=F
    t_up_down: number;     // 0 = disabled | 1 = enabled
    t_work_mode: number;   // 0..4
    f_temp_in: number;     // °C
    t_fan_speed: number;   // 0 = auto, 5 = super low, 6 = low, 7 = medium, 8 = high, 9 = super high
};

export type HomeKitApplianceState = {
    active: boolean;
    targetTemp: number;
    currentTemp: number;
    targetMode: number;     // 0 = auto | 1 = heat | 2 = cool
    rotationSpeed: number;  // 0–100
    swingMode: number;      // 0 = disabled | 1 = enabled
    tempUnit: number;       // 0 = C, 1 = F
};

/* ===================== Fan speed mapping ===================== */

function fanSpeedToRotation(speed?: number): number {
    switch (speed) {
        case 5: return 20;
        case 6: return 35;
        case 7: return 50;
        case 8: return 75;
        case 9: return 100;
        case 0:
        default:
            return 20;
    }
}

function rotationToFanSpeed(value: number): number {
    if (value <= 25) return 5;
    if (value <= 40) return 6;
    if (value <= 60) return 7;
    if (value <= 85) return 8;
    return 9;
}

/* ===================== Work mode mapping ===================== */
/**
 * ConnectLife:
 * 0 FanOnly
 * 1 Heat
 * 2 Cool
 * 3 Dry
 * 4 Auto
 */

function workModeToHomeKit(mode: number): number {
    switch (mode) {
        case 2: return 2; // COOL
        case 1: return 1; // HEAT
        default:
            return 0;       // AUTO
    }
}

function homeKitToWorkMode(value: number): number {
    switch (value) {
        case 2: return 2; // COOL
        case 1: return 1; // HEAT
        default:
            return 4; // AUTO
    }
}

/* ===================== Swing mapping ===================== */

function swingToHomeKit(value: number): number {
    return value === 1 ? 1 : 0;
}

function homeKitToSwing(value: number): number {
    return value === 1 ? 1 : 0;
}

/* ===================== MAIN MAPPERS ===================== */

export function mapConnectLifeToHomeKit(
    raw: ConnectLifeApplianceState,
): HomeKitApplianceState {

    const isFahrenheit = raw.t_temp_type === 1;

    return {
        active: raw.t_power === 1,
        targetTemp: isFahrenheit
            ? fahrenheitToCelsius(raw.t_temp)
            : raw.t_temp,
        currentTemp: isFahrenheit
            ? fahrenheitToCelsius(raw.f_temp_in)
            : raw.f_temp_in,
        targetMode: workModeToHomeKit(raw.t_work_mode),
        rotationSpeed: fanSpeedToRotation(raw.t_fan_speed),
        swingMode: swingToHomeKit(raw.t_up_down),
        tempUnit: isFahrenheit ? 1 : 0,
    };
}

export function mapHomeKitToConnectLife(
    hk: Partial<HomeKitApplianceState>,
    currentUnit: number,
): Partial<ConnectLifeApplianceState> {
    const result: Partial<ConnectLifeApplianceState> = {};
    const isFahrenheit = currentUnit === 1;

    if (hk.active !== undefined) {
        result.t_power = hk.active ? 1 : 0;
    }

    if (hk.targetTemp !== undefined) {
        result.t_temp = isFahrenheit
            ? celsiusToFahrenheit(hk.targetTemp)
            : hk.targetTemp;
    }

    if (hk.targetMode !== undefined) {
        result.t_work_mode = homeKitToWorkMode(hk.targetMode);
    }

    if (hk.rotationSpeed !== undefined) {
        result.t_fan_speed = rotationToFanSpeed(hk.rotationSpeed);
    }

    if (hk.swingMode !== undefined) {
        result.t_up_down = homeKitToSwing(hk.swingMode);
    }

    return result;
}


function celsiusToFahrenheit(celsius: number): number {
    return (celsius * 9) / 5 + 32;
}

function fahrenheitToCelsius(fahrenheit: number): number {
    return ((fahrenheit - 32) * 5) / 9;
}