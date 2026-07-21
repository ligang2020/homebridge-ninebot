import type { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import type { NinebotPlatformConfig } from './types';
/** Dynamic Homebridge platform for a Ninebot-compatible proxy API. */
export declare class NinebotPlatform {
    readonly log: Logger;
    readonly api: API;
    private readonly Service;
    private readonly Characteristic;
    private readonly accessories;
    private readonly vehicleNames;
    private readonly config;
    private readonly client?;
    private readonly MetricService;
    private pollTimer?;
    private refreshing;
    /** Coalesce concurrent characteristic reads into one Proxy request per vehicle. */
    private readonly refreshes;
    constructor(log: Logger, rawConfig: NinebotPlatformConfig & PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private discoverDevices;
    private configureServices;
    private configureMetricGetters;
    private refreshAll;
    private refreshAccessory;
    private refreshAccessoryInternal;
    private syncBatteryService;
    private syncChargerService;
    private removeLegacyPowerStateService;
    private removeLegacyLockMechanism;
    private syncLockStatusService;
    private syncTemperatureService;
    private applyState;
    private setEnginePower;
    private runMomentaryCommand;
    private updateCachedState;
    private getCachedState;
    /**
     * Service constructors only apply their name on first creation. Existing
     * cached services otherwise retain the vehicle name that Homebridge gave
     * them before this plugin assigned a service-specific name. Always refresh
     * the Name characteristic so HomeKit shows "车辆电源", "寻车响铃", etc.
     * rather than the vehicle name on every tile after an upgrade.
     */
    private getOrAddService;
    private createMetricService;
}
