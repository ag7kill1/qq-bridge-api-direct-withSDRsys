export function scanBatch(pending, limit = 20) {
  const overflow = pending.length > limit;
  return { messages: pending.slice(-limit), overflow };
}

export function parseSdrScores(content, messages) {
  let parsed;
  try { parsed = JSON.parse(content); }
  catch { throw new Error('SDR 模型没有返回有效 JSON'); }
  if (!Array.isArray(parsed?.scores)) throw new Error('SDR 模型没有返回 scores 数组');
  const expected = messages.flatMap((message, index) => message.text && !message.direct ? [index] : []);
  const scores = new Map();
  for (const item of parsed.scores) {
    const index = item?.index;
    const score = item?.score;
    if (!Number.isInteger(index) || !expected.includes(index) || scores.has(index) ||
        !Number.isInteger(score) || score < 0 || score > 100) {
      throw new Error('SDR 模型返回了无效的消息编号或分数');
    }
    scores.set(index, score);
  }
  if (scores.size !== expected.length) throw new Error('SDR 模型漏评了消息');
  return scores;
}

export function pickSdrReply(previous, messages, scores, growth = 1.3) {
  const current = messages.map((message, index) => ({
    ...message,
    score: message.text && !message.direct ? scores.get(index) : null,
    current: true
  }));
  const chain = [...previous.map((message) => ({ ...message, current: false })), ...current];
  let winner = null;
  for (let index = 2; index < chain.length; index++) {
    const [first, second, third] = chain.slice(index - 2, index + 1);
    if (!third.current || first.score == null || second.score == null || third.score == null) continue;
    if (first.score <= 0 || second.score < first.score * growth || third.score < second.score * growth) continue;
    if (!winner || third.score > winner.score || (third.score === winner.score && index > winner.index)) {
      winner = { message: third, score: third.score, index };
    }
  }
  return {
    reply: winner?.message ?? null,
    tail: chain.slice(-2).map(({ current, ...message }) => message)
  };
}
