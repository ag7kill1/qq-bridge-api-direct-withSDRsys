import test from 'node:test';
import assert from 'node:assert/strict';
import { scanBatch, parseSdrScores, pickSdrReply } from './group-sdr.js';

const item = (id) => ({ messageId: String(id), sender: '11', text: `消息${id}`, direct: false });

test('扫描超过 20 条只保留最新 20 条；不足 20 条保留本轮全部新消息', () => {
  const many = scanBatch(Array.from({ length: 23 }, (_, index) => item(index)), 20);
  assert.equal(many.overflow, true);
  assert.equal(many.messages[0].messageId, '3');
  assert.deepEqual(scanBatch([item(1), item(2)], 20).messages.map((m) => m.messageId), ['1', '2']);
});

test('跨扫描三连按相对增长 30% 判定，0 分与即时回复会打断连续性', () => {
  const previous = [{ ...item(1), score: 40 }, { ...item(2), score: 52 }];
  const result = pickSdrReply(previous, [item(3)], new Map([[0, 68]]));
  assert.equal(result.reply.messageId, '3');
  assert.equal(pickSdrReply([{ ...item(1), score: 0 }, { ...item(2), score: 5 }], [item(3)], new Map([[0, 10]])).reply, null);
  assert.equal(pickSdrReply([{ ...item(1), score: 40 }, { ...item(2), score: null }], [item(3)], new Map([[0, 68]])).reply, null);
});

test('同轮多个合格三连只选第三条 SDR 最高的一组', () => {
  const messages = [item(1), item(2), item(3), item(4), item(5), item(6)];
  const scores = new Map([0, 1, 2, 3, 4, 5].map((index) => [index, [20, 30, 40, 10, 20, 70][index]]));
  assert.equal(pickSdrReply([], messages, scores).reply.messageId, '6');
});

test('SDR 响应必须完整且只包含 0–100 的整数分', () => {
  const messages = [item(1), { ...item(2), direct: true }, item(3)];
  const scores = parseSdrScores('{"scores":[{"index":0,"score":20},{"index":2,"score":40}]}', messages);
  assert.deepEqual([...scores.values()], [20, 40]);
  assert.throws(() => parseSdrScores('{"scores":[{"index":0,"score":101}]}', messages));
  assert.throws(() => parseSdrScores('{"scores":[{"index":0,"score":20}]}', messages));
});
