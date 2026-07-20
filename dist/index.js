"use strict";
const platform_1 = require("./platform");
const PLUGIN_NAME = 'homebridge-ninebot';
const PLATFORM_NAME = 'Ninebot';
module.exports = (api) => {
    api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, platform_1.NinebotPlatform);
};
//# sourceMappingURL=index.js.map