import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function waitFor(predicate, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待超时：${description}`);
}

test('本地模拟 SnowLuma 与模型接口：群 @ 触发一次回复，普通消息与重复事件静默', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bridge-test-'));
  const requests = [];
  let modelFailure = false;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push({ path: request.url, body, authorization: request.headers.authorization });
    if (request.url === '/chat/completions' && modelFailure) {
      response.writeHead(502);
      response.end('upstream error');
      return;
    }
    const data = request.url === '/get_login_info'
      ? { status: 'ok', retcode: 0, data: { user_id: 99 } }
      : request.url === '/chat/completions'
        ? { choices: [{ message: { content: '你好呀' } }] }
        : { status: 'ok', retcode: 0, data: { message_id: 456 } };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(data));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const httpPort = server.address().port;
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(wss, 'listening');
  const wsPort = wss.address().port;
  let peer;
  let wsAuthorization;
  wss.on('connection', (socket, request) => { peer = socket; wsAuthorization = request.headers.authorization; });

  const configPath = path.join(temporary, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    snowluma: { httpUrl: `http://127.0.0.1:${httpPort}`, wsUrl: `ws://127.0.0.1:${wsPort}`, httpToken: 'http-test-token', wsToken: 'ws-test-token' },
    deepseek: { apiKey: 'local-test-key', apiUrl: `http://127.0.0.1:${httpPort}/chat/completions`, proxyUrl: '', model: 'deepseek-flash' },
    allow: { private: ['11'], groups: ['22'] },
    historyMessages: 0,
    maxReplyChars: 1200
  }));
  const childEnv = {
    ...process.env,
    QQ_BRIDGE_CONFIG_PATH: configPath,
    QQ_BRIDGE_STATE_PATH: path.join(temporary, 'state.json')
  };
  delete childEnv.DEEPSEEK_API_KEY;
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: root,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    child.kill();
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => wss.close(resolve));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  });

  await waitFor(() => peer && output.includes('已连接 SnowLuma WebSocket'), `网关连接；输出：${output}`);
  assert.equal(wsAuthorization, 'Bearer ws-test-token');
  assert.equal(requests.find((item) => item.path === '/get_login_info').authorization, 'Bearer http-test-token');
  const base = { post_type: 'message', message_type: 'group', group_id: 22, user_id: 11 };
  peer.send(JSON.stringify({ ...base, message_id: 101, message: '普通群消息' }));
  peer.send(JSON.stringify({
    ...base,
    message_id: 102,
    message: [{ type: 'at', data: { qq: '99' } }, { type: 'text', data: { text: ' 你好' } }]
  }));
  await waitFor(() => requests.find((item) => item.path === '/send_group_msg'), `群回复；输出：${output}`);
  peer.send(JSON.stringify({
    ...base,
    message_id: 102,
    message: [{ type: 'at', data: { qq: '99' } }, { type: 'text', data: { text: ' 你好' } }]
  }));
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(requests.filter((item) => item.path === '/chat/completions').length, 1);
  assert.equal(requests.find((item) => item.path === '/chat/completions').authorization, 'Bearer local-test-key');
  const sent = requests.filter((item) => item.path === '/send_group_msg');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].authorization, 'Bearer http-test-token');
  assert.equal(sent[0].body.group_id, 22);
  assert.deepEqual(sent[0].body.message, [
    { type: 'reply', data: { id: 102 } },
    { type: 'text', data: { text: '你好呀' } }
  ]);
  const state = JSON.parse(fs.readFileSync(path.join(temporary, 'state.json'), 'utf8'));
  assert.deepEqual(state.history['group:22'], []);

  const firstPeer = peer;
  firstPeer.close();
  await waitFor(() => peer !== firstPeer && peer?.readyState === 1, `WebSocket 重连；输出：${output}`);
  peer.send(JSON.stringify({ ...base, message_id: 103, message: [
    { type: 'at', data: { qq: '99' } }, { type: 'text', data: { text: ' 重连后测试' } }
  ] }));
  await waitFor(() => requests.filter((item) => item.path === '/send_group_msg').length === 2, `重连后回复；输出：${output}`);
  assert.equal(requests.filter((item) => item.path === '/send_group_msg')[1].body.group_id, 22);

  modelFailure = true;
  peer.send(JSON.stringify({ ...base, message_id: 104, message: [
    { type: 'at', data: { qq: '99' } }, { type: 'text', data: { text: ' 上游异常测试' } }
  ] }));
  await waitFor(() => output.includes('DeepSeek API HTTP 502'), `模型异常；输出：${output}`);
  assert.equal(requests.filter((item) => item.path === '/send_group_msg').length, 2);
});

test('群 SDR 跨分钟三连只对第三条自动回复一次', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-sdr-test-'));
  const requests = [];
  const scoreByText = { '第一条': 40, '第二条': 52, '第三条': 68, '第四条': 50, '第五条': 50, '第六条': 50 };
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push({ path: request.url, body });
    let data;
    if (request.url === '/get_login_info') data = { status: 'ok', retcode: 0, data: { user_id: 99 } };
    else if (request.url === '/chat/completions' && body.response_format) {
      const targets = JSON.parse(body.messages[1].content).targets;
      data = { choices: [{ message: { content: JSON.stringify({
        scores: targets.map((target) => ({ index: target.index, score: scoreByText[target.text] })),
        style: { tone: '轻松', length: '短句', emoji: '少', humor: '适中', phrases: ['哈哈'] }
      }) } }] };
    } else if (request.url === '/chat/completions') data = { choices: [{ message: { content: '我来接话' } }] };
    else data = { status: 'ok', retcode: 0, data: { message_id: 400 } };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(data));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const httpPort = server.address().port;
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(wss, 'listening');
  const wsPort = wss.address().port;
  let peer;
  wss.on('connection', (socket) => { peer = socket; });
  const configPath = path.join(temporary, 'config.json');
  const statePath = path.join(temporary, 'state.json');
  fs.writeFileSync(configPath, JSON.stringify({
    snowluma: { httpUrl: `http://127.0.0.1:${httpPort}`, wsUrl: `ws://127.0.0.1:${wsPort}` },
    deepseek: { apiUrl: `http://127.0.0.1:${httpPort}/chat/completions`, proxyUrl: '', model: 'deepseek-flash' },
    allow: { private: [], groups: ['22', '23'] },
    groupSdr: { scanIntervalMs: 120 }
  }));
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      QQ_BRIDGE_CONFIG_PATH: configPath,
      QQ_BRIDGE_STATE_PATH: statePath,
      DEEPSEEK_API_KEY: 'local-test-key'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    child.kill();
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => wss.close(resolve));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  await waitFor(() => peer && output.includes('已连接 SnowLuma WebSocket'), `网关连接；输出：${output}`);
  const send = (messageId, value, userId = 11) => peer.send(JSON.stringify({
    post_type: 'message', message_type: 'group', group_id: 22, user_id: userId, message_id: messageId,
    message: [{ type: 'text', data: { text: value } }]
  }));
  send(301, '第一条');
  send(302, '第二条');
  await waitFor(() => {
    if (!fs.existsSync(statePath)) return false;
    const group = JSON.parse(fs.readFileSync(statePath, 'utf8')).groups?.['group:22'];
    return group?.tail?.length === 2 && group.pending.length === 0;
  }, `第一轮 SDR 扫描；输出：${output}`);
  send(303, '第三条');
  await waitFor(() => requests.some((request) => request.path === '/send_group_msg'), `第二轮回复；输出：${output}`);
  const sent = requests.filter((request) => request.path === '/send_group_msg');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.message[0].data.id, 303);
  assert.equal(requests.filter((request) => request.path === '/chat/completions' && request.body.response_format).length, 2);
  assert.equal(requests.filter((request) => request.path === '/chat/completions' && !request.body.response_format).length, 1);
  send(304, '第四条', 12);
  send(305, '第五条', 12);
  send(306, '第六条', 12);
  await waitFor(() => {
    const group = JSON.parse(fs.readFileSync(statePath, 'utf8')).groups?.['group:22'];
    return group?.style?.tone === '轻松' && group.pending.length === 0;
  }, `群风格学习；输出：${output}`);
  peer.send(JSON.stringify({
    post_type: 'message', message_type: 'group', group_id: 22, user_id: 11, message_id: 307,
    message: [{ type: 'at', data: { qq: '99' } }, { type: 'text', data: { text: ' 你好' } }]
  }));
  await waitFor(() => requests.filter((request) => request.path === '/chat/completions' && !request.body.response_format).length === 2,
    `群 @ 使用风格；输出：${output}`);
  const directPrompt = requests.filter((request) => request.path === '/chat/completions' && !request.body.response_format)[1].body.messages.at(-1).content;
  assert.match(directPrompt, /这个群近期的表达习惯：语气轻松，句子短句/);
  assert.match(directPrompt, /最近群聊/);

  peer.send(JSON.stringify({
    post_type: 'message', message_type: 'group', group_id: 23, user_id: 11, message_id: 308,
    message: [{ type: 'at', data: { qq: '99' } }, { type: 'text', data: { text: ' 另一个群' } }]
  }));
  await waitFor(() => requests.filter((request) => request.path === '/chat/completions' && !request.body.response_format).length === 3,
    `另一群回复；输出：${output}`);
  const otherPrompt = requests.filter((request) => request.path === '/chat/completions' && !request.body.response_format)[2].body.messages.at(-1).content;
  assert.doesNotMatch(otherPrompt, /这个群近期的表达习惯：语气轻松/);
  await waitFor(() => requests.some((request) => request.path === '/send_group_msg' && request.body.group_id === 23),
    `另一群发送目标；输出：${output}`);
});
