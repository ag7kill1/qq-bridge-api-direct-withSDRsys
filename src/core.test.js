import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMessage, parseMessage, responseText } from './core.js';

const allow = { allow: { private: ['11'], groups: ['22'] } };
const text = (value) => ({ type: 'text', data: { text: value } });
const group = (message, extra = {}) => ({ post_type: 'message', message_type: 'group', user_id: 11, group_id: 22, message, ...extra });

test('private whitelist and self-message checks', async () => {
  const event = { post_type: 'message', message_type: 'private', user_id: 11, message: [text('你好')] };
  assert.equal((await classifyMessage(event, allow, '99')).text, '你好');
  assert.equal(await classifyMessage({ ...event, user_id: 12 }, allow, '99'), null);
  assert.equal(await classifyMessage({ ...event, user_id: 99 }, allow, '99'), null);
});

test('groups only respond to @self or a reply to self', async () => {
  assert.equal(await classifyMessage(group([text('闲聊')]), allow, '99'), null);
  assert.equal((await classifyMessage(group([{ type: 'at', data: { qq: '99' } }, text(' 你好 ') ]), allow, '99')).text, '你好');
  const reply = group([{ type: 'reply', data: { id: -7 } }, text('接着说')]);
  assert.equal(await classifyMessage(reply, allow, '99', async () => false), null);
  assert.equal((await classifyMessage(reply, allow, '99', async (id) => id === '-7')).text, '接着说');
  assert.equal(await classifyMessage(group([text('你好')], { group_id: 23 }), allow, '99'), null);
});

test('ignores media-only content and strips CQ codes in string form', async () => {
  assert.equal(await classifyMessage(group([{ type: 'at', data: { qq: '99' } }, { type: 'image', data: { file: 'x' } }]), allow, '99'), null);
  assert.deepEqual(parseMessage('[CQ:reply,id=-7][CQ:at,qq=99] 你好', '99'), { text: '你好', mentioned: true, replyId: '-7' });
  assert.equal(responseText('你好世界', 3), '你好…');
});
