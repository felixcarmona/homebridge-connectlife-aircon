import {ConnectLifeApplianceState} from "./appliance-state";

export interface ConnectLifeAppliance {
    puid: string;
    state: ConnectLifeApplianceState;
}

export class ConnectLifeApi {
    private readonly loginTimeoutMs = 15_000;
    private readonly appliancesUri = 'https://connectlife.bapi.ovh/appliances';
    private readonly giyaClientSecret =
        '07swfKgvJhC3ydOUS9YV_SwVz0i4LKqlOLGNUukYHVMsJRF1b-iWeUGcNlXyYCeK';
    private readonly clientId = '5065059336212';
    private readonly gmid =
        'gmid.ver4.AtLt3mZAMA.C8m5VqSTEQDrTRrkYYDgOaJWcyQ-XHow5nzQSXJF3EO3TnqTJ8tKUmQaaQ6z8p0s.zcTbHe6Ax6lHfvTN7JUj7VgO4x8Vl-vk1u0kZcrkKmKWw8K9r0shyut_at5Q0ri6zTewnAv2g1Dc8dauuyd-Sw.sc3';
    private readonly maxRetries = 10;
    private readonly retryDelayMs = 1_000;
    private accessToken: string | null = null;

    // login mutex
    private loginInProgress = false;
    private loginWaiters: Array<{
        resolve: () => void;
        reject: (err: any) => void;
    }> = [];

    constructor(
        private readonly email: string,
        private readonly password: string
    ) {
    }

    async setApplianceStatus(
        deviceId: string,
        properties: Record<string, any>
    ): Promise<void> {
        const data = await this.request('POST', this.appliancesUri, {
            puid: deviceId,
            properties,
        });

        if (data?.errorCode !== 0) {
            throw new Error(
                `failed to set device status: ${JSON.stringify(data)}`
            );
        }
    }

    public async getAppliances(): Promise<Map<string, ConnectLifeAppliance>> {
        const data = await this.request('GET', this.appliancesUri);

        const result = new Map<string, ConnectLifeAppliance>();
        for (const item of data) {
            if (!item.puid) {
                continue;
            }

            result.set(item.deviceNickName, {
                puid: item.puid,
                state: {
                    t_power: Number(item.statusList.t_power),
                    t_temp: Number(item.statusList.t_temp),
                    t_temp_type: Number(item.statusList.t_temp_type),
                    t_fan_speed: Number(item.statusList.t_fan_speed),
                    t_up_down: Number(item.statusList.t_up_down),
                    t_work_mode: Number(item.statusList.t_work_mode),
                    f_temp_in: Number(item.statusList.f_temp_in),
                }
            });
        }

        return result;
    }

    private async request(
        method: 'GET' | 'POST' | 'PUT' | 'DELETE',
        uri: string,
        body?: any
    ): Promise<any> {

        let lastError: any;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                await this.ensureLoggedIn();

                const response = await fetch(uri, {
                    method,
                    headers: {
                        'X-Token': this.accessToken!,
                        'User-Agent': 'connectlife-api-connector 2.1.11',
                        ...(body ? { 'Content-Type': 'application/json' } : {}),
                    },
                    body: body ? JSON.stringify(body) : undefined,
                });

                if (!response.ok) {
                    throw new Error(
                        `${method} ${uri} failed: [${response.status}] ${await response.text()}`
                    );
                }

                return await response.json();
            } catch (err) {
                lastError = err;

                if (attempt === this.maxRetries ||  this.accessToken === null) {
                    break;
                }

                await this.sleep(this.retryDelayMs);
            }
        }

        this.accessToken = null;
        throw lastError;
    }


    private async ensureLoggedIn(): Promise<void> {
        if (this.accessToken) return;

        if (this.loginInProgress) {
            return new Promise<void>((resolve, reject) => {
                this.loginWaiters.push({resolve, reject});
            });
        }

        this.loginInProgress = true;

        try {
            await this.loginWithTimeout();
            this.resolveLoginWaiters();
        } catch (err) {
            this.rejectLoginWaiters(err);
            throw err;
        } finally {
            this.loginInProgress = false;
        }
    }

    private async loginWithTimeout(): Promise<void> {
        let timeoutId: NodeJS.Timeout | undefined;

        try {
            await Promise.race([
                this.login(),
                new Promise<void>((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error('login timeout')),
                        this.loginTimeoutMs
                    );
                }),
            ]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    private resolveLoginWaiters(): void {
        for (const w of this.loginWaiters) w.resolve();
        this.loginWaiters = [];
    }

    private rejectLoginWaiters(err: any): void {
        for (const w of this.loginWaiters) w.reject(err);
        this.loginWaiters = [];
    }

    private async login(): Promise<void> {
        const apiKey = '4_yhTWQmHFpZkQZDSV1uV-_A';

        const loginParams = new URLSearchParams();
        loginParams.append('loginID', this.email);
        loginParams.append('password', this.password);
        loginParams.append('APIKey', apiKey);

        let response = await fetch(
            'https://accounts.eu1.gigya.com/accounts.login',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: loginParams.toString(),
            }
        );

        if (!response.ok) {
            throw new Error(
                `account login error: [${response.status}] ${await response.text()}`
            );
        }

        let responseBody = await response.json();
        const cookieValue = responseBody.sessionInfo?.cookieValue;
        const uid = responseBody.UID;

        if (!cookieValue || !uid) {
            throw new Error(`account login failed: ${JSON.stringify(responseBody)}`);
        }

        const jwtParams = new URLSearchParams();
        jwtParams.append('APIKey', apiKey);
        jwtParams.append('gmid', this.gmid);
        jwtParams.append('login_token', cookieValue);

        response = await fetch(
            'https://accounts.eu1.gigya.com/accounts.getJWT',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: jwtParams.toString(),
            }
        );

        if (!response.ok) {
            throw new Error(
                `get jwt error: [${response.status}] ${await response.text()}`
            );
        }

        responseBody = await response.json();
        const idToken = responseBody.id_token;

        if (!idToken) {
            throw new Error(`get jwt failed: ${JSON.stringify(responseBody)}`);
        }

        response = await fetch(
            'https://oauth.hijuconn.com/oauth/authorize',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    client_id: this.clientId,
                    idToken,
                    response_type: 'code',
                    redirect_uri:
                        'https://api.connectlife.io/swagger/oauth2-redirect.html',
                    thirdType: 'CDC',
                    thirdClientId: uid,
                }),
            }
        );

        if (!response.ok) {
            throw new Error(
                `oauth authorize error: [${response.status}] ${await response.text()}`
            );
        }

        responseBody = await response.json();
        const code = responseBody.code;

        if (!code) {
            throw new Error(
                `oauth authorize failed: ${JSON.stringify(responseBody)}`
            );
        }

        const tokenParams = new URLSearchParams({
            client_id: this.clientId,
            code,
            grant_type: 'authorization_code',
            client_secret: this.giyaClientSecret,
            redirect_uri:
                'https://api.connectlife.io/swagger/oauth2-redirect.html',
        });

        response = await fetch(
            'https://oauth.hijuconn.com/oauth/token',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: tokenParams.toString(),
            }
        );

        if (!response.ok) {
            throw new Error(
                `oauth token error: [${response.status}] ${await response.text()}`
            );
        }

        responseBody = await response.json();
        const accessToken = responseBody.access_token;

        if (!accessToken) {
            throw new Error(
                `oauth token failed: ${JSON.stringify(responseBody)}`
            );
        }

        this.accessToken = accessToken;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
