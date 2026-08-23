const assert = require('node:assert/strict');
const test = require('node:test');
const {ConnectLifeApi} = require('../dist/connect-life');

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {'Content-Type': 'application/json'},
    });
}

test('reads appliances directly from the signed HijuConn gateway request', async () => {
    const calls = [];
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async (url, options) => {
            calls.push({url: String(url), options});
            return jsonResponse({
                response: {
                    resultCode: 0,
                    deviceList: [
                        {
                            puid: 'test-puid',
                            deviceNickName: 'Living Room',
                            statusList: {
                                t_power: '1',
                                t_temp: '22',
                                t_temp_type: '0',
                                t_fan_speed: '7',
                                t_up_down: '1',
                                t_work_mode: '2',
                                f_temp_in: '24',
                            },
                        },
                    ],
                },
            });
        },
    });

    const appliances = await api.getAppliances();
    const appliance = appliances.get('Living Room');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');

    const url = new URL(calls[0].url);
    assert.equal(url.origin, 'https://clife-eu-gateway.hijuconn.com');
    assert.equal(url.pathname, '/clife-svc/pu/get_device_status_list');
    assert.equal(url.searchParams.get('accessToken'), 'test-access-token');
    assert.equal(url.searchParams.get('appId'), '47110565134383');
    assert.match(url.searchParams.get('randStr'), /^[a-f0-9]{32}$/);
    assert.ok(url.searchParams.get('sign'));

    assert.deepEqual(appliance, {
        puid: 'test-puid',
        online: true,
        state: {
            t_power: 1,
            t_temp: 22,
            t_temp_type: 0,
            t_fan_speed: 7,
            t_up_down: 1,
            t_work_mode: 2,
            f_temp_in: 24,
        },
    });
});

test('rejects a successful envelope without deviceList', async () => {
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async () => jsonResponse({response: {resultCode: 0}}),
    });

    await assert.rejects(api.getAppliances(), /missing deviceList/);
});

test('keeps valid fields from incomplete devices without exposing NaN state', async () => {
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async () => jsonResponse({
            response: {
                resultCode: 0,
                deviceList: [
                    {
                        puid: 'incomplete-device',
                        deviceNickName: 'Incomplete',
                        statusList: {t_power: '1'},
                    },
                ],
            },
        }),
    });

    const appliance = (await api.getAppliances()).get('Incomplete');
    assert.deepEqual(appliance.state, {t_power: 1});
});

test('maps gateway offlineState to appliance availability', async () => {
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async () => jsonResponse({
            response: {
                resultCode: 0,
                deviceList: [
                    {
                        puid: 'offline-device',
                        deviceNickName: 'Offline AC',
                        offlineState: 0,
                        statusList: {
                            t_power: '0',
                            t_temp: '22',
                            t_temp_type: '0',
                            t_fan_speed: '7',
                            t_up_down: '0',
                            t_work_mode: '2',
                            f_temp_in: '24',
                        },
                    },
                ],
            },
        }),
    });

    assert.equal((await api.getAppliances()).get('Offline AC').online, false);
});

test('updates an appliance directly through the signed HijuConn gateway', async () => {
    const calls = [];
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async (url, options) => {
            calls.push({url: String(url), options});
            return jsonResponse({response: {resultCode: 0}});
        },
    });

    await api.setApplianceStatus('test-puid', {
        t_power: 1,
        t_temp: 22,
    });

    assert.equal(calls.length, 1);
    assert.equal(
        calls[0].url,
        'https://clife-eu-gateway.hijuconn.com/device/pu/property/set',
    );
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(
        calls[0].options.headers['Content-Type'],
        'application/json',
    );

    const request = JSON.parse(calls[0].options.body);
    assert.equal(request.accessToken, 'test-access-token');
    assert.equal(request.puid, 'test-puid');
    assert.deepEqual(request.properties, {t_power: 1, t_temp: 22});
    assert.match(request.randStr, /^[a-f0-9]{32}$/);
    assert.ok(request.sign);
});

test('rejects an appliance update refused by the gateway', async () => {
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async () => jsonResponse({
            response: {
                resultCode: 1,
                errorCode: 101005,
                errorDesc: 'randStr check fail',
            },
        }),
    });

    await assert.rejects(
        api.setApplianceStatus('test-puid', {t_power: 1}),
        /code=101005 description=randStr check fail/,
    );
});

function loginFlowResponse(url, options, tokenResponse) {
    const endpoint = String(url);

    if (endpoint.endsWith('/accounts.login')) {
        return jsonResponse({
            UID: 'test-uid',
            sessionInfo: {cookieValue: 'test-login-token'},
        });
    }
    if (endpoint.endsWith('/accounts.getJWT')) {
        return jsonResponse({id_token: 'test-id-token'});
    }
    if (endpoint.endsWith('/oauth/authorize')) {
        return jsonResponse({code: 'test-authorization-code'});
    }
    if (endpoint.endsWith('/oauth/token')) {
        return jsonResponse(tokenResponse(options));
    }
    if (endpoint.includes('/get_device_status_list')) {
        return jsonResponse({response: {resultCode: 0, deviceList: []}});
    }

    throw new Error(`Unexpected test URL: ${endpoint}`);
}

test('uses refresh_token after access token expiry without repeating Gigya login', async () => {
    let now = 1_000_000;
    const calls = [];
    let tokenRequestCount = 0;

    const api = new ConnectLifeApi('user@example.com', 'password', {
        now: () => now,
        fetch: async (url, options) => {
            calls.push({url: String(url), options});
            return loginFlowResponse(url, options, (tokenOptions) => {
                tokenRequestCount++;
                const params = new URLSearchParams(tokenOptions.body);

                if (params.get('grant_type') === 'refresh_token') {
                    assert.equal(params.get('refresh_token'), 'refresh-1');
                    return {
                        access_token: 'access-2',
                        expires_in: 3600,
                        refresh_token: 'refresh-2',
                    };
                }

                return {
                    access_token: 'access-1',
                    expires_in: 3600,
                    refresh_token: 'refresh-1',
                };
            });
        },
    });

    await api.getAppliances();
    now += 3_600_000;
    await api.getAppliances();

    assert.equal(
        calls.filter((call) => call.url.endsWith('/accounts.login')).length,
        1,
    );
    assert.equal(
        calls.filter((call) => call.url.endsWith('/accounts.getJWT')).length,
        1,
    );
    assert.equal(
        calls.filter((call) => call.url.endsWith('/oauth/authorize')).length,
        1,
    );
    assert.equal(tokenRequestCount, 2);

    const gatewayCalls = calls.filter((call) =>
        call.url.includes('/get_device_status_list'),
    );
    assert.equal(gatewayCalls.length, 2);
    assert.equal(
        new URL(gatewayCalls[0].url).searchParams.get('accessToken'),
        'access-1',
    );
    assert.equal(
        new URL(gatewayCalls[1].url).searchParams.get('accessToken'),
        'access-2',
    );
});

test('shares one complete login between concurrent requests', async () => {
    const calls = [];
    const api = new ConnectLifeApi('user@example.com', 'password', {
        fetch: async (url, options) => {
            calls.push({url: String(url), options});
            await new Promise((resolve) => setImmediate(resolve));
            return loginFlowResponse(url, options, () => ({
                access_token: 'shared-access-token',
                expires_in: 3600,
                refresh_token: 'shared-refresh-token',
            }));
        },
    });

    await Promise.all([api.getAppliances(), api.getAppliances()]);

    assert.equal(
        calls.filter((call) => call.url.endsWith('/accounts.login')).length,
        1,
    );
    assert.equal(
        calls.filter((call) => call.url.endsWith('/oauth/token')).length,
        1,
    );
    assert.equal(
        calls.filter((call) => call.url.includes('/get_device_status_list')).length,
        2,
    );
});

test('authentication timeout aborts the request that is still in flight', async () => {
    let observedAbort = false;
    const api = new ConnectLifeApi('user@example.com', 'password', {
        authenticationTimeoutMs: 10,
        fetch: async (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                observedAbort = true;
                reject(new DOMException('aborted', 'AbortError'));
            });
        }),
    });

    await assert.rejects(api.getAppliances(), /authentication timeout/);
    assert.equal(observedAbort, true);
});

test('retries randStr error once with a fresh nonce and signature', async () => {
    const requests = [];
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async (_url, options) => {
            requests.push(JSON.parse(options.body));

            if (requests.length === 1) {
                return jsonResponse({
                    response: {
                        resultCode: 1,
                        errorCode: 101005,
                        errorDesc: 'randStr check fail',
                    },
                });
            }

            return jsonResponse({response: {resultCode: 0}});
        },
    });

    await api.setApplianceStatus('test-puid', {t_power: 1});

    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].randStr, requests[1].randStr);
    assert.notEqual(requests[0].sign, requests[1].sign);
});

test('refreshes once and retries when gateway rejects access token', async () => {
    const calls = [];
    let gatewayCallCount = 0;

    const api = new ConnectLifeApi('user@example.com', 'password', {
        fetch: async (url, options) => {
            const endpoint = String(url);
            calls.push({url: endpoint, options});

            if (endpoint.includes('/get_device_status_list')) {
                gatewayCallCount++;
                if (gatewayCallCount === 1) {
                    return jsonResponse({
                        response: {
                            resultCode: 1,
                            errorCode: 100026,
                            errorDesc: 'access token invalid',
                        },
                    });
                }
                return jsonResponse({response: {resultCode: 0, deviceList: []}});
            }

            return loginFlowResponse(url, options, (tokenOptions) => {
                const grantType = new URLSearchParams(tokenOptions.body)
                    .get('grant_type');
                return grantType === 'refresh_token'
                    ? {access_token: 'access-2', expires_in: 3600}
                    : {
                        access_token: 'access-1',
                        expires_in: 3600,
                        refresh_token: 'refresh-1',
                    };
            });
        },
    });

    await api.getAppliances();

    assert.equal(gatewayCallCount, 2);
    assert.equal(
        calls.filter((call) => call.url.endsWith('/accounts.login')).length,
        1,
    );
    assert.equal(
        calls.filter((call) => {
            if (!call.url.endsWith('/oauth/token')) return false;
            return new URLSearchParams(call.options.body)
                .get('grant_type') === 'refresh_token';
        }).length,
        1,
    );

    const gatewayCalls = calls.filter((call) =>
        call.url.includes('/get_device_status_list'),
    );
    assert.equal(
        new URL(gatewayCalls[1].url).searchParams.get('accessToken'),
        'access-2',
    );
});

test('does not retry an unknown gateway error', async () => {
    let calls = 0;
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async () => {
            calls++;
            return jsonResponse({
                response: {
                    resultCode: 1,
                    errorCode: 999999,
                    errorDesc: 'permanent test error',
                },
            });
        },
    });

    await assert.rejects(
        api.getAppliances(),
        /code=999999 description=permanent test error/,
    );
    assert.equal(calls, 1);
});

test('persists tokens and reuses refresh token in a new client instance', async () => {
    let savedState = null;
    let now = 1_000_000;
    const tokenStore = {
        load: async () => savedState ? {...savedState} : null,
        save: async (state) => {
            savedState = {...state};
        },
        clear: async () => {
            savedState = null;
        },
    };

    const firstCalls = [];
    const first = new ConnectLifeApi('user@example.com', 'password', {
        now: () => now,
        tokenStore,
        fetch: async (url, options) => {
            firstCalls.push(String(url));
            return loginFlowResponse(url, options, () => ({
                access_token: 'persisted-access',
                expires_in: 3600,
                refresh_token: 'persisted-refresh',
            }));
        },
    });

    await first.getAppliances();
    assert.equal(savedState.accessToken, 'persisted-access');
    assert.equal(savedState.refreshToken, 'persisted-refresh');

    now += 3_600_000;
    const secondCalls = [];
    const second = new ConnectLifeApi('user@example.com', 'password', {
        now: () => now,
        tokenStore,
        fetch: async (url, options) => {
            secondCalls.push({url: String(url), options});
            return loginFlowResponse(url, options, (tokenOptions) => {
                const params = new URLSearchParams(tokenOptions.body);
                assert.equal(params.get('grant_type'), 'refresh_token');
                assert.equal(params.get('refresh_token'), 'persisted-refresh');
                return {
                    access_token: 'access-after-restart',
                    expires_in: 3600,
                    refresh_token: 'refresh-after-restart',
                };
            });
        },
    });

    await second.getAppliances();

    assert.equal(
        secondCalls.filter((call) => call.url.endsWith('/accounts.login')).length,
        0,
    );
    assert.equal(savedState.accessToken, 'access-after-restart');
    assert.equal(savedState.refreshToken, 'refresh-after-restart');
});

test('keeps persisted refresh token and does not call Gigya after OAuth 5xx', async () => {
    const savedState = {
        accessToken: 'expired-access',
        accessTokenExpiresAt: 1,
        refreshToken: 'valuable-refresh-token',
        refreshTokenExpiresAt: null,
    };
    let cleared = false;
    const calls = [];
    const tokenStore = {
        load: async () => ({...savedState}),
        save: async () => {},
        clear: async () => {
            cleared = true;
        },
    };
    const api = new ConnectLifeApi('user@example.com', 'password', {
        now: () => 2,
        tokenStore,
        fetch: async (url) => {
            calls.push(String(url));
            return jsonResponse({message: 'temporary failure'}, 503);
        },
    });

    await assert.rejects(api.getAppliances(), /oauth refresh error: \[503\]/);
    assert.equal(cleared, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'https://oauth.hijuconn.com/oauth/token');
});

test('falls back to one full login when OAuth rejects the refresh token', async () => {
    const calls = [];
    let savedState = {
        accessToken: 'expired-access',
        accessTokenExpiresAt: 1,
        refreshToken: 'rejected-refresh',
        refreshTokenExpiresAt: null,
    };
    const tokenStore = {
        load: async () => ({...savedState}),
        save: async (state) => {
            savedState = {...state};
        },
        clear: async () => {
            savedState = null;
        },
    };
    const api = new ConnectLifeApi('user@example.com', 'password', {
        now: () => 2,
        tokenStore,
        fetch: async (url, options) => {
            const endpoint = String(url);
            calls.push({url: endpoint, options});
            if (endpoint.endsWith('/oauth/token')) {
                const grantType = new URLSearchParams(options.body).get('grant_type');
                if (grantType === 'refresh_token') {
                    return jsonResponse({message: 'refresh rejected'}, 401);
                }
            }
            return loginFlowResponse(url, options, () => ({
                access_token: 'access-from-full-login',
                expires_in: 3600,
                refresh_token: 'new-refresh',
            }));
        },
    });

    await api.getAppliances();

    assert.equal(calls.filter((call) => call.url.endsWith('/accounts.login')).length, 1);
    assert.equal(calls.filter((call) => call.url.endsWith('/accounts.getJWT')).length, 1);
    assert.equal(savedState.accessToken, 'access-from-full-login');
    assert.equal(savedState.refreshToken, 'new-refresh');
});

test('rejects malformed gateway JSON without retrying or invalidating the token', async () => {
    let calls = 0;
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async () => {
            calls++;
            return new Response('{invalid json', {
                status: 200,
                headers: {'Content-Type': 'application/json'},
            });
        },
    });

    await assert.rejects(api.getAppliances(), SyntaxError);
    assert.equal(calls, 1);
});

test('reports Gigya rate limit without exposing response secrets', async () => {
    const api = new ConnectLifeApi('private@example.com', 'private-password', {
        fetch: async (url) => {
            if (String(url).endsWith('/accounts.login')) {
                return jsonResponse({
                    UID: 'private-uid',
                    sessionInfo: {cookieValue: 'private-login-token'},
                });
            }
            return jsonResponse({
                errorCode: 403048,
                errorMessage: 'Api rate limit exceeded',
                id_token: 'must-never-be-logged',
            });
        },
    });

    let error;
    try {
        await api.getAppliances();
    } catch (err) {
        error = err;
    }

    assert.match(error.message, /code=403048/);
    assert.match(error.message, /Api rate limit exceeded/);
    assert.doesNotMatch(error.message, /private@example\.com/);
    assert.doesNotMatch(error.message, /private-password/);
    assert.doesNotMatch(error.message, /private-login-token/);
    assert.doesNotMatch(error.message, /must-never-be-logged/);
});

test('does not include non-JSON HTTP response bodies in errors', async () => {
    const api = new ConnectLifeApi('unused', 'unused', {
        accessToken: 'test-access-token',
        fetch: async () => new Response(
            '<html>Cloudflare secret diagnostic content</html>',
            {status: 530},
        ),
    });

    await assert.rejects(
        api.getAppliances(),
        (err) => {
            assert.match(err.message, /\[530\] non-JSON response/);
            assert.doesNotMatch(err.message, /secret diagnostic content/);
            return true;
        },
    );
});
