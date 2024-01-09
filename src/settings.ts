/* eslint-disable max-len */
import { PlatformConfig } from 'homebridge';
/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'Meater';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-meater';

/**
 * This is the main url used to access Meater API https://github.com/apption-labs/meater-cloud-public-rest-api
 */
export const meaterEndPoint = 'https://public-api.cloud.meater.com/v1';

export const meaterUrl = 'https://public-api.cloud.meater.com/v1/devices';

export const meaterUrlLogin = 'https://public-api.cloud.meater.com/v1/login';

//Config
export interface MeaterPlatformConfig extends PlatformConfig {
  email?: string;
  password?: string;
  token?: string;
  logging?: string;
  refreshRate?: number;
}

export type deviceConfig = {
  hide_device: boolean;
  external: boolean;
}

export type getDevice = {
  status: string;
  statusCode: number;
  data: Data;
  meta: object;
}

export type Data = {
  devices: Array<device>
}

export type device = {
  id: string;
  temperature: Temperature;
  cook: Cook;
  updated_at: number;
}

export type Temperature = {
  ambient: number;
  internal: number;
}

export type Cook = {
  id: string;
  name: string;
  state: string;
  temperature: cookTemperature;
  time: cookTime;
}

export type cookTemperature = {
  target: number;
  peak: number;
}

export type cookTime = {
  elapsed: number;
  remaining: number;
}

