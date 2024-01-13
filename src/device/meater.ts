import { Service, PlatformAccessory, CharacteristicValue, API, HAP, Logging } from 'homebridge';
import { MeaterPlatform } from '../platform.js';
import { interval } from 'rxjs';
import { request } from 'undici';
import { MeaterPlatformConfig, device, meaterUrl } from '../settings.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Meater {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: MeaterPlatformConfig;
  protected readonly hap: HAP;
  // Services
  serviceLabel!: Service;
  cookRefreshSwitchService!: Service;
  internalTemperatureService!: Service;
  ambientTemperatureService!: Service;

  // Characteristic Values
  internalCurrentTemperature: CharacteristicValue;
  ambientCurrentTemperature: CharacteristicValue;

  // Cofiguration
  cookRefresh!: boolean;

  // Updates
  SensorUpdateInProgress!: boolean;

  constructor(
    private readonly platform: MeaterPlatform,
    private readonly accessory: PlatformAccessory,
    public device: device,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;

    this.internalCurrentTemperature = accessory.context.internalCurrentTemperature;
    this.ambientCurrentTemperature = accessory.context.ambientCurrentTemperature;
    accessory.context.FirmwareRevision = 'v1.0.0';

    // Retrieve initial values and updateHomekit
    this.refreshStatus();

    // set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Meater')
      .setCharacteristic(this.hap.Characteristic.Model, 'Smart Meat Thermometer')
      .setCharacteristic(this.hap.Characteristic.SerialNumber, device.id)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision);

    // Service Label Service
    this.serviceLabel = this.accessory.getService(this.hap.Service.ServiceLabel) ||
    this.accessory.addService(this.hap.Service.ServiceLabel, `Meater Thermometer (${device.id.slice(0, 4)})` );
    this.serviceLabel.setCharacteristic(this.hap.Characteristic.Name, `Meater Thermometer (${device.id.slice(0, 4)})`);
    if (
      !this.serviceLabel.testCharacteristic(this.hap.Characteristic.ConfiguredName) &&
        !this.serviceLabel.testCharacteristic(this.hap.Characteristic.Name)
    ) {
      this.serviceLabel.addCharacteristic(
        this.hap.Characteristic.ConfiguredName, `Meater Thermometer (${device.id.slice(0, 4)})`,
      );
    }

    // Interal Temperature Sensor Service
    this.internalTemperatureService = <Service>this.accessory.getServiceById(this.hap.Service.TemperatureSensor, 'Internal Temperature');
    if (!this.internalTemperatureService) {
      this.internalTemperatureService = new this.hap.Service.TemperatureSensor('Internal Temperature', 'Internal Temperature');
      if (this.internalTemperatureService) {
        this.internalTemperatureService = this.accessory.addService(this.internalTemperatureService);
        this.log.debug('Internal Temperature Service');
      } else {
        this.log.error('Internal Temperature Service -- Failed!');
      }
    }
    this.internalTemperatureService.setCharacteristic(this.hap.Characteristic.Name, 'Internal Temperature');
    if (!this.internalTemperatureService.testCharacteristic(this.hap.Characteristic.ConfiguredName) &&
      !this.internalTemperatureService.testCharacteristic(this.hap.Characteristic.Name)) {
      this.internalTemperatureService.addCharacteristic(this.hap.Characteristic.ConfiguredName, 'Internal Temperature');
    }

    this.ambientTemperatureService = <Service>this.accessory.getServiceById(this.hap.Service.TemperatureSensor, 'Ambient Temperature');
    if (!this.ambientTemperatureService) {
      this.ambientTemperatureService = new this.hap.Service.TemperatureSensor('Ambient Temperature', 'Ambient Temperature');
      if (this.ambientTemperatureService) {
        this.ambientTemperatureService = this.accessory.addService(this.ambientTemperatureService);
        this.log.debug('Ambient Temperature Service');
      } else {
        this.log.error('Ambient Temperature Service -- Failed!');
      }
    }
    this.ambientTemperatureService.setCharacteristic(this.hap.Characteristic.Name, 'Ambient Temperature');
    if (!this.ambientTemperatureService.testCharacteristic(this.hap.Characteristic.ConfiguredName) &&
      !this.ambientTemperatureService.testCharacteristic(this.hap.Characteristic.Name)) {
      this.ambientTemperatureService.addCharacteristic(
        this.hap.Characteristic.ConfiguredName, 'Ambient Temperature');
    }

    // Cook Refresh Switch Service Service
    this.cookRefreshSwitchService = <Service>this.accessory.getServiceById(this.hap.Service.Switch, 'Cook Refresh');
    if (!this.cookRefreshSwitchService) {
      this.cookRefreshSwitchService = new this.hap.Service.Switch('Cook Refresh', 'Cook Refresh');
      if (this.cookRefreshSwitchService) {
        this.cookRefreshSwitchService = this.accessory.addService(this.cookRefreshSwitchService);
        this.log.debug('Ambient Temperature Service');
      } else {
        this.log.error('Ambient Temperature Service -- Failed!');
      }
    }
    this.cookRefreshSwitchService.setCharacteristic(this.hap.Characteristic.Name, 'Cook Refresh');
    if (!this.cookRefreshSwitchService.testCharacteristic(this.hap.Characteristic.ConfiguredName) &&
      !this.cookRefreshSwitchService.testCharacteristic(this.hap.Characteristic.Name)) {
      this.cookRefreshSwitchService.addCharacteristic(
        this.hap.Characteristic.ConfiguredName, 'Cook Refresh');
    }
    // create handlers for required characteristics
    this.cookRefreshSwitchService.getCharacteristic(this.hap.Characteristic.On).onSet(this.handleOnSet.bind(this));

    // Retrieve initial values and update Homekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    (async () => {
      interval(await this.refreshRate() * 1000)
        .subscribe(async () => {
          await this.refreshStatus();
        });
    })();
  }

  async refreshRate() {
    return this.platform.config.refreshRate || 60;
  }

  /**
   * Parse the device status from the SwitchBot api
   */
  async parseStatus(): Promise<void> {
    // Internal Temperature
    this.internalCurrentTemperature = this.internalCurrentTemperature!;
    if (this.internalCurrentTemperature !== this.accessory.context.internalCurrentTemperature) {
      this.log.debug(`${this.accessory.displayName} Internal Current Temperature: ${this.internalCurrentTemperature}°c`);
    }

    // Ambient Temperature
    this.ambientCurrentTemperature = this.ambientCurrentTemperature!;
    if (this.ambientCurrentTemperature !== this.accessory.context.ambientCurrentTemperature) {
      this.log.debug(`${this.accessory.displayName} Ambient Current Temperature: ${this.ambientCurrentTemperature}°c`);
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
          const { body, statusCode, headers } = await request(`${meaterUrl}/${this.device.id}`, {
            method: 'GET',
            headers: {
              'Authorization': 'Bearer ' + this.config.token,
            },
          });
          this.log.debug(`Device body: ${JSON.stringify(body)}`);
          this.log.debug(`Device statusCode: ${statusCode}`);
          this.log.debug(`Device headers: ${JSON.stringify(headers)}`);
          const device: any = await body.json();
          this.log.debug(`Device: ${JSON.stringify(device)}`);
          this.log.debug(`Device StatusCode: ${device.statusCode}`);
          this.log.warn(`Device: ${JSON.stringify(device.data)}`);
          if (statusCode === 200 && device.statusCode === 200) {
            this.internalCurrentTemperature = device.data.temperature.internal;
            this.ambientCurrentTemperature = device.data.temperature.ambient;
            this.cookRefresh = true;
            this.log.info(`${this.accessory.displayName} Internal: ${this.internalCurrentTemperature}, Ambient: ${this.ambientCurrentTemperature}°c`);
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
      this.cookRefresh = false;
    }
    await this.parseStatus();
    await this.updateHomeKitCharacteristics();
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.internalCurrentTemperature === undefined) {
      this.log.debug(`${this.accessory.displayName} Internal Current Temperature: ${this.internalCurrentTemperature}`);
    } else {
      this.accessory.context.internalCurrentTemperature = this.internalCurrentTemperature;
      this.internalTemperatureService?.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.internalCurrentTemperature);
      this.log.debug(`${this.accessory.displayName} updateCharacteristic Internal Current Temperature: ${this.internalCurrentTemperature}`);
    }

    if (this.ambientCurrentTemperature === undefined) {
      this.log.debug(`${this.accessory.displayName} Ambient Current Temperature: ${this.ambientCurrentTemperature}`);
    } else {
      this.accessory.context.ambientCurrentTemperature = this.ambientCurrentTemperature;
      this.ambientTemperatureService?.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.ambientCurrentTemperature);
      this.log.debug(`${this.accessory.displayName} updateCharacteristic Ambient Current Temperature: ${this.ambientCurrentTemperature}`);
    }

    if (this.cookRefresh === undefined) {
      this.log.debug(`${this.accessory.displayName} Cook Refresh Switch: ${this.cookRefresh}`);
    } else {
      this.accessory.context.cookRefresh = this.cookRefresh;
      this.cookRefreshSwitchService?.updateCharacteristic(this.hap.Characteristic.On, this.cookRefresh);
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
        this.cookRefresh = false;
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
    this.internalTemperatureService?.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e);

  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleOnSet(value: CharacteristicValue) {
    this.log.info('Cook Refresh On:', value);
    this.cookRefresh = value as boolean;
    await this.refreshRate();
    await this.updateHomeKitCharacteristics();
  }
}
