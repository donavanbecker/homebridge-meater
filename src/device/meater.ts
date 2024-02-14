/* Copyright(C) 2023-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * meater.ts: homebridge-meater.
 */
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { request } from 'undici';
import { interval, skipWhile } from 'rxjs';

import { deviceBase } from './device.js';
import { MeaterPlatform } from '../platform.js';
import { device, devicesConfig, meaterUrl } from '../settings.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Meater extends deviceBase {
  // Service
  private serviceLabel!: {
    service: Service;
  };

  private cookRefresh!: {
    service: Service;
    on: CharacteristicValue;
  };

  private internal!: {
    service: Service;
    currentTemperature: CharacteristicValue;
  };

  private ambient!: {
    service: Service;
    currentTemperature: CharacteristicValue;
  };

  // Cofiguration
  CookRefresh!: boolean;

  // Updates
  SensorUpdateInProgress!: boolean;

  constructor(
    readonly platform: MeaterPlatform,
    accessory: PlatformAccessory,
    device: device & devicesConfig,
  ) {
    super(platform, accessory, device);

    // serviceLabel Service
    this.debugLog('Configure serviceLabel Service');
    this.serviceLabel = {
      service: this.accessory.getService(this.hap.Service.ServiceLabel)
        ?? this.accessory.addService(this.hap.Service.ServiceLabel, device.configDeviceName || `Meater Thermometer (${device.id.slice(0, 4)})`),
    };

    // Add serviceLabel Service's Characteristics
    this.serviceLabel.service
      .setCharacteristic(this.hap.Characteristic.Name, device.configDeviceName || `Meater Thermometer (${device.id.slice(0, 4)})`);

    // InternalTemperature Senosr Service
    this.debugLog('Configure InternalTemperature Service');
    this.internal = {
      service: <Service>this.accessory.getServiceById(this.hap.Service.TemperatureSensor, 'Internal Temperature'),
      currentTemperature: 32,
    };

    if (this.internal) {
      if (!this.internal.service) {
        this.internal.service = new this.hap.Service.TemperatureSensor('Internal Temperature', 'Internal Temperature');
        if (this.internal.service) {
          this.internal.service = this.accessory.addService(this.internal.service);
          this.log.debug('Internal Temperature Service');
        } else {
          this.log.error('Internal Temperature Service -- Failed!');
        }
      }
    }

    // Add InternalTemperature Sensor Service's Characteristics
    this.internal.service
      .setCharacteristic(this.hap.Characteristic.Name, 'Internal Temperature')
      .setCharacteristic(this.hap.Characteristic.CurrentTemperature, this.internal.currentTemperature);

    // AmbientTemperature Senosr Service
    this.debugLog('Configure AmbientTemperature Service');
    this.ambient = {
      service: <Service>this.accessory.getServiceById(this.hap.Service.TemperatureSensor, 'Ambient Temperature'),
      currentTemperature: 32,
    };
    if (this.ambient) {
      if (!this.ambient.service) {
        this.ambient.service = new this.hap.Service.TemperatureSensor('Ambient Temperature', 'Ambient Temperature');
        if (this.ambient.service) {
          this.ambient.service = this.accessory.addService(this.ambient.service);
          this.log.debug('Ambient Temperature Service');
        } else {
          this.log.error('Ambient Temperature Service -- Failed!');
        }
      }
    }

    // Add AmbientTemperature Senosr Service's Characteristics
    this.ambient.service
      .setCharacteristic(this.hap.Characteristic.Name, 'Ambient Temperature')
      .setCharacteristic(this.hap.Characteristic.CurrentTemperature, this.ambient.currentTemperature);

    // cookRefresh Service
    this.debugLog('Configure cookRefresh Service');
    this.cookRefresh = {
      service: <Service>this.accessory.getServiceById(this.hap.Service.Switch, 'Cook Refresh'),
      on: false,
    };
    if (this.cookRefresh) {
      if (!this.cookRefresh.service) {
        this.cookRefresh.service = new this.hap.Service.Switch('Cook Refresh', 'Cook Refresh');
        if (this.cookRefresh.service) {
          this.cookRefresh.service = this.accessory.addService(this.cookRefresh.service);
          this.log.debug('Ambient Temperature Service');
        } else {
          this.log.error('Ambient Temperature Service -- Failed!');
        }
      }
    }

    // Add serviceLabel Service's Characteristics
    this.cookRefresh.service
      .setCharacteristic(this.hap.Characteristic.Name, 'Cook Refresh')
      .setCharacteristic(this.hap.Characteristic.On, this.cookRefresh.on);

    // Create handlers for required characteristics
    this.cookRefresh.service
      .getCharacteristic(this.hap.Characteristic.On)
      .onSet(this.handleOnSet.bind(this));

    // this is subject we use to track when we need to POST changes to the NoIP API
    this.SensorUpdateInProgress = false;

    // Retrieve initial values and update Homekit
    this.refreshStatus();
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus();
      });
  }

  /**
   * Parse the device status from the SwitchBot api
   */
  async parseStatus(device: device & devicesConfig): Promise<void> {
    // Internal Temperature
    this.internal.currentTemperature = device.data.temperature.internal;
    if (this.internal.currentTemperature !== this.accessory.context.internal.currentTemperature) {
      this.log.debug(`${this.accessory.displayName} Internal Current Temperature: ${this.internal.currentTemperature}°c`);
    }

    // Ambient Temperature
    this.ambient.currentTemperature = device.data.temperature.ambient;
    if (this.ambient.currentTemperature !== this.accessory.context.ambient.currentTemperature) {
      this.log.debug(`${this.accessory.displayName} Ambient Current Temperature: ${this.ambient.currentTemperature}°c`);
    }
  }

  /**
   * Asks the SwitchBot API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    this.log.info(`Refreshing ${this.accessory.displayName} Status... Cooking: ${this.cookRefresh}`);
    if (this.cookRefresh) {
      try {
        if (this.config.token) {
          const { body, statusCode } = await request(`${meaterUrl}/${this.device.id}`, {
            method: 'GET',
            headers: {
              'Authorization': 'Bearer ' + this.config.token,
            },
          });
          this.log.debug(`Device statusCode: ${statusCode}`);
          const device: any = await body.json();
          this.log.debug(`Device: ${JSON.stringify(device)}`);
          this.log.debug(`Device StatusCode: ${device.statusCode}`);
          this.log.warn(`Device: ${JSON.stringify(device.data)}`);
          if (statusCode === 200 && device.statusCode === 200) {
            this.CookRefresh = true;
            await this.parseStatus(device);
            await this.updateHomeKitCharacteristics();
            this.log.info(`${this.accessory.displayName} Internal: ${this.internal.currentTemperature}, `
              + `Ambient: ${this.ambient.currentTemperature}°c`);
          } else {
            await this.statusCode(statusCode);
            await this.statusCode(device.statusCode);
          }
        }
      } catch (e: any) {
        this.apiError(e);
        this.log.error(
          `${this.accessory.displayName} failed refreshStatus, Error Message: ${JSON.stringify(e.message)}`,
        );
      }
    } else {
      this.log.info(`Cook Refresh is off for ${this.accessory.displayName}`);
      this.CookRefresh = false;
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.internal.currentTemperature === undefined) {
      this.log.debug(`${this.accessory.displayName} Internal Current Temperature: ${this.internal.currentTemperature}`);
    } else {
      this.accessory.context.internal.currentTemperature = this.internal.currentTemperature;
      this.internal.service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.internal.currentTemperature);
      this.log.debug(`${this.accessory.displayName} updateCharacteristic Internal Current Temperature: ${this.internal.currentTemperature}`);
    }

    if (this.ambient.currentTemperature === undefined) {
      this.log.debug(`${this.accessory.displayName} Ambient Current Temperature: ${this.ambient.currentTemperature}`);
    } else {
      this.accessory.context.ambientCurrentTemperature = this.ambient.currentTemperature;
      this.ambient.service?.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.ambient.currentTemperature);
      this.log.debug(`${this.accessory.displayName} updateCharacteristic Ambient Current Temperature: ${this.ambient.currentTemperature}`);
    }

    if (this.cookRefresh === undefined) {
      this.log.debug(`${this.accessory.displayName} Cook Refresh Switch: ${this.cookRefresh}`);
    } else {
      this.accessory.context.cookRefresh = this.cookRefresh;
      this.cookRefresh.service?.updateCharacteristic(this.hap.Characteristic.On, this.CookRefresh);
      this.log.debug(`${this.accessory.displayName} updateCharacteristic Cook Refresh Switch: ${this.cookRefresh}`);
    }
  }

  async statusCode(statusCode: number): Promise<void> {
    /**
    * Meater API Status Codes (https://github.com/apption-labs/meater-cloud-public-rest-api)
    *
    * Standard Response Codes: 200(OK), 201(Created), 204(No Content)
    * https://github.com/apption-labs/meater-cloud-public-rest-api#standard-response
    *
    * Error Response: 400(Bad Request), 401(Unauthorized), 404(Not Found), 429(Too Many Requests), 500(Internal Server Error)
    * https://github.com/apption-labs/meater-cloud-public-rest-api#error-response
    **/
    switch (statusCode) {
      case 200:
        this.log.debug(`${this.accessory.displayName} Standard Response, statusCode: ${statusCode}`);
        break;
      case 400:
        this.log.error(`${this.accessory.displayName} Bad Request, statusCode: ${statusCode}`);
        break;
      case 401:
        this.log.error(`${this.accessory.displayName} Unauthorized, statusCode: ${statusCode}`);
        break;
      case 404:
        this.log.error(`${this.accessory.displayName} Not Found, statusCode: ${statusCode}`);
        this.CookRefresh = false;
        break;
      case 429:
        this.log.error(`${this.accessory.displayName} Too Many Requests, statusCode: ${statusCode}`);
        break;
      case 500:
        this.log.error(`${this.accessory.displayName} Internal Server Error (Meater Server), statusCode: ${statusCode}`);
        break;
      default:
        this.log.info(
          `${this.accessory.displayName} Unknown statusCode: ${statusCode}, Report Bugs Here: https://bit.ly/homebridge-meater-bug-report`);
    }
  }

  async apiError(e: any): Promise<void> {
    this.internal.service?.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e);

  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleOnSet(value: CharacteristicValue) {
    this.log.info('Cook Refresh On:', value);
    this.CookRefresh = value as boolean;
    await this.refreshStatus();
    await this.updateHomeKitCharacteristics();
  }
}
