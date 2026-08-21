const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildGatewayRequest,
    canonicalizeGatewayPayload,
    signGatewayPayload,
} = require('../dist/connect-life-gateway');

test('canonicalizes keys and compact JSON in the gateway format', () => {
    assert.equal(
        canonicalizeGatewayPayload({
            version: '5.0',
            properties: {t_power: 1, t_temp: 22},
            accessToken: 'token',
            sign: 'must-be-ignored',
        }),
        'accessToken=token&properties={"t_power":1,"t_temp":22}&version=5.0',
    );
});

test('builds a complete request with controlled timestamp and nonce', () => {
    const request = buildGatewayRequest(
        'token',
        {puid: 'device', properties: {t_power: 1}},
        {timestampMs: 1720000000123, randStr: '0123456789abcdef0123456789abcdef'},
    );

    assert.equal(request.accessToken, 'token');
    assert.equal(request.appId, '47110565134383');
    assert.equal(request.languageId, '12');
    assert.equal(request.randStr, '0123456789abcdef0123456789abcdef');
    assert.equal(request.timeStamp, '1720000000123');
    assert.equal(request.timezone, '1.0');
    assert.equal(request.version, '5.0');
    assert.equal(request.puid, 'device');
    assert.deepEqual(request.properties, {t_power: 1});
    assert.match(request.sign, /^[A-Za-z0-9+/]{342}==$/);
});

test('generates a fresh nonce for every request', () => {
    const first = buildGatewayRequest('token');
    const second = buildGatewayRequest('token');

    assert.match(first.randStr, /^[a-f0-9]{32}$/);
    assert.match(second.randStr, /^[a-f0-9]{32}$/);
    assert.notEqual(first.randStr, second.randStr);
});

test('produces a valid 2048-bit RSA ciphertext', () => {
    const signature = signGatewayPayload({accessToken: 'token'});
    assert.equal(Buffer.from(signature, 'base64').length, 256);
});
