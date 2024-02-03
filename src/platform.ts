/* Copyright(C) 2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * protect-platform.ts: homebridge-meater platform class.
 */
import { API, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, MeaterPlatformConfig, meaterUrlLogin, meaterUrl, device, deviceConfig } from './settings.js';
import { request } from 'undici';
import { Meater } from './device/meater.js';
import { readFileSync, writeFileSync } from 'fs';
import util from 'node:util';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class MeaterPlatform implements DynamicPlatformPlugin {
  public accessories: PlatformAccessory[];
  public readonly api: API;
  public readonly log: Logging;
  public config!: MeaterPlatformConfig;

  public platformLogging!: string;
  public debugMode!: boolean;

  constructor(
    log: Logging,
    config: MeaterPlatformConfig,
    api: API,
  ) {
    this.accessories = [];
    this.api = api;
    this.log = log;
    //this.log.info = this.info.bind(this);
    //this.log.warn = this.warn.bind(this) || this.debugWarn.bind(this);
    //this.log.error = this.error.bind(this) || this.debugError.bind(this);
    //this.log.debug = this.debug.bind(this);
    // only load if configured
    if (!config) {
      return;
    }

    // Plugin options into our config variables.
    this.config = {
      platform: 'MeaterPlatform',
      email: config.email as string,
      password: config.password as string,
      token: config.token as string,
      logging: config.logging as string,
    };
    this.logType();
    this.info((`Finished initializing platform: ${config.name}`));

    this.debug('Debug logging on. Expect a lot of data.');
    // verify the config
    try {
      this.verifyConfig();
      this.log.debug('Config OK');
    } catch (e: any) {
      this.log.error(`Verify Config, Error Message: ${e.message}, Submit Bugs Here: ` + 'https://bit.ly/homebridge-meater-bug-report');
      this.log.error(`Verify Config, Error: ${e}`);
      return;
    }

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      this.log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      try {
        this.discoverDevices();
      } catch (e: any) {
        this.log.error(`Failed to Discover, Error Message: ${e.message}, Submit Bugs Here: ` + 'https://bit.ly/homebridge-meater-bug-report');
        this.log.error(`Failed to Discover, Error: ${e}`);
      }
    });
  }

  logType() {
    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
    if (this.config.logging === 'debug' || this.config.logging === 'standard' || this.config.logging === 'none') {
      this.platformLogging = this.config.options!.logging;
      this.log.warn(`Using Config Logging: ${this.platformLogging}`);
    } else if (this.debugMode) {
      this.platformLogging = 'debugMode';
      this.log.warn(`Using ${this.platformLogging} Logging`);
    } else {
      this.platformLogging = 'standard';
      this.log.warn(`Using ${this.platformLogging} Logging`);
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug(`Loading accessory from cache: ${accessory.displayName}`);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  async verifyConfig() {
    if (!this.config.email) {
      throw new Error('Email not provided');
    }
    if (!this.config.password) {
      throw new Error('Password not provided');
    }
  }

  /**
   * The openToken was old config.
   * This method saves the openToken as the token in the config.json file
   * @param this.config.credentials.openToken
   */
  async updateToken() {
    try {
      // check the new token was provided
      if (!this.config.token) {
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

      // set the refresh token
      pluginConfig.token = this.config.token;

      this.log.warn(`token: ${pluginConfig.token}`);

      // save the config, ensuring we maintain pretty json
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));
      this.verifyConfig();
    } catch (e: any) {
      this.log.error(`Update Token: ${e}`);
    }
  }

  /**
   * this method discovers devices
   */
  async discoverDevices() {
    try {
      if (this.config.token) {
        const { body, statusCode, headers } = await request(meaterUrl, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer ' + this.config.token,
          },
        });
        this.log.info(`Device body: ${JSON.stringify(body)}`);
        this.log.info(`Device statusCode: ${statusCode}`);
        this.log.info(`Device headers: ${JSON.stringify(headers)}`);
        const device: any = await body.json();
        this.log.info(`Device: ${JSON.stringify(device)}`);
        this.log.info(`Device StatusCode: ${device.statusCode}`);
        if (statusCode === 200 && device.statusCode === 200) {
          this.log.info (`Found ${device.data.devices.length} Devices`);
          // Meater Devices
          device.data.devices.forEach((device: device & deviceConfig) => {
            this.createMeter(device);
          });
        } else {
          this.statusCode(statusCode);
          this.statusCode(device.statusCode);
        }
      } else {
        const payload = JSON.stringify({
          email: this.config.email,
          password: this.config.password,
        });
        const { body, statusCode, headers } = await request(meaterUrlLogin, {
          body: payload,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        });
        this.log.debug(`body: ${JSON.stringify(body)}`);
        this.log.debug(`statusCode: ${statusCode}`);
        this.log.debug(`headers: ${JSON.stringify(headers)}`);
        const login: any = await body.json();
        this.log.debug(`Login: ${JSON.stringify(login)}`);
        this.log.debug(`Login Token: ${JSON.stringify(login.data.token)}`);
        this.log.debug(`Login StatusCode: ${login.statusCode}`);
        this.config.token = login.data.token;
        await this.updateToken();
        this.log.debug(`statusCode: ${statusCode} & devicesAPI StatusCode: ${login.statusCode}`);
        if (statusCode === 200 && login.statusCode === 200) {
          const { body, statusCode, headers } = await request(meaterUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${login.data.token}}`,
            },
          });
          this.log.debug(`Device body: ${JSON.stringify(body)}`);
          this.log.debug(`Device statusCode: ${statusCode}`);
          this.log.debug(`Device headers: ${JSON.stringify(headers)}`);
          const device: any = await body.json();
          this.log.debug(`Device: ${JSON.stringify(device)}`);
          this.log.debug(`Device StatusCode: ${device.statusCode}`);
          if (statusCode === 200 && device.statusCode === 200) {
            this.log.info (`Found ${device.data.devices.length} Devices`);
            // Meater Devices
            device.data.devices.forEach((device: device & deviceConfig) => {
              this.createMeter(device);
            });
          } else {
            this.statusCode(statusCode);
            this.statusCode(device.statusCode);
          }
        }
      }
    } catch (e: any) {
      this.log.error(
        `Failed to Discover Devices, Error Message: ${JSON.stringify(e.message)}, Submit Bugs Here: ` + 'https://bit.ly/homebridge-meater-bug-report',
      );
      this.log.error(`Failed to Discover Devices, Error: ${e}`);
    }
  }

  private async createMeter(device: device & deviceConfig) {
    const uuid = this.api.hap.uuid.generate(device.id);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (await this.registerDevice(device)) {
        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device.id = device.id;
        this.log.info(`Restoring existing accessory from cache: ${existingAccessory.displayName} DeviceID: ${device.id}`);
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new Meater(this, existingAccessory, device);
        this.log.debug(`uuid: ${device.id}, (${existingAccessory.UUID})`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (await this.registerDevice(device)) {
      // the accessory does not yet exist, so we need to create it
      if (!device.external) {
        this.log.info(`Adding new accessory, DeviceID: ${device.id}`);
      }

      // create a new accessory
      const accessory = new this.api.platformAccessory(`Meater Thermometer (${device.id.slice(0, 4)})`, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.device.id = device.id;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new Meater(this, accessory, device);
      this.log.debug(`uuid: ${device.id}, (${accessory.UUID})`);

      // publish device externally or link the accessory to your platform
      this.externalOrPlatform(device, accessory);
      this.accessories.push(accessory);
    } else {
      this.log.debug(`Device not registered, DeviceID: ${device.id}`);
    }
  }

  async registerDevice(device: device & deviceConfig): Promise<boolean> {
    let registerDevice: boolean;
    if (!device.hide_device) {
      registerDevice = true;
    } else {
      registerDevice = false;
      this.log.error(
        `DeviceID: ${device.id} will not display in HomeKit, hide_device: ${device.hide_device}`,
      );
    }
    return registerDevice;
  }

  public async externalOrPlatform(device, accessory: PlatformAccessory) {
    if (device.external) {
      this.log.warn(`${accessory.displayName} External Accessory Mode`);
      this.externalAccessory(accessory);
    } else {
      this.log.debug(`${accessory.displayName} External Accessory Mode: ${device.external}`);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  public async externalAccessory(accessory: PlatformAccessory) {
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.log.warn(`Removing existing accessory from cache: ${existingAccessory.displayName}`);
  }

  async statusCode(statusCode: number): Promise<void> {
    switch (statusCode) {
      case 200:
        this.log.debug(`Standard Response, statusCode: ${statusCode}`);
        break;
      case 400:
        this.log.error(`Bad Request, statusCode: ${statusCode}`);
        break;
      case 401:
        this.log.error(`Unauthorized, statusCode: ${statusCode}`);
        break;
      case 404:
        this.log.error(`Not Found, statusCode: ${statusCode}`);
        break;
      case 429:
        this.log.error(`Too Many Requests, statusCode: ${statusCode}`);
        break;
      case 500:
        this.log.error(`Internal Server Error (Meater Server), statusCode: ${statusCode}`);
        break;
      default:
        this.log.info(`Unknown statusCode: ${statusCode}, Report Bugs Here: https://bit.ly/homebridge-meater-bug-report`);
    }
  }

  // Utility for debug logging.
  public info(message: string, ...parameters: unknown[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.info(util.format(message, ...parameters));
    }
  }

  // Utility for warn logging.
  public warn(message: string, ...parameters: unknown[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.info(util.format(message, ...parameters));
    }
  }

  // Utility for debug logging.
  public error(message: string, ...parameters: unknown[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.error(util.format(message, ...parameters));
    }
  }

  // Utility for debug logging.
  public debug(message: string, ...parameters: unknown[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.config.logging === 'debugMode') {
        this.log.debug(util.format(message, ...parameters));
      } else if (this.config.logging === 'debug') {
        this.log.info(util.format(message, ...parameters));
      }
    }
  }

  // Utility for debug logging.
  public debugError(message: string, ...parameters: unknown[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.config.logging === 'debugMode') {
        this.log.debug(util.format(message, ...parameters));
      } else if (this.config.logging === 'debug') {
        this.log.info(util.format(message, ...parameters));
      }
    }
  }

  // Utility for debug logging.
  public debugWarn(message: string, ...parameters: unknown[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.info(util.format(message, ...parameters));
    }
  }

  private enablingPlatfromLogging() {
    return this.config.logging?.includes('debug') || this.config.logging === 'standard';
  }
}
