import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function startWith(config) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bridge-config-test-'));
  const configPath = path.join(temporary, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const env = { ...process.env, QQ_BRIDGE_CONFIG_PATH: configPath };
  delete env.DEEPSEEK_API_KEY;
  try {
    return spawnSync(process.execPath, ['src/index.js'], {
      cwd: root, env, encoding: 'utf8', timeout: 3000
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test('启动前拒绝缺少 Key、空白名单和旧版 DSH 配置', () => {
  const base = { deepseek: { apiKey: 'local-test-key' }, allow: { private: ['11'], groups: [] } };
  const missingKey = startWith({ ...base, deepseek: { apiKey: '' } });
  assert.equal(missingKey.status, 1);
  assert.match(missingKey.stderr, /deepseek\.apiKey/);

  const openWhitelist = startWith({ ...base, allow: { private: [], groups: [] } });
  assert.equal(openWhitelist.status, 1);
  assert.match(openWhitelist.stderr, /空白名单不会开放全部聊天/);

  const legacy = startWith({ ...base, dsh: { url: 'http://127.0.0.1:3080' } });
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /检测到旧版 DSH/);

  const malformed = startWith(null);
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /须为 JSON 对象/);
});
