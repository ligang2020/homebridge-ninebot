import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEnergy, parseVehicleState } from '../src/ninebot-client';

test('normalizes common battery and status aliases', () => {
  const state = parseVehicleState(
    {
      dump_energy: 76,
      pwr: 1,
      charging: 0,
      lock_status: 1,
      estimate_mileage: 82.5,
      battery: { battery_voltage: 52340, battery_temperature: 285 },
      total_mileage: 1932.4,
    },
    {
      total_mileages: 118.8,
      ec: 3.2,
      list: [{ mileage: 12.4, used_electricity: 0.42 }],
    },
    { battery_list: [{ bms_cycle: 43 }] },
  );

  assert.equal(state.battery, 76);
  assert.equal(state.isPoweredOn, true);
  assert.equal(state.isCharging, false);
  assert.equal(state.isLocked, true);
  assert.equal(state.batteryVoltage, 52.34);
  assert.equal(state.batteryTemperature, 28.5);
  assert.equal(state.batteryCycleCount, 43);
  assert.equal(state.endurance, 82.5);
  assert.equal(state.totalMileage, 1932.4);
  assert.equal(state.monthMileage, 118.8);
  assert.equal(state.monthEnergyWh, 3200);
  assert.equal(state.lastEnergyWh, 420);
});

test('supports common data envelopes and chooses plausible energy units', () => {
  const state = parseVehicleState(
    { data: { dumpEnergy: 51, powerStatus: false, loc: { lock: 0 } } },
    { data: { monthMileage: 25, usedElectricity: 950 } },
    { data: { electricity: 51, chargingState: true, batteries: [{ batteryTemp: 26.2 }] } },
  );

  assert.equal(state.battery, 51);
  assert.equal(state.isPoweredOn, false);
  assert.equal(state.isLocked, false);
  assert.equal(state.isCharging, true);
  assert.equal(state.batteryTemperature, 26.2);
  assert.equal(state.monthEnergyWh, 950);
  assert.equal(state.monthEnergyPerKm, 38);
  assert.equal(normalizeEnergy(4, undefined), 4000);
  assert.equal(normalizeEnergy(400, 10), 400);
});

test('keeps unavailable battery values undefined instead of treating them as zero', () => {
  const state = parseVehicleState({}, {}, {});

  assert.equal(state.battery, undefined);
  assert.equal(state.batteryTemperature, undefined);
});
