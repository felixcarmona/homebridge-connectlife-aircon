// Gateway request format and signing protocol based on:
// https://github.com/bilan/connectlife-api-connector
// Reimplemented in TypeScript for this Homebridge plugin.
import {
    constants,
    createHash,
    publicEncrypt,
    randomBytes,
} from 'node:crypto';

export const CONNECT_LIFE_GATEWAY_BASE_URL =
    'https://clife-eu-gateway.hijuconn.com';
export const CONNECT_LIFE_DEVICE_LIST_URL =
    `${CONNECT_LIFE_GATEWAY_BASE_URL}/clife-svc/pu/get_device_status_list`;
export const CONNECT_LIFE_UPDATE_URL =
    `${CONNECT_LIFE_GATEWAY_BASE_URL}/device/pu/property/set`;

const GATEWAY_APP_ID = '47110565134383';
const GATEWAY_APP_SECRET =
    'yOzhz6junYno-nmULM3Wr7PU_dpSZN22ZdluvVWZ4uW5ZwwG8fIGCHTbrhcnU-iv';
const GATEWAY_SIGN_SUFFIX = 'D9519A4B756946F081B7BB5B5E8D1197';

const GATEWAY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyyWrNG6q475HIHu7sMVu
vHof6vlgPeixmxa4EL/UsvVvHPz33NnWoQetQqit9TBNzUjMXw0KlY9PXM4iqHUU
U+dSyNDq1jZWIiJ2C2FccppswJtIKL3NRMFvT9PFh6NlP/4FUcQKojgKFbF7Kacc
JPKYHlwaO7qgoIjLxAHlSOXGpucJcOkPzT2EqsSVnW8sn8kenvNmghXDayhgxsh6
AyxK4kehJplEnmX/iYCfNoFXknGcLqFWYccgBz3fybvx30C/0IgU1980L8QsUAv5
esZmN8ugnbRgLRxKRlkQQLxQAiZMZdKTAx665YflT3YMHJvEFE8c2XFgoxHzSMc4
BwIDAQAB
-----END PUBLIC KEY-----`;

export type GatewayValue =
    string | number | boolean | null | Record<string, unknown> | unknown[];

export type GatewayRequest = Record<string, GatewayValue> & {
    accessToken: string;
    appId: string;
    appSecret: string;
    languageId: string;
    randStr: string;
    timeStamp: string;
    timezone: string;
    version: string;
    sign: string;
};

function serializeGatewayValue(value: GatewayValue): string {
    if (value !== null && typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

/**
 * Return the canonical unsigned representation expected by HijuConn.
 * Exported so its behaviour can be verified without making cloud requests.
 */
export function canonicalizeGatewayPayload(
    payload: Record<string, GatewayValue>,
): string {
    return Object.keys(payload)
        .filter((key) => key !== 'sign')
        .sort()
        .map((key) => `${key}=${serializeGatewayValue(payload[key])}`)
        .join('&');
}

export function signGatewayPayload(
    payload: Record<string, GatewayValue>,
): string {
    const canonical = canonicalizeGatewayPayload(payload);
    const digest = createHash('sha256')
        .update(`${canonical}${GATEWAY_SIGN_SUFFIX}`, 'utf8')
        .digest();

    return publicEncrypt(
        {
            key: GATEWAY_PUBLIC_KEY,
            padding: constants.RSA_PKCS1_PADDING,
        },
        digest,
    ).toString('base64');
}

export function buildGatewayRequest(
    accessToken: string,
    payload: Record<string, GatewayValue> = {},
    options: {timestampMs?: number; randStr?: string} = {},
): GatewayRequest {
    const unsigned: Record<string, GatewayValue> = {
        accessToken,
        appId: GATEWAY_APP_ID,
        appSecret: GATEWAY_APP_SECRET,
        languageId: '12',
        randStr: options.randStr ?? randomBytes(16).toString('hex'),
        timeStamp: String(options.timestampMs ?? Date.now()),
        timezone: '1.0',
        version: '5.0',
        ...payload,
    };

    return {
        ...unsigned,
        sign: signGatewayPayload(unsigned),
    } as GatewayRequest;
}
