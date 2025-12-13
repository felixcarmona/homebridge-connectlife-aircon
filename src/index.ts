import { API } from 'homebridge';
import { ConnectLifeHVACPlatform } from './platform';

/**
 * This method is called by Homebridge when the plugin is loaded.
 */
export = (api: API) => {
    api.registerPlatform(
        'ConnectLifeHVAC',
        ConnectLifeHVACPlatform,
    );
};