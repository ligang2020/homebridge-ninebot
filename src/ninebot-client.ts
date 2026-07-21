import type {
  JsonObject,
  JsonValue,
  NinebotVehicle,
  NinebotVehicleSnapshot,
  NinebotVehicleState,
} from './types';

export interface NinebotClientOptions {
  baseUrl: string;
  bearerToken?: string;
  timeoutSeconds?: number;
  allowInsecureHttp?: boolean;
}

/** HTTP client for the proxy API used by NinePlus LiveRide. */
export class NinebotClient {
  private readonly baseUrl: URL;
  private readonly bearerToken?: string;
  private readonly timeoutMs: number;

  constructor(options: NinebotClientOptions) {
    const configured = options.baseUrl.trim();
    if (!configured) {
      throw new Error('未配置 baseUrl。请填写 Ninebot Proxy 的完整地址。');
    }

    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(configured) ? configured : `http://${configured}`;
    let url: URL;
    try {
      url = new URL(normalized.endsWith('/') ? normalized : `${normalized}/`);
    } catch {
      throw new Error('baseUrl 格式无效。示例：http://192.168.1.20:18009');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('baseUrl 仅支持 HTTP 或 HTTPS。');
    }
    if (url.protocol === 'http:' && options.allowInsecureHttp === false) {
      throw new Error('当前配置禁止 HTTP，请启用 allowInsecureHttp 或使用 HTTPS。');
    }

    this.baseUrl = url;
    this.bearerToken = options.bearerToken?.trim() || undefined;
    this.timeoutMs = clampNumber(options.timeoutSeconds ?? 30, 3, 120) * 1000;
  }

  async listVehicles(): Promise<NinebotVehicle[]> {
    const payload = await this.request('GET', ['vehicles']);
    const values = extractArray(payload, ['vehicles', 'list', 'data']);
    const result: NinebotVehicle[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const object = asObject(value);
      if (!object) {
        continue;
      }
      const sn = firstString(object, ['sn', 'vehicle_sn', 'vehicleSn', 'serial_number', 'serialNumber']);
      if (!sn || seen.has(sn)) {
        continue;
      }
      seen.add(sn);
      const model = firstString(object, ['model', 'model_name', 'modelName', 'product_name', 'productName']);
      const name = firstString(object, ['name', 'vehicle_name', 'vehicleName', 'nick_name', 'nickName'])
        || model
        || `Ninebot ${sn.slice(-6)}`;
      result.push({ sn, name, model });
    }

    return result;
  }

  async getVehicleSnapshot(vehicle: NinebotVehicle): Promise<NinebotVehicleSnapshot> {
    const month = currentShanghaiMonth();
    const results = await Promise.allSettled([
      this.request('GET', ['vehicles', vehicle.sn, 'status']),
      this.request('GET', ['vehicles', vehicle.sn, 'battery']),
      this.request('GET', ['vehicles', vehicle.sn, 'travel'], { month }),
    ]);

    const [status, battery, travel] = results.map((result) => result.status === 'fulfilled' ? result.value : undefined);
    if (!status && !battery && !travel) {
      const reason = results.find((result) => result.status === 'rejected');
      throw reason?.status === 'rejected' ? reason.reason : new Error('车辆状态接口没有返回数据。');
    }

    return {
      vehicle,
      state: parseVehicleState(status, travel, battery),
    };
  }

  async ringBell(sn: string): Promise<void> {
    await this.request('POST', ['vehicles', sn, 'bell']);
  }

  async openBucket(sn: string): Promise<void> {
    await this.request('POST', ['vehicles', sn, 'buck']);
  }

  async setEnginePower(sn: string, enabled: boolean): Promise<void> {
    await this.request('POST', ['vehicles', sn, 'engine', enabled ? 'start' : 'stop']);
  }

  private async request(method: 'GET' | 'POST', path: string[], query?: Record<string, string>): Promise<JsonValue> {
    const url = new URL(path.map(encodeURIComponent).join('/'), this.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(this.bearerToken ? { authorization: `Bearer ${this.bearerToken}` } : {}),
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let body: JsonValue = null;
      if (text.trim()) {
        try {
          body = JSON.parse(text) as JsonValue;
        } catch {
          if (!response.ok) {
            throw new Error(`Ninebot Proxy 请求失败（HTTP ${response.status}）。`);
          }
          throw new Error('Ninebot Proxy 返回了非 JSON 数据。');
        }
      }

      if (!response.ok) {
        throw new Error(extractErrorMessage(body) || `Ninebot Proxy 请求失败（HTTP ${response.status}）。`);
      }

      const object = asObject(body);
      if (object && typeof object.code === 'number' && object.code !== 0 && object.code !== 200) {
        throw new Error(extractErrorMessage(body) || `Ninebot Proxy 返回错误码 ${object.code}。`);
      }
      return unwrapData(body) ?? body;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`连接 Ninebot Proxy 超时（${Math.round(this.timeoutMs / 1000)} 秒）。`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseVehicleState(statusPayload?: JsonValue, travelPayload?: JsonValue, batteryPayload?: JsonValue): NinebotVehicleState {
  const status = asObject(unwrapData(statusPayload)) ?? {};
  const travel = asObject(unwrapData(travelPayload)) ?? {};
  const batteryPayloadObject = asObject(unwrapData(batteryPayload)) ?? {};
  const batteryObject = firstObject(status, ['battery', 'batteryInfo', 'battery_info', 'bms', 'bmsInfo', 'bms_info']) ?? {};
  const batteryListObject = firstArrayObject(batteryPayloadObject, ['battery_list', 'batteryList', 'batteries']) ?? {};
  const batteryMainObject = firstObject(batteryPayloadObject, ['battery_main', 'batteryMain']) ?? {};
  const batterySources = [status, batteryObject, batteryPayloadObject, batteryListObject, batteryMainObject];
  const location = asObject(status.loc);
  const lockNumber = numberValue(location?.lock) ?? numberValue(status.lock_status);
  const rides = extractArray(travel, ['list', 'rides', 'records']);
  const lastRide = asObject(rides[0]);

  const battery = firstNumber([status, batteryPayloadObject, batteryListObject], ['dump_energy', 'dumpEnergy', 'electricity']);
  const batteryTemperature = normalizeTemperature(firstNumber(batterySources, [
    'battery_temperature', 'batteryTemperature', 'battery_temp', 'batteryTemp', 'batt_temperature', 'battTemperature',
    'batt_temp', 'battTemp', 'bat_temperature', 'batTemperature', 'bms_temperature', 'bmsTemperature', 'bms_temp', 'bmsTemp', 'temperature', 'temp',
  ]));
  const monthMileage = firstNumber([travel], ['total_mileages', 'monthMileage', 'month_mileage']);
  const monthEnergyWh = normalizeEnergy(firstNumber([travel], [
    'ec', 'monthEnergy', 'month_energy', 'monthElectricity', 'electricity', 'energy', 'consume_electricity', 'consumeElectricity',
    'used_electricity', 'usedElectricity', 'used_electric', 'usedElectric', 'electricity_used', 'electricityUsed', 'power_consumption', 'powerConsumption',
  ]), monthMileage);
  const lastMileage = firstNumber([lastRide ?? {}], ['mileages', 'mileage', 'distance', 'rideMileage']);
  const lastEnergyWh = normalizeEnergy(firstNumber([lastRide ?? {}], [
    'ec', 'energy', 'electricity', 'consume', 'consumption', 'consume_electricity', 'consumeElectricity', 'power_consumption', 'powerConsumption',
    'used_electricity', 'usedElectricity', 'used_electric', 'usedElectric', 'useElectricity', 'electricity_used', 'electricityUsed', 'power_used', 'powerUsed',
  ]), lastMileage);

  return omitUndefined({
    battery: battery === undefined ? undefined : Math.round(clampNumber(battery, 0, 100)),
    batteryVoltage: normalizeVoltage(firstNumber(batterySources, [
      'battery_voltage', 'batteryVoltage', 'battery_vol', 'batteryVol', 'batt_voltage', 'battVoltage', 'bat_voltage', 'batVoltage',
      'bms_voltage', 'bmsVoltage', 'bms_volt', 'bmsVolt', 'voltage', 'volt',
    ])),
    batteryTemperature,
    batteryCycleCount: firstNumber([batteryListObject, batteryPayloadObject], ['bms_cycle', 'bmsCycle', 'cycle', 'cycles']),
    chargingPower: firstNumber([batteryPayloadObject], ['charging_power', 'chargingPower', 'charge_power', 'chargePower']),
    endurance: firstNumber([status], ['precise_estimate_mileage', 'preciseEstimateMileage', 'estimate_mileage', 'estimateMileage']),
    aiEstimatedMileage: firstNumber([status], ['ai_estimate_mileage', 'aiEstimateMileage', 'ai_estimated_mileage', 'aiEstimatedMileage']),
    isCharging: firstBoolean([status, batteryPayloadObject], ['charging', 'chargingState'], 1),
    isPoweredOn: firstBoolean([status], ['pwr', 'powerStatus'], 1),
    isLocked: lockNumber === undefined ? undefined : lockNumber === 1,
    remainingChargeTime: firstNumber([status, batteryPayloadObject], ['remain_charge_time', 'remainChargeTime', 'remainingChargeTime']),
    totalMileage: firstNumber([status, travel], ['total_mileage', 'totalMileage', 'total_mileages']),
    monthMileage,
    monthEnergyWh,
    monthEnergyPerKm: monthEnergyWh !== undefined && monthMileage && monthMileage > 0 ? monthEnergyWh / monthMileage : undefined,
    lastMileage,
    lastEnergyWh,
    lastEnergyPerKm: lastEnergyWh !== undefined && lastMileage && lastMileage > 0 ? lastEnergyWh / lastMileage : undefined,
    updatedAt: new Date().toISOString(),
  });
}

function unwrapData(value: JsonValue | undefined): JsonValue | undefined {
  const object = asObject(value);
  if (!object) {
    return value;
  }
  const data = object.data;
  return data !== undefined && data !== null ? data : value;
}

function extractArray(value: JsonValue | JsonObject | undefined, preferredKeys: string[]): JsonValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  const object = asObject(value);
  if (!object) {
    return [];
  }
  for (const key of preferredKeys) {
    if (Array.isArray(object[key])) {
      return object[key] as JsonValue[];
    }
  }
  return [];
}

function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function firstObject(object: JsonObject, keys: string[]): JsonObject | undefined {
  for (const key of keys) {
    const result = asObject(object[key]);
    if (result) {
      return result;
    }
  }
  return undefined;
}

function firstArrayObject(object: JsonObject, keys: string[]): JsonObject | undefined {
  for (const key of keys) {
    const first = Array.isArray(object[key]) ? object[key]?.find((value) => asObject(value)) : undefined;
    const result = asObject(first);
    if (result) {
      return result;
    }
  }
  return undefined;
}

function firstString(object: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function firstNumber(objects: JsonObject[], keys: string[]): number | undefined {
  for (const object of objects) {
    for (const key of keys) {
      const numeric = numberValue(object[key]);
      if (numeric !== undefined) {
        return numeric;
      }
    }
  }
  return undefined;
}

function firstBoolean(objects: JsonObject[], keys: string[], trueValue: number): boolean | undefined {
  for (const object of objects) {
    for (const key of keys) {
      const value = object[key];
      if (typeof value === 'boolean') {
        return value;
      }
      const numeric = numberValue(value);
      if (numeric !== undefined) {
        return numeric === trueValue;
      }
      if (typeof value === 'string') {
        if (/^(true|on|yes)$/i.test(value)) {
          return true;
        }
        if (/^(false|off|no)$/i.test(value)) {
          return false;
        }
      }
    }
  }
  return undefined;
}

function numberValue(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

function normalizeVoltage(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value > 1000) {
    return value / 1000;
  }
  return value > 120 ? value / 10 : value;
}

function normalizeTemperature(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Math.abs(value) > 120 ? value / 10 : value;
}

export function normalizeEnergy(value: number | undefined, distanceKm: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  if (value === 0) {
    return 0;
  }
  if (distanceKm && distanceKm > 0) {
    const candidates = [1, 10, 100, 1000].map((factor) => value * factor);
    const plausible = candidates.filter((candidate) => candidate / distanceKm >= 5 && candidate / distanceKm <= 300);
    if (plausible.length) {
      return plausible.reduce((best, candidate) =>
        Math.abs(Math.log(candidate / distanceKm) - Math.log(38)) < Math.abs(Math.log(best / distanceKm) - Math.log(38)) ? candidate : best,
      );
    }
  }
  return value < 10 ? value * 1000 : value;
}

function extractErrorMessage(value: JsonValue): string | undefined {
  const object = asObject(value);
  if (!object) {
    return undefined;
  }
  return firstString(object, ['message', 'msg', 'error', 'detail']);
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

function currentShanghaiMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}${month}` : new Date().toISOString().slice(0, 7).replace('-', '');
}
