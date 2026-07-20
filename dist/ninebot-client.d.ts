import type { JsonValue, NinebotVehicle, NinebotVehicleSnapshot, NinebotVehicleState } from './types';
export interface NinebotClientOptions {
    baseUrl: string;
    bearerToken?: string;
    timeoutSeconds?: number;
    allowInsecureHttp?: boolean;
}
/** HTTP client for the proxy API used by NinePlus LiveRide. */
export declare class NinebotClient {
    private readonly baseUrl;
    private readonly bearerToken?;
    private readonly timeoutMs;
    constructor(options: NinebotClientOptions);
    listVehicles(): Promise<NinebotVehicle[]>;
    getVehicleSnapshot(vehicle: NinebotVehicle): Promise<NinebotVehicleSnapshot>;
    ringBell(sn: string): Promise<void>;
    openBucket(sn: string): Promise<void>;
    setEnginePower(sn: string, enabled: boolean): Promise<void>;
    private request;
}
export declare function parseVehicleState(statusPayload?: JsonValue, travelPayload?: JsonValue, batteryPayload?: JsonValue): NinebotVehicleState;
export declare function normalizeEnergy(value: number | undefined, distanceKm: number | undefined): number | undefined;
