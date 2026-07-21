import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface SchemaProperty {
  default?: unknown;
  maximum?: unknown;
  minimum?: unknown;
}

interface ConfigSchema {
  pluginAlias: string;
  pluginType: string;
  schema: {
    properties: Record<string, SchemaProperty>;
  };
}

interface PackageManifest {
  files: string[];
}

test('ships the Homebridge UI request-timeout setting', () => {
  const configSchema = JSON.parse(readFileSync('config.schema.json', 'utf8')) as ConfigSchema;
  const packageManifest = JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest;
  const timeout = configSchema.schema.properties.requestTimeoutSeconds;

  assert.equal(configSchema.pluginAlias, 'Ninebot');
  assert.equal(configSchema.pluginType, 'platform');
  assert.ok(packageManifest.files.includes('config.schema.json'));
  assert.deepEqual(timeout, {
    title: '请求超时（秒）',
    type: 'integer',
    default: 30,
    minimum: 3,
    maximum: 120,
    description: '单次访问 Ninebot Proxy 的最长等待时间。网络较慢或代理首次唤醒时，建议设为 30–60 秒。',
  });
});
