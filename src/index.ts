import { API } from 'homebridge';
import { ConnectLifeAirconPlatform } from './platform';

export = (api: API) => {
    api.registerPlatform(
        'homebridge-connectlife-aircon',
        'ConnectLifeAircon',
        ConnectLifeAirconPlatform
    );
};
