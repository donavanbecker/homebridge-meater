/* Copyright(C) 2023-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * index.ts: homebridge-meater.
 */
import { API } from 'homebridge';

import { MeaterPlatform } from './platform.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

// Register our platform with homebridge.
export default (api: API): void => {

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, MeaterPlatform);
};
