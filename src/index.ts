import type { API } from 'homebridge';
import { NinebotPlatform } from './platform';

const PLUGIN_NAME = 'homebridge-ninebot';
const PLATFORM_NAME = 'Ninebot';

export = (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NinebotPlatform);
};
