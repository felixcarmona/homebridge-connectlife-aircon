import 'dotenv/config';
import { ConnectLifeApi } from '../connect-life';
import path from 'path';
import dotenv from 'dotenv';
import {FileConnectLifeTokenStore} from '../token-store';

dotenv.config({
    path: path.resolve(__dirname, '../../.env')
});

async function main() {
    const email = process.env.TEST_CONNECTLIFE_EMAIL;
    const password = process.env.TEST_CONNECTLIFE_PASSWORD;

    if (!email || !password) {
        throw new Error('TEST_CONNECTLIFE_EMAIL or TEST_CONNECTLIFE_PASSWORD not defined');
    }

    const api = new ConnectLifeApi(email, password, {
        tokenStore: new FileConnectLifeTokenStore(
            path.resolve(__dirname, '../../.connectlife-token-cache.json'),
        ),
    });
    const appliances = await api.getAppliances();

    console.log(`ConnectLife gateway responded successfully.`);
    console.log(`Appliances found: ${appliances.size}`);
    console.log(`Names: ${[...appliances.keys()].join(', ') || '(none)'}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
