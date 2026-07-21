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
    /**
     * Apple Home can preserve the original per-service tile title even after a
     * bridged accessory updates its read-only Name characteristic.  Version 1
     * of this plugin therefore exposed correct Name values but old tiles could
     * still show the vehicle name.  Retire those service identities once so
     * HomeKit receives new services whose initial titles are the correct names.
     * The bridge pairing and the vehicle accessory UUID are unchanged.
     */
    private migrateServiceIdentitiesForHomeKitNameRefresh;
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
     * The standard HomeKit Name characteristic is read-only. Set it on every
     * update so the cached accessory always advertises the service-specific
     * title, including after a Homebridge restart.
     */
    private getOrAddService;
    private createMetricService;
}
