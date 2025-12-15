import 'dotenv/config';
import { ConnectLifeApi } from '../connect-life';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({
    path: path.resolve(__dirname, '../../.env')
});

async function main() {
    const email = process.env.TEST_CONNECTLIFE_EMAIL;
    const password = process.env.TEST_CONNECTLIFE_PASSWORD;

    if (!email || !password) {
        throw new Error('TEST_CONNECTLIFE_EMAIL or TEST_CONNECTLIFE_PASSWORD not defined');
    }

    const api = new ConnectLifeApi(email, password);

    let appliances = await api.getAppliances();

    const arriba = appliances.get('Arriba');
    const abajo = appliances.get('Abajo');

    if (!arriba || !abajo) {
        throw new Error('Appliance not found');
    }

    appliances = await api.getAppliances();
    console.log(appliances.get('Arriba'));

    console.log('Done');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
