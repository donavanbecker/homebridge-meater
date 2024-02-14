/* Copyright(C) 2023-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: homebridge-meater.
 */
import { API, HAP, Logging, PlatformAccessory } from 'homebridge';

import { MeaterPlatform } from '../platform.js';
import { MeaterPlatformConfig, device, devicesConfig } from '../settings.js';

export abstract class deviceBase {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: MeaterPlatformConfig;
  protected readonly hap: HAP;

  // Config
  protected deviceLogging!: string;
  protected deviceRefreshRate!: number;

  constructor(
    protected readonly platform: MeaterPlatform,
    protected accessory: PlatformAccessory,
    protected device: device,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;

    this.deviceLogs(device);
    this.getDeviceRefreshRate(device);
    this.deviceConfigOptions(device);
    this.deviceContext(accessory, device);

    // Set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Meater')
      .setCharacteristic(this.hap.Characteristic.Model, 'Smart Meat Thermometer')
      .setCharacteristic(this.hap.Characteristic.SerialNumber, device.id)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision);
  }

  async deviceLogs(device: device & devicesConfig): Promise<void> {
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.config.logging) {
      this.deviceLogging = this.accessory.context.logging = this.config.logging;
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  async getDeviceRefreshRate(device: device & devicesConfig): Promise<void> {
    if (device.refreshRate) {
      if (device.refreshRate < 1800) {
        device.refreshRate = 1800;
        this.warnLog('Refresh Rate cannot be set to lower the 5 mins, as Lock detail (battery level, etc) are unlikely to change within that period');
      }
      this.deviceRefreshRate = this.accessory.context.refreshRate = device.refreshRate;
      this.debugLog(`Lock: ${this.accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.config.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.config.refreshRate;
      this.debugLog(`Lock: ${this.accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
  }

  async deviceConfigOptions(device: device & devicesConfig): Promise<void> {
    const deviceConfig = {};
    if (device.logging !== undefined) {
      deviceConfig['logging'] = device.logging;
    }
    if (device.refreshRate !== undefined) {
      deviceConfig['refreshRate'] = device.refreshRate;
    }
    if (Object.entries(deviceConfig).length !== 0) {
      this.infoLog(`Lock: ${this.accessory.displayName} Config: ${JSON.stringify(deviceConfig)}`);
    }
  }

  async deviceContext(accessory: PlatformAccessory, device: device & devicesConfig): Promise<void> {
    if (device.firmware) {
      accessory.context.FirmwareRevision = device.firmware;
    } else if (accessory.context.FirmwareRevision === undefined) {
      accessory.context.FirmwareRevision = await this.platform.getVersion();
    } else {
      accessory.context.FirmwareRevision = '3';
    }
  }

  /**
   * Logging for Device
   */
  infoLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.info(String(...log));
    }
  }

  warnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.warn(String(...log));
    }
  }

  debugWarnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.log.error(String(...log));
    }
  }

  debugErrorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log));
      } else {
        this.log.debug(String(...log));
      }
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}