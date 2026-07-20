"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NinebotPlatform = void 0;
const ninebot_client_1 = require("./ninebot-client");
const PLUGIN_NAME = 'homebridge-ninebot';
const PLATFORM_NAME = 'Ninebot';
const ACCESSORY_CONTEXT_KEY = 'ninebot';
/** Dynamic Homebridge platform for a Ninebot-compatible proxy API. */
class NinebotPlatform {
    log;
    api;
    Service;
    Characteristic;
    accessories = new Map();
    vehicleNames = new Map();
    config;
    client;
    MetricService;
    pollTimer;
    refreshing = false;
    constructor(log, rawConfig, api) {
        this.log = log;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.config = resolveConfig(rawConfig);
        this.MetricService = this.createMetricService();
        try {
            if (this.config.baseUrl) {
                this.client = new ninebot_client_1.NinebotClient({
                    baseUrl: this.config.baseUrl,
                    bearerToken: this.config.bearerToken,
                    timeoutSeconds: this.config.requestTimeoutSeconds,
                    allowInsecureHttp: this.config.allowInsecureHttp,
                });
            }
            else {
                this.log.error('[Ninebot] 未配置 baseUrl；插件已加载，但不会发现车辆。');
            }
        }
        catch (error) {
            this.log.error(`[Ninebot] 配置无效：${formatError(error)}`);
        }
        this.api.on('didFinishLaunching', () => {
            if (!this.client) {
                return;
            }
            void this.discoverDevices();
            this.pollTimer = setInterval(() => void this.refreshAll(), this.config.pollIntervalSeconds * 1000);
        });
        this.api.on('shutdown', () => {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
            }
        });
    }
    configureAccessory(accessory) {
        const data = accessory.context[ACCESSORY_CONTEXT_KEY];
        if (!data?.sn) {
            this.log.warn(`[Ninebot] 忽略缺少车辆 SN 的缓存配件：${accessory.displayName}`);
            return;
        }
        this.accessories.set(data.sn, accessory);
        this.vehicleNames.set(data.sn, data.name || accessory.displayName);
        this.configureServices(accessory, { sn: data.sn, name: data.name || accessory.displayName });
        this.log.debug(`[Ninebot] 已恢复缓存配件：${accessory.displayName}`);
    }
    async discoverDevices() {
        if (!this.client) {
            return;
        }
        try {
            const discovered = await this.client.listVehicles();
            const wanted = filterVehicles(discovered, this.config.vehicles);
            if (!wanted.length) {
                this.log.warn('[Ninebot] 没有发现可用车辆。请确认 Proxy 地址、Token 和账户授权。');
                return;
            }
            for (const vehicle of wanted) {
                const configured = this.config.vehicles.find((entry) => entry.sn.trim() === vehicle.sn);
                const resolved = { ...vehicle, name: configured?.name?.trim() || vehicle.name };
                this.vehicleNames.set(resolved.sn, resolved.name);
                let accessory = this.accessories.get(resolved.sn);
                if (!accessory) {
                    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${resolved.sn}`);
                    accessory = new this.api.platformAccessory(resolved.name, uuid);
                    this.accessories.set(resolved.sn, accessory);
                    this.configureServices(accessory, resolved);
                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                    this.log.info(`[Ninebot] 已添加到 HomeKit Bridge：${resolved.name}`);
                }
                else {
                    accessory.displayName = resolved.name;
                    this.configureServices(accessory, resolved);
                    this.api.updatePlatformAccessories([accessory]);
                }
                await this.refreshAccessory(resolved.sn);
            }
        }
        catch (error) {
            this.log.error(`[Ninebot] 发现车辆失败：${formatError(error)}`);
        }
    }
    configureServices(accessory, vehicle) {
        accessory.context[ACCESSORY_CONTEXT_KEY] = { sn: vehicle.sn, name: vehicle.name };
        const info = accessory.getService(this.Service.AccessoryInformation);
        info
            .setCharacteristic(this.Characteristic.Manufacturer, 'Ninebot / Segway')
            .setCharacteristic(this.Characteristic.Model, vehicle.model || 'Electric Vehicle')
            .setCharacteristic(this.Characteristic.SerialNumber, vehicle.sn)
            .setCharacteristic(this.Characteristic.FirmwareRevision, 'homebridge-ninebot 1.0.0');
        const battery = this.getOrAddService(accessory, this.Service.BatteryService, 'battery', '电池');
        battery.getCharacteristic(this.Characteristic.BatteryLevel).onGet(() => this.readState(vehicle.sn).then((state) => state.battery ?? 0));
        battery.getCharacteristic(this.Characteristic.ChargingState).onGet(() => this.readState(vehicle.sn).then((state) => state.isCharging === true ? this.Characteristic.ChargingState.CHARGING : this.Characteristic.ChargingState.NOT_CHARGING));
        battery.getCharacteristic(this.Characteristic.StatusLowBattery).onGet(() => this.readState(vehicle.sn).then((state) => state.battery !== undefined && state.battery <= 20
            ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL));
        const temperature = this.getOrAddService(accessory, this.Service.TemperatureSensor, 'battery-temperature', '电池温度');
        temperature.getCharacteristic(this.Characteristic.CurrentTemperature).onGet(() => this.readState(vehicle.sn).then((state) => state.batteryTemperature ?? 0));
        const power = this.getOrAddService(accessory, this.Service.Switch, 'engine', '车辆电源');
        power.getCharacteristic(this.Characteristic.On)
            .onGet(() => this.readState(vehicle.sn).then((state) => state.isPoweredOn ?? false))
            .onSet(async (value) => this.setEnginePower(vehicle.sn, Boolean(value)));
        const online = this.getOrAddService(accessory, this.Service.OccupancySensor, 'power-state', '车辆已上电');
        online.getCharacteristic(this.Characteristic.OccupancyDetected).onGet(() => this.readState(vehicle.sn).then((state) => state.isPoweredOn ? this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED));
        const bell = this.getOrAddService(accessory, this.Service.Switch, 'bell', '寻车响铃');
        bell.getCharacteristic(this.Characteristic.On).onSet(async (value) => {
            if (Boolean(value)) {
                await this.runMomentaryCommand(vehicle.sn, 'ringBell', bell);
            }
        });
        const bucket = this.getOrAddService(accessory, this.Service.Switch, 'bucket', '打开坐桶');
        bucket.getCharacteristic(this.Characteristic.On).onSet(async (value) => {
            if (Boolean(value)) {
                await this.runMomentaryCommand(vehicle.sn, 'openBucket', bucket);
            }
        });
        if (this.config.showLockStatus) {
            const lock = this.getOrAddService(accessory, this.Service.LockMechanism, 'lock', '车辆锁状态');
            lock.getCharacteristic(this.Characteristic.LockCurrentState).onGet(() => this.readLockCurrentState(vehicle.sn));
            lock.getCharacteristic(this.Characteristic.LockTargetState).onGet(() => this.readLockTargetState(vehicle.sn));
            lock.getCharacteristic(this.Characteristic.LockTargetState).onSet(async () => {
                throw new Error('当前 Ninebot Proxy 未提供锁车/解锁接口；已保留只读锁状态，未执行任何操作。');
            });
        }
        const metrics = this.getOrAddService(accessory, this.MetricService, 'metrics', '骑行数据');
        this.configureMetricGetters(metrics, vehicle.sn);
        this.api.updatePlatformAccessories([accessory]);
    }
    configureMetricGetters(service, sn) {
        const characteristics = this.MetricService.Characteristics;
        const mappings = {
            endurance: 'endurance',
            totalMileage: 'totalMileage',
            monthMileage: 'monthMileage',
            monthEnergyWh: 'monthEnergyWh',
            monthEnergyPerKm: 'monthEnergyPerKm',
            lastMileage: 'lastMileage',
            lastEnergyWh: 'lastEnergyWh',
            lastEnergyPerKm: 'lastEnergyPerKm',
        };
        for (const [characteristicName, stateKey] of Object.entries(mappings)) {
            service.getCharacteristic(characteristics[characteristicName]).onGet(() => this.readState(sn).then((state) => state[stateKey] ?? 0));
        }
    }
    async readState(sn) {
        const accessory = this.accessories.get(sn);
        try {
            await this.refreshAccessory(sn);
            return this.getCachedState(accessory) || { updatedAt: new Date().toISOString() };
        }
        catch (error) {
            const cached = this.getCachedState(accessory);
            if (cached) {
                this.log.debug(`[Ninebot] 使用 ${this.vehicleNames.get(sn) || sn} 的最后有效数据：${formatError(error)}`);
                return cached;
            }
            throw error;
        }
    }
    async refreshAll() {
        if (this.refreshing || !this.client) {
            return;
        }
        this.refreshing = true;
        try {
            await Promise.all([...this.accessories.keys()].map(async (sn) => {
                try {
                    await this.refreshAccessory(sn);
                }
                catch (error) {
                    this.log.warn(`[Ninebot] 刷新 ${this.vehicleNames.get(sn) || sn} 失败：${formatError(error)}`);
                }
            }));
        }
        finally {
            this.refreshing = false;
        }
    }
    async refreshAccessory(sn) {
        if (!this.client) {
            throw new Error('Ninebot 客户端没有初始化。');
        }
        const accessory = this.accessories.get(sn);
        if (!accessory) {
            throw new Error(`找不到 SN 为 ${sn} 的 HomeKit 配件。`);
        }
        const vehicle = { sn, name: this.vehicleNames.get(sn) || accessory.displayName };
        const snapshot = await this.client.getVehicleSnapshot(vehicle);
        accessory.context.ninebotState = snapshot.state;
        this.applyState(accessory, snapshot);
        this.api.updatePlatformAccessories([accessory]);
    }
    applyState(accessory, snapshot) {
        const state = snapshot.state;
        const battery = accessory.getServiceById(this.Service.BatteryService, 'battery');
        battery?.updateCharacteristic(this.Characteristic.BatteryLevel, state.battery ?? 0);
        battery?.updateCharacteristic(this.Characteristic.ChargingState, state.isCharging === true ? this.Characteristic.ChargingState.CHARGING : this.Characteristic.ChargingState.NOT_CHARGING);
        battery?.updateCharacteristic(this.Characteristic.StatusLowBattery, state.battery !== undefined && state.battery <= 20
            ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
        accessory.getServiceById(this.Service.TemperatureSensor, 'battery-temperature')
            ?.updateCharacteristic(this.Characteristic.CurrentTemperature, state.batteryTemperature ?? 0);
        accessory.getServiceById(this.Service.Switch, 'engine')
            ?.updateCharacteristic(this.Characteristic.On, state.isPoweredOn ?? false);
        accessory.getServiceById(this.Service.OccupancySensor, 'power-state')
            ?.updateCharacteristic(this.Characteristic.OccupancyDetected, state.isPoweredOn ? this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        const lock = accessory.getServiceById(this.Service.LockMechanism, 'lock');
        if (lock) {
            const current = state.isLocked === true
                ? this.Characteristic.LockCurrentState.SECURED
                : state.isLocked === false
                    ? this.Characteristic.LockCurrentState.UNSECURED
                    : this.Characteristic.LockCurrentState.UNKNOWN;
            lock.updateCharacteristic(this.Characteristic.LockCurrentState, current);
            lock.updateCharacteristic(this.Characteristic.LockTargetState, state.isLocked === true ? this.Characteristic.LockTargetState.SECURED : this.Characteristic.LockTargetState.UNSECURED);
        }
        const metrics = accessory.getServiceById(this.MetricService, 'metrics');
        if (metrics) {
            const characteristics = this.MetricService.Characteristics;
            for (const key of Object.keys(characteristics)) {
                metrics.updateCharacteristic(characteristics[key], state[key] ?? 0);
            }
        }
    }
    async setEnginePower(sn, enabled) {
        if (!this.client) {
            throw new Error('Ninebot 客户端没有初始化。');
        }
        await this.client.setEnginePower(sn, enabled);
        this.log.info(`[Ninebot] ${this.vehicleNames.get(sn) || sn}：已请求${enabled ? '启动' : '关闭'}车辆电源。`);
        this.updateCachedState(sn, { isPoweredOn: enabled });
        setTimeout(() => void this.refreshAccessory(sn).catch((error) => this.log.debug(`[Ninebot] 命令后的状态回读失败：${formatError(error)}`)), 1200);
    }
    async runMomentaryCommand(sn, command, service) {
        if (!this.client) {
            throw new Error('Ninebot 客户端没有初始化。');
        }
        await this.client[command](sn);
        this.log.info(`[Ninebot] ${this.vehicleNames.get(sn) || sn}：已发送${command === 'ringBell' ? '寻车响铃' : '打开坐桶'}命令。`);
        setTimeout(() => service.updateCharacteristic(this.Characteristic.On, false), 800);
    }
    readLockCurrentState(sn) {
        return this.readState(sn).then((state) => state.isLocked === true
            ? this.Characteristic.LockCurrentState.SECURED
            : state.isLocked === false
                ? this.Characteristic.LockCurrentState.UNSECURED
                : this.Characteristic.LockCurrentState.UNKNOWN);
    }
    readLockTargetState(sn) {
        return this.readState(sn).then((state) => state.isLocked === true
            ? this.Characteristic.LockTargetState.SECURED
            : this.Characteristic.LockTargetState.UNSECURED);
    }
    updateCachedState(sn, patch) {
        const accessory = this.accessories.get(sn);
        if (!accessory) {
            return;
        }
        const next = { ...(this.getCachedState(accessory) || { updatedAt: new Date().toISOString() }), ...patch, updatedAt: new Date().toISOString() };
        accessory.context.ninebotState = next;
        this.applyState(accessory, { vehicle: { sn, name: this.vehicleNames.get(sn) || accessory.displayName }, state: next });
        this.api.updatePlatformAccessories([accessory]);
    }
    getCachedState(accessory) {
        const state = accessory?.context.ninebotState;
        return state?.updatedAt ? state : undefined;
    }
    getOrAddService(accessory, serviceType, subtype, name) {
        return accessory.getServiceById(serviceType, subtype)
            || accessory.addService(new serviceType(name, subtype));
    }
    createMetricService() {
        const hap = this.api.hap;
        const createMetric = (displayName, key, unit, minStep) => {
            const uuid = hap.uuid.generate(`${PLUGIN_NAME}:characteristic:${key}`);
            const MetricCharacteristic = class extends hap.Characteristic {
                static UUID = uuid;
                constructor() {
                    super(displayName, uuid);
                    this.setProps({
                        format: hap.Formats.FLOAT,
                        unit,
                        minValue: 0,
                        minStep,
                        perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
                    });
                    this.value = this.getDefaultValue();
                }
            };
            return MetricCharacteristic;
        };
        const Characteristics = {
            endurance: createMetric('预计续航', 'range-km', 'km', 0.1),
            totalMileage: createMetric('总里程', 'total-mileage-km', 'km', 0.1),
            monthMileage: createMetric('本月里程', 'month-mileage-km', 'km', 0.1),
            monthEnergyWh: createMetric('本月用电', 'month-energy-wh', 'Wh', 1),
            monthEnergyPerKm: createMetric('本月能耗', 'month-energy-per-km', 'Wh/km', 0.1),
            lastMileage: createMetric('最近骑行里程', 'last-mileage-km', 'km', 0.1),
            lastEnergyWh: createMetric('最近骑行用电', 'last-energy-wh', 'Wh', 1),
            lastEnergyPerKm: createMetric('最近骑行能耗', 'last-energy-per-km', 'Wh/km', 0.1),
        };
        const serviceUuid = hap.uuid.generate(`${PLUGIN_NAME}:service:metrics`);
        const MetricService = class extends hap.Service {
            static UUID = serviceUuid;
            static Characteristics = Characteristics;
            constructor(displayName, subtype) {
                super(displayName, serviceUuid, subtype);
                for (const characteristic of Object.values(Characteristics)) {
                    this.addOptionalCharacteristic(characteristic);
                    this.getCharacteristic(characteristic);
                }
            }
        };
        return MetricService;
    }
}
exports.NinebotPlatform = NinebotPlatform;
function resolveConfig(config) {
    return {
        name: config.name?.trim() || 'Ninebot',
        baseUrl: config.baseUrl?.trim() || undefined,
        bearerToken: config.bearerToken?.trim() || undefined,
        pollIntervalSeconds: clampInteger(config.pollIntervalSeconds, 30, 15, 3600),
        requestTimeoutSeconds: clampInteger(config.requestTimeoutSeconds, 12, 3, 60),
        allowInsecureHttp: config.allowInsecureHttp ?? true,
        showLockStatus: config.showLockStatus ?? true,
        vehicles: Array.isArray(config.vehicles)
            ? config.vehicles.filter((vehicle) => Boolean(vehicle?.sn?.trim())).map((vehicle) => ({
                sn: vehicle.sn.trim(), name: vehicle.name?.trim() || undefined,
            }))
            : [],
    };
}
function filterVehicles(discovered, configured) {
    if (!configured.length) {
        return discovered;
    }
    const allowed = new Set(configured.map((entry) => entry.sn.trim()));
    return discovered.filter((vehicle) => allowed.has(vehicle.sn));
}
function clampInteger(value, fallback, minimum, maximum) {
    return Math.min(Math.max(Math.round(value ?? fallback), minimum), maximum);
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=platform.js.map