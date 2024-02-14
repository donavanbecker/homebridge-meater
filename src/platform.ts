/* Copyright(C) 2023-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.ts: homebridge-meater.
 */
import { API, DynamicPlatformPlugin, HAP, Logging, PlatformAccessory } from 'homebridge';
import { readFileSync, writeFileSync } from 'fs';
import { request } from 'undici';

import { Meater } from './device/meater.js';
import { PLATFORM_NAME, PLUGIN_NAME, MeaterPlatformConfig, meaterUrlLogin, meaterUrl, device, devicesConfig } from './settings.js';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class MeaterPlatform implements DynamicPlatformPlugin {
  public accessories: PlatformAccessory[];
  public readonly api: API;
  public readonly log: Logging;
  protected readonly hap: HAP;
  public config!: MeaterPlatformConfig;

  platformConfig!: MeaterPlatformConfig['options'];
  platformLogging!: MeaterPlatformConfig['logging'];
  debugMode!: boolean;

  constructor(
    log: Logging,
    config: MeaterPlatformConfig,
    api: API,
  ) {
    this.accessories = [];
    this.api = api;
    this.hap = this.api.hap;
    this.log = log;
    // only load if configured
    if (!config) {
      return;
    }

    // Plugin options into our config variables.
    this.config = {
      platform: 'Meater',
      credentials: config.credentials,
      options: config.options,
    };
    this.platformConfigOptions();
    this.platformLogs();
    this.debugLog(`Finished initializing platform: ${config.name}`);

    // verify the config
    (async () => {
      try {
        await this.verifyConfig();
        this.debugLog('Config OK');
      } catch (e: any) {
        this.errorLog(`Verify Config, Error Message: ${e.message}, Submit Bugs Here: https://bit.ly/homebridge-meater-bug-report`);
        this.debugErrorLog(`Verify Config, Error: ${e}`);
        return;
      }
    })();

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      this.debugLog('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      try {
        await this.discoverDevices();
      } catch (e: any) {
        this.errorLog(`Failed to Discover, Error Message: ${e.message}, Submit Bugs Here: ` + 'https://bit.ly/homebridge-meater-bug-report');
        this.debugErrorLog(`Failed to Discover, Error: ${e}`);
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.debugLog(`Loading accessory from cache: ${accessory.displayName}`);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  async verifyConfig() {
    if (!this.config.credentials?.email) {
      throw new Error('Email not provided');
    }
    if (!this.config.credentials?.password) {
      throw new Error('Password not provided');
    }
  }

  /**
   * The openToken was old config.
   * This method saves the openToken as the token in the config.json file
   * @param this.config.credentials.token
   */
  async updateToken(login: { data: { token: any; }; }) {
    try {
      // check the new token was provided
      if (!this.config.credentials?.token) {
        throw new Error('New token not provided');
      }

      // load in the current config
      const currentConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'));

      // check the platforms section is an array before we do array things on it
      if (!Array.isArray(currentConfig.platforms)) {
        throw new Error('Cannot find platforms array in config');
      }

      // find this plugins current config
      const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME);

      if (!pluginConfig) {
        throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`);
      }

      // check the .credentials is an object before doing object things with it
      if (typeof pluginConfig.credentials !== 'object') {
        throw new Error('pluginConfig.credentials is not an object');
      }

      // set the refresh token
      pluginConfig.credentials.token = login.data.token;

      this.debugWarnLog(`token: ${pluginConfig.credentials.token}`);

      // save the config, ensuring we maintain pretty json
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));
      this.verifyConfig();
    } catch (e: any) {
      this.errorLog(`Update Token: ${e}`);
    }
  }

  /**
   * this method discovers devices
   */
  async discoverDevices() {
    try {
      if (this.config.credentials?.token) {
        const { body, statusCode } = await request(meaterUrl, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer ' + this.config.credentials.token,
          },
        });
        this.debugLog(`Device statusCode: ${statusCode}`);
        const device: any = await body.json();
        this.debugLog(`Device: ${JSON.stringify(device)}`);
        this.debugLog(`Device StatusCode: ${device.statusCode}`);
        if (statusCode === 200 && device.statusCode === 200) {
          this.infoLog (`Found ${device.data.devices.length} Devices`);
          const deviceLists = device.data.devices;
          await this.configureDevices(deviceLists);
          // Meater Devices
          /*device.data.devices.forEach((device: device & deviceConfig) => {
            this.createMeter(device);
          });*/
        } else {
          this.statusCode(statusCode);
          this.statusCode(device.statusCode);
        }
      } else {
        const payload = JSON.stringify({
          email: this.config.credentials?.email,
          password: this.config.credentials?.password,
        });
        const { body, statusCode } = await request(meaterUrlLogin, {
          body: payload,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        });
        this.debugLog(`statusCode: ${statusCode}`);
        const login: any = await body.json();
        this.debugLog(`Login: ${JSON.stringify(login)}`);
        this.debugLog(`Login Token: ${JSON.stringify(login.data.token)}`);
        this.debugLog(`Login StatusCode: ${login.statusCode}`);
        await this.updateToken(login);
        this.debugLog(`statusCode: ${statusCode} & devicesAPI StatusCode: ${login.statusCode}`);
        if (statusCode === 200 && login.statusCode === 200) {
          const { body, statusCode } = await request(meaterUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${login.data.token}}`,
            },
          });
          this.debugLog(`Device statusCode: ${statusCode}`);
          const device: any = await body.json();
          this.debugLog(`Device: ${JSON.stringify(device)}`);
          this.debugLog(`Device StatusCode: ${device.statusCode}`);
          if (statusCode === 200 && device.statusCode === 200) {
            this.infoLog (`Found ${device.data.devices.length} Devices`);
            const deviceLists = device.data.devices;
            await this.configureDevices(deviceLists);
            // Meater Devices
            /*device.data.devices.forEach((device: device & deviceConfig) => {
              this.createMeter(device);
            });*/
          } else {
            this.statusCode(statusCode);
            this.statusCode(device.statusCode);
          }
        }
      }
    } catch (e: any) {
      this.errorLog(
        `Failed to Discover Devices, Error Message: ${JSON.stringify(e.message)}, Submit Bugs Here: ` + 'https://bit.ly/homebridge-meater-bug-report',
      );
      this.errorLog(`Failed to Discover Devices, Error: ${e}`);
    }
  }

  private async configureDevices(deviceLists: any) {
    if (!this.config.options?.devices) {
      this.debugLog(`No Meater Device Config: ${JSON.stringify(this.config.options?.devices)}`);
      const devices = deviceLists.map((v: any) => v);
      for (const device of devices) {
        await this.createMeter(device);
      }
    } else {
      this.debugLog(`Meater Device Config Set: ${JSON.stringify(this.config.options?.devices)}`);
      const deviceConfigs = this.config.options?.devices;

      const mergeByid = (a1: { id: string; }[], a2: any[]) => a1.map((itm: { id: string; }) => ({
        ...a2.find((item: { id: string; }) => item.id === itm.id && item),
        ...itm,
      }));

      const devices = mergeByid(deviceLists, deviceConfigs);
      this.debugLog(`Resideo Devices: ${JSON.stringify(devices)}`);
      for (const device of devices) {
        await this.createMeter(device);
      }
    }
  }

  private async createMeter(device: device & devicesConfig) {
    const uuid = this.api.hap.uuid.generate(device.id);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (await this.registerDevice(device)) {
        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device.id = device.id;
        existingAccessory.context.FirmwareRevision = await this.FirmwareRevision(device);
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName} DeviceID: ${device.id}`);
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new Meater(this, existingAccessory, device);
        this.debugLog(`uuid: ${device.id}, (${existingAccessory.UUID})`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (await this.registerDevice(device)) {
      // the accessory does not yet exist, so we need to create it
      if (!device.external) {
        this.infoLog(`Adding new accessory, DeviceID: ${device.id}`);
      }

      // create a new accessory
      const accessory = new this.api.platformAccessory(`Meater Thermometer (${device.id.slice(0, 4)})`, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.device.id = device.id;
      accessory.context.FirmwareRevision = await this.FirmwareRevision(device);
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new Meater(this, accessory, device);
      this.debugLog(`uuid: ${device.id}, (${accessory.UUID})`);

      // publish device externally or link the accessory to your platform
      this.externalOrPlatform(device, accessory);
      this.accessories.push(accessory);
    } else {
      this.debugLog(`Device not registered, DeviceID: ${device.id}`);
    }
  }

  async FirmwareRevision(device: device & devicesConfig): Promise<any> {
    let firmware: any;
    if (device.firmware) {
      firmware = device.firmware;
    } else {
      firmware = await this.getVersion();
    }
    return firmware;
  }

  async registerDevice(device: device & devicesConfig): Promise<boolean> {
    let registerDevice: boolean;
    if (!device.hide_device) {
      registerDevice = true;
    } else {
      registerDevice = false;
      this.errorLog(
        `DeviceID: ${device.id} will not display in HomeKit, hide_device: ${device.hide_device}`,
      );
    }
    return registerDevice;
  }

  public async externalOrPlatform(device: device & devicesConfig, accessory: PlatformAccessory) {
    if (device.external) {
      this.warnLog(`${accessory.displayName} External Accessory Mode`);
      this.externalAccessory(accessory);
    } else {
      this.debugLog(`${accessory.displayName} External Accessory Mode: ${device.external}`);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  public async externalAccessory(accessory: PlatformAccessory) {
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.warnLog(`Removing existing accessory from cache: ${existingAccessory.displayName}`);
  }

  async statusCode(statusCode: number): Promise<void> {
    switch (statusCode) {
      case 200:
        this.debugLog(`Standard Response, statusCode: ${statusCode}`);
        break;
      case 400:
        this.errorLog(`Bad Request, statusCode: ${statusCode}`);
        break;
      case 401:
        this.errorLog(`Unauthorized, statusCode: ${statusCode}`);
        break;
      case 404:
        this.errorLog(`Not Found, statusCode: ${statusCode}`);
        break;
      case 429:
        this.errorLog(`Too Many Requests, statusCode: ${statusCode}`);
        break;
      case 500:
        this.errorLog(`Internal Server Error (Meater Server), statusCode: ${statusCode}`);
        break;
      default:
        this.infoLog(`Unknown statusCode: ${statusCode}, Report Bugs Here: https://bit.ly/homebridge-meater-bug-report`);
    }
  }

  async platformConfigOptions() {
    const platformConfig: MeaterPlatformConfig['options'] = {
    };
    if (this.config.options?.logging) {
      platformConfig.logging = this.config.options?.logging;
    }
    if (this.config.options?.refreshRate) {
      platformConfig.refreshRate = this.config.options?.refreshRate;
    }
    if (Object.entries(platformConfig).length !== 0) {
      this.debugLog(`Platform Config: ${JSON.stringify(platformConfig)}`);
    }
    this.platformConfig = platformConfig;
  }

  async platformLogs() {
    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
    this.platformLogging = this.config.options?.logging ?? 'standard';
    if (this.config.options?.logging === 'debug' || this.config.options?.logging === 'standard' || this.config.options?.logging === 'none') {
      this.platformLogging = this.config.options.logging;
      if (this.platformLogging?.includes('debug')) {
        this.debugWarnLog(`Using Config Logging: ${this.platformLogging}`);
      }
    } else if (this.debugMode) {
      this.platformLogging = 'debugMode';
      if (this.platformLogging?.includes('debug')) {
        this.debugWarnLog(`Using ${this.platformLogging} Logging`);
      }
    } else {
      this.platformLogging = 'standard';
      if (this.platformLogging?.includes('debug')) {
        this.debugWarnLog(`Using ${this.platformLogging} Logging`);
      }
    }
    if (this.debugMode) {
      this.platformLogging = 'debugMode';
    }
  }

  async getVersion() {
    const json = JSON.parse(
      readFileSync(
        new URL('../package.json', import.meta.url),
        'utf-8',
      ),
    );
    this.debugLog(`Plugin Version: ${json.version}`);
    return json.version;
  }

  /**
   * If device level logging is turned on, log to log.warn
   * Otherwise send debug logs to log.debug
   */
  infoLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.info(String(...log));
    }
  }

  warnLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.warn(String(...log));
    }
  }

  debugWarnLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.error(String(...log));
    }
  }

  debugErrorLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log));
      } else if (this.platformLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log));
      }
    }
  }

  enablingPlatfromLogging(): boolean {
    return this.platformLogging?.includes('debug') || this.platformLogging === 'standard';
  }
}
