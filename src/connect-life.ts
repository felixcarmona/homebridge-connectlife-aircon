import {ConnectLifeApplianceState} from "./appliance-state";
import {
    buildGatewayRequest,
    CONNECT_LIFE_DEVICE_LIST_URL,
    CONNECT_LIFE_UPDATE_URL,
    GatewayRequest,
} from './connect-life-gateway';
import {
    ConnectLifeTokenState,
    ConnectLifeTokenStore,
} from './token-store';
import {CONNECT_LIFE_AUTH} from './connect-life-auth';

export interface ConnectLifeAppliance {
    puid: string;
    online: boolean;
    state: Partial<ConnectLifeApplianceState>;
}

class ConnectLifeGatewayError extends Error {
    constructor(
        public readonly code: number | string | undefined,
        description: string,
        operation: string,
    ) {
        super(
            `ConnectLife gateway error while ${operation}: ` +
            `code=${code ?? 'unknown'} description=${description}`,
        );
    }
}

class ConnectLifeAuthHttpError extends Error {
    constructor(
        public readonly status: number,
        operation: string,
        details: string,
    ) {
        super(`${operation}: [${status}] ${details}`);
    }
}

export class ConnectLifeApi {
    private readonly userAgent = 'homebridge-connectlife-aircon';
    private readonly loginTimeoutMs: number;
    private readonly tokenRenewalMarginMs = 90_000;
    private accessToken: string | null = null;
    private accessTokenExpiresAt = 0;
    private refreshToken: string | null = null;
    private refreshTokenExpiresAt: number | null = null;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private readonly tokenStore?: ConnectLifeTokenStore;
    private tokenStateLoaded: Promise<void> | null = null;
    private authenticationPromise: Promise<void> | null = null;

    constructor(
        private readonly email: string,
        private readonly password: string,
        options: {
            fetch?: typeof fetch;
            accessToken?: string;
            now?: () => number;
            tokenStore?: ConnectLifeTokenStore;
            authenticationTimeoutMs?: number;
        } = {},
    ) {
        this.fetchImpl = options.fetch ?? fetch;
        this.now = options.now ?? Date.now;
        this.tokenStore = options.tokenStore;
        this.loginTimeoutMs = options.authenticationTimeoutMs ?? 15_000;
        this.accessToken = options.accessToken ?? null;
        // An injected token is used by unit tests and is valid until replaced.
        this.accessTokenExpiresAt = options.accessToken
            ? Number.POSITIVE_INFINITY
            : 0;
    }

    async setApplianceStatus(
        deviceId: string,
        properties: Record<string, any>
    ): Promise<void> {
        await this.executeGatewayOperation(async () => {
            await this.updateGatewayAppliance(deviceId, properties);
        });
    }

    private async updateGatewayAppliance(
        deviceId: string,
        properties: Record<string, any>,
    ): Promise<void> {
        const requestData = buildGatewayRequest(this.accessToken!, {
            puid: deviceId,
            properties,
        });

        const response = await this.fetchWithTimeout(CONNECT_LIFE_UPDATE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': this.userAgent,
            },
            body: JSON.stringify(requestData),
        });

        if (!response.ok) {
            const details = await this.safeResponseDetails(response);
            throw new Error(
                `ConnectLife gateway update HTTP error: [${response.status}] ${details}`,
            );
        }

        const body = await response.json();
        this.validateGatewayResponse(body, 'updating appliance');
    }

    public async getAppliances(): Promise<Map<string, ConnectLifeAppliance>> {
        const data = await this.executeGatewayOperation(
            () => this.getGatewayDeviceList(),
        );

        const result = new Map<string, ConnectLifeAppliance>();
        for (const item of data) {
            if (!item?.puid || !item.deviceNickName || !item.statusList) {
                continue;
            }

            const state: Partial<ConnectLifeApplianceState> = {};
            const stateKeys: (keyof ConnectLifeApplianceState)[] = [
                't_power',
                't_temp',
                't_temp_type',
                't_fan_speed',
                't_up_down',
                't_work_mode',
                'f_temp_in',
            ];
            for (const key of stateKeys) {
                const rawValue = item.statusList[key];
                if (rawValue === undefined || rawValue === null || rawValue === '') {
                    continue;
                }
                const value = Number(rawValue);
                if (Number.isFinite(value)) {
                    state[key] = value;
                }
            }

            result.set(item.deviceNickName, {
                puid: item.puid,
                online: item.offlineState === undefined
                    ? true
                    : Number(item.offlineState) !== 0,
                state,
            });
        }

        return result;
    }

    private async getGatewayDeviceList(): Promise<any[]> {
        const requestData = buildGatewayRequest(this.accessToken!);
        const query = this.gatewayQueryString(requestData);
        const uri = `${CONNECT_LIFE_DEVICE_LIST_URL}?${query}`;

        const response = await this.fetchWithTimeout(uri, {
            method: 'GET',
            headers: {
                'User-Agent': this.userAgent,
            },
        });

        if (!response.ok) {
            const details = await this.safeResponseDetails(response);
            throw new Error(
                `ConnectLife gateway list HTTP error: [${response.status}] ${details}`,
            );
        }

        const body = await response.json();
        const gatewayResponse = this.validateGatewayResponse(
            body,
            'getting appliance list',
        );

        if (!Array.isArray(gatewayResponse.deviceList)) {
            throw new Error(
                'Invalid ConnectLife gateway response: missing deviceList',
            );
        }

        return gatewayResponse.deviceList;
    }

    private validateGatewayResponse(
        body: any,
        operation: string,
    ): Record<string, any> {
        const gatewayResponse = body?.response;

        if (!gatewayResponse || typeof gatewayResponse !== 'object') {
            throw new Error(
                `Invalid ConnectLife gateway response while ${operation}: missing response envelope`,
            );
        }

        if (![0, '0', undefined, null].includes(gatewayResponse.resultCode)) {
            throw new ConnectLifeGatewayError(
                gatewayResponse.errorCode ?? gatewayResponse.resultCode,
                gatewayResponse.errorDesc ?? 'unknown error',
                operation,
            );
        }

        return gatewayResponse;
    }

    private gatewayQueryString(request: GatewayRequest): string {
        const query = new URLSearchParams();

        for (const [key, value] of Object.entries(request)) {
            query.set(
                key,
                value !== null && typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value),
            );
        }

        return query.toString();
    }

    private async executeGatewayOperation<T>(
        operation: () => Promise<T>,
    ): Promise<T> {
        await this.ensureLoggedIn();

        try {
            return await operation();
        } catch (err) {
            if (!(err instanceof ConnectLifeGatewayError)) {
                throw err;
            }

            if (Number(err.code) === 100026) {
                await this.invalidateAccessToken();
                await this.ensureLoggedIn();
                return operation();
            }

            if (Number(err.code) === 101005) {
                // Rebuilding the request creates a fresh randStr and signature.
                return operation();
            }

            throw err;
        }
    }

    private async ensureLoggedIn(): Promise<void> {
        await this.loadTokenState();

        if (this.hasValidAccessToken()) {
            return;
        }

        if (!this.authenticationPromise) {
            this.authenticationPromise = this.authenticateWithTimeout()
                .finally(() => {
                    this.authenticationPromise = null;
                });
        }

        return this.authenticationPromise;
    }

    private hasValidAccessToken(): boolean {
        return this.accessToken !== null && this.now() < this.accessTokenExpiresAt;
    }

    private hasUsableRefreshToken(): boolean {
        return this.refreshToken !== null && (
            this.refreshTokenExpiresAt === null ||
            this.now() < this.refreshTokenExpiresAt
        );
    }

    private async authenticateWithTimeout(): Promise<void> {
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            this.loginTimeoutMs,
        );

        try {
            if (this.hasUsableRefreshToken()) {
                try {
                    await this.refreshAccessToken(controller.signal);
                    return;
                } catch (err) {
                    if (!(err instanceof ConnectLifeAuthHttpError) ||
                        err.status < 400 || err.status >= 500) {
                        throw err;
                    }
                    await this.clearTokens();
                }
            }

            await this.login(controller.signal);
        } catch (err) {
            if (controller.signal.aborted) {
                throw new Error('ConnectLife authentication timeout');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async login(signal: AbortSignal): Promise<void> {
        const apiKey = CONNECT_LIFE_AUTH.gigyaApiKey;

        const loginParams = new URLSearchParams();
        loginParams.append('loginID', this.email);
        loginParams.append('password', this.password);
        loginParams.append('APIKey', apiKey);

        let response = await this.fetchImpl(
            CONNECT_LIFE_AUTH.gigyaLoginUrl,
            {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: loginParams.toString(),
                signal,
            }
        );

        if (!response.ok) {
            const details = await this.safeResponseDetails(response);
            throw new Error(
                `Gigya account login HTTP error: [${response.status}] ${details}`,
            );
        }

        let responseBody = await response.json();
        const cookieValue = responseBody.sessionInfo?.cookieValue;
        const uid = responseBody.UID;

        if (!cookieValue || !uid) {
            throw new Error(
                `Gigya account login failed: ${this.safeJsonErrorDetails(responseBody)}`,
            );
        }

        const jwtParams = new URLSearchParams();
        jwtParams.append('APIKey', apiKey);
        jwtParams.append('gmid', CONNECT_LIFE_AUTH.gmid);
        jwtParams.append('login_token', cookieValue);

        response = await this.fetchImpl(
            CONNECT_LIFE_AUTH.gigyaJwtUrl,
            {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: jwtParams.toString(),
                signal,
            }
        );

        if (!response.ok) {
            const details = await this.safeResponseDetails(response);
            throw new Error(
                `Gigya getJWT HTTP error: [${response.status}] ${details}`,
            );
        }

        responseBody = await response.json();
        const idToken = responseBody.id_token;

        if (!idToken) {
            throw new Error(
                `Gigya getJWT failed: ${this.safeJsonErrorDetails(responseBody)}`,
            );
        }

        response = await this.fetchImpl(
            CONNECT_LIFE_AUTH.authorizeUrl,
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    client_id: CONNECT_LIFE_AUTH.clientId,
                    idToken,
                    response_type: 'code',
                    redirect_uri: CONNECT_LIFE_AUTH.redirectUri,
                    thirdType: 'CDC',
                    thirdClientId: uid,
                }),
                signal,
            }
        );

        if (!response.ok) {
            const details = await this.safeResponseDetails(response);
            throw new Error(
                `ConnectLife OAuth authorize HTTP error: [${response.status}] ${details}`,
            );
        }

        responseBody = await response.json();
        const code = responseBody.code;

        if (!code) {
            throw new Error(
                `ConnectLife OAuth authorize failed: ${this.safeJsonErrorDetails(responseBody)}`,
            );
        }

        const tokenParams = new URLSearchParams({
            client_id: CONNECT_LIFE_AUTH.clientId,
            code,
            grant_type: 'authorization_code',
            client_secret: CONNECT_LIFE_AUTH.gigyaClientSecret,
            redirect_uri: CONNECT_LIFE_AUTH.redirectUri,
        });

        response = await this.fetchImpl(
            CONNECT_LIFE_AUTH.tokenUrl,
            {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: tokenParams.toString(),
                signal,
            }
        );

        if (!response.ok) {
            const details = await this.safeResponseDetails(response);
            throw new Error(
                `ConnectLife OAuth token HTTP error: [${response.status}] ${details}`,
            );
        }

        responseBody = await response.json();
        await this.updateTokenState(responseBody);
    }

    private async refreshAccessToken(signal: AbortSignal): Promise<void> {
        const tokenParams = new URLSearchParams({
            client_id: CONNECT_LIFE_AUTH.clientId,
            client_secret: CONNECT_LIFE_AUTH.gigyaClientSecret,
            redirect_uri: CONNECT_LIFE_AUTH.redirectUri,
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken!,
        });

        const response = await this.fetchImpl(
            CONNECT_LIFE_AUTH.tokenUrl,
            {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: tokenParams.toString(),
                signal,
            },
        );

        if (!response.ok) {
            const details = await this.safeResponseDetails(response);
            throw new ConnectLifeAuthHttpError(
                response.status,
                'oauth refresh error',
                details,
            );
        }

        await this.updateTokenState(await response.json());
    }

    private async updateTokenState(responseBody: any): Promise<void> {
        const accessToken = responseBody?.access_token;
        const expiresIn = Number(responseBody?.expires_in);

        if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
            throw new Error('oauth token response missing access_token or expires_in');
        }

        this.accessToken = accessToken;
        this.accessTokenExpiresAt = this.now() + Math.max(
            1_000,
            expiresIn * 1_000 - this.tokenRenewalMarginMs,
        );

        if (responseBody.refresh_token) {
            this.refreshToken = responseBody.refresh_token;
        }

        if (responseBody.refreshTokenExpiredTime !== undefined) {
            this.refreshTokenExpiresAt = this.parseTokenExpiry(
                responseBody.refreshTokenExpiredTime,
            );
        }

        await this.persistTokenState();
    }

    private parseTokenExpiry(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === 'string') {
            if (/^\d+$/.test(value)) {
                return Number(value);
            }

            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? null : parsed;
        }

        return null;
    }

    private async clearTokens(): Promise<void> {
        this.accessToken = null;
        this.accessTokenExpiresAt = 0;
        this.refreshToken = null;
        this.refreshTokenExpiresAt = null;
        await this.tokenStore?.clear();
    }

    private async invalidateAccessToken(): Promise<void> {
        this.accessToken = null;
        this.accessTokenExpiresAt = 0;
        await this.persistTokenState();
    }

    private async loadTokenState(): Promise<void> {
        if (!this.tokenStore) {
            return;
        }

        if (!this.tokenStateLoaded) {
            this.tokenStateLoaded = this.tokenStore.load().then((state) => {
                if (!state) {
                    return;
                }

                this.accessToken = state.accessToken;
                this.accessTokenExpiresAt = state.accessTokenExpiresAt;
                this.refreshToken = state.refreshToken;
                this.refreshTokenExpiresAt = state.refreshTokenExpiresAt;
            });
        }

        return this.tokenStateLoaded;
    }

    private async persistTokenState(): Promise<void> {
        if (!this.tokenStore) {
            return;
        }

        const state: ConnectLifeTokenState = {
            accessToken: this.accessToken,
            accessTokenExpiresAt: this.accessTokenExpiresAt,
            refreshToken: this.refreshToken,
            refreshTokenExpiresAt: this.refreshTokenExpiresAt,
        };
        await this.tokenStore.save(state);
    }

    private async fetchWithTimeout(
        input: string | URL,
        init: RequestInit,
        timeoutMs = 30_000,
    ): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await this.fetchImpl(input, {
                ...init,
                signal: controller.signal,
            });
        } catch (err) {
            if (controller.signal.aborted) {
                throw new Error(`ConnectLife request timeout after ${timeoutMs}ms`);
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async safeResponseDetails(response: Response): Promise<string> {
        let text: string;
        try {
            text = await response.text();
        } catch {
            return 'response body unavailable';
        }

        try {
            return this.safeJsonErrorDetails(JSON.parse(text));
        } catch {
            return 'non-JSON response';
        }
    }

    private safeJsonErrorDetails(body: any): string {
        const code = body?.errorCode ?? body?.statusCode ?? body?.resultCode;
        const message = body?.errorMessage ?? body?.errorDetails ??
            body?.errorDesc ?? body?.statusReason ?? body?.message;

        const parts: string[] = [];
        if (code !== undefined && code !== null) {
            parts.push(`code=${String(code).slice(0, 40)}`);
        }
        if (typeof message === 'string' && message.length > 0) {
            parts.push(`message=${message.replace(/\s+/g, ' ').slice(0, 160)}`);
        }

        return parts.length > 0 ? parts.join(' ') : 'remote service rejected request';
    }

}
