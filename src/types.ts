export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined; }

export interface VehicleConfiguration {
  sn: string;
  name?: string;
}

export interface NinebotPlatformConfig {
  name?: string;
  baseUrl?: string;
  bearerToken?: string;
  vehicles?: VehicleConfiguration[];
  pollIntervalSeconds?: number;
  requestTimeoutSeconds?: number;
  allowInsecureHttp?: boolean;
  showLockStatus?: boolean;
}

export interface NinebotVehicle {
  sn: string;
  name: string;
  model?: string;
}

export interface NinebotVehicleState {
  battery?: number;
  batteryVoltage?: number;
  batteryTemperature?: number;
  batteryCycleCount?: number;
  chargingPower?: number;
  endurance?: number;
  aiEstimatedMileage?: number;
  isCharging?: boolean;
  /** Whether the proxy explicitly reports that a charger is connected. */
  isChargerConnected?: boolean;
  isPoweredOn?: boolean;
  isLocked?: boolean;
  remainingChargeTime?: number;
  latitude?: number;
  longitude?: number;
  totalMileage?: number;
  monthMileage?: number;
  monthEnergyWh?: number;
  monthEnergyPerKm?: number;
  lastMileage?: number;
  lastEnergyWh?: number;
  lastEnergyPerKm?: number;
  updatedAt: string;
}

export interface NinebotVehicleSnapshot {
  vehicle: NinebotVehicle;
  state: NinebotVehicleState;
}
