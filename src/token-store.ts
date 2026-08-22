import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';

export interface ConnectLifeTokenState {
    accessToken: string | null;
    accessTokenExpiresAt: number;
    refreshToken: string | null;
    refreshTokenExpiresAt: number | null;
}

export interface ConnectLifeTokenStore {
    load(): Promise<ConnectLifeTokenState | null>;
    save(state: ConnectLifeTokenState): Promise<void>;
    clear(): Promise<void>;
}

export class FileConnectLifeTokenStore implements ConnectLifeTokenStore {
    constructor(private readonly filePath: string) {}

    async load(): Promise<ConnectLifeTokenState | null> {
        let contents: string;

        try {
            contents = await readFile(this.filePath, 'utf8');
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw err;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(contents);
        } catch {
            await this.quarantineInvalidCache();
            return null;
        }

        if (!this.isTokenState(parsed)) {
            await this.quarantineInvalidCache();
            return null;
        }

        return parsed;
    }

    async save(state: ConnectLifeTokenState): Promise<void> {
        await mkdir(path.dirname(this.filePath), {recursive: true});

        const temporaryPath = `${this.filePath}.tmp`;
        await writeFile(
            temporaryPath,
            `${JSON.stringify(state)}\n`,
            {encoding: 'utf8', mode: 0o600},
        );
        await rename(temporaryPath, this.filePath);
    }

    async clear(): Promise<void> {
        try {
            await unlink(this.filePath);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
            }
        }
    }

    private isTokenState(value: any): value is ConnectLifeTokenState {
        return value !== null &&
            typeof value === 'object' &&
            (typeof value.accessToken === 'string' || value.accessToken === null) &&
            typeof value.accessTokenExpiresAt === 'number' &&
            Number.isFinite(value.accessTokenExpiresAt) &&
            (typeof value.refreshToken === 'string' || value.refreshToken === null) &&
            (value.refreshTokenExpiresAt === null || (
                typeof value.refreshTokenExpiresAt === 'number' &&
                Number.isFinite(value.refreshTokenExpiresAt)
            ));
    }

    private async quarantineInvalidCache(): Promise<void> {
        const quarantinePath = `${this.filePath}.corrupt-${Date.now()}`;
        await rename(this.filePath, quarantinePath);
    }
}
