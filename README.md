# SnowLuma ↔ DeepSeek QQ Bridge

一个独立的轻量 QQ 文字桥接程序：从 [SnowLuma](https://github.com/SnowLuma/SnowLuma) 的 OneBot v11 WebSocket 接收消息，通过 [DeepSeek API](https://api-docs.deepseek.com/) 生成回复，再经 OneBot HTTP API 发送。不依赖 DSH，也不打包 SnowLuma。

支持白名单私聊、群内 @／引用即时回复、群内 SDR 低频主动接话，以及按群学习简短的表达风格。所有消息目标都来自收到的 OneBot 事件；模型只能生成文本，不能自行指定 QQ 收件人。

## 准备与启动

需要 Node.js **22.13+**、单独安装并运行的 SnowLuma、已接入 SnowLuma 的 QQ 账号，以及你自己的 DeepSeek API Key。先在 SnowLuma WebUI 开启 OneBot v11 HTTP 服务端和 WebSocket 服务端，记下各自地址与 token；两种服务的 token 可能不同。

在本项目目录运行：

```powershell
npm ci
Copy-Item config.example.json config.json
```

编辑**本机的** `config.json`：

- `deepseek.apiKey`：填入自己的 Key。此后启动无需反复输入；也可以留空，改用环境变量 `DEEPSEEK_API_KEY`。环境变量优先。
- `snowluma.wsUrl`、`snowluma.httpUrl`、`wsToken`、`httpToken`：填写 SnowLuma 的 OneBot 服务配置。
- `allow.private`、`allow.groups`：只填允许使用机器人的 QQ 号／群号，均用字符串（把示例中的空数组改为你自己的号码）。两个数组都为空时程序拒绝启动。
- `deepseek.proxyUrl`：默认空字符串；如需要本机 HTTP 代理，可填 `"http://127.0.0.1:7897"`。代理只用于访问 DeepSeek，本机 SnowLuma 连接不走代理。

然后运行：

```powershell
npm test
npm start
```

看到“已连接 SnowLuma WebSocket”表示消息入口已连通。可以先用白名单私聊测试，再在白名单群里 @ 机器人测试。修改 `config.json` 后需重启程序；修改 SDR 示例文件后，下一次扫描会自动读取。请勿同时运行其他会回复同一账号消息的桥接程序。

`config.json`、`.env`、`state/`、本地 SDR 标注文件和 `node_modules/` 均被 `.gitignore` 排除。**不要把真实 Key、SnowLuma token、QQ 号或聊天状态复制进示例配置或 README。** 已提交到 Git 历史的秘密不会因为后来加上 `.gitignore` 而消失。

## SDR：什么时候主动接话

SDR 是 **suitable degree of responsing**，这里表示“这条普通群消息适不适合机器人主动接话”的 0–100 整数分。它用来降低机器人在群里的存在密度：通常先观察对话，只在话题明显升温时插入一句。它不是消息质量评分，也不决定 @／引用的即时回复。

每个白名单群每 **60 秒**扫描一次上次成功扫描以来的新消息；若超过 20 条，只评最新 20 条，否则评全部新消息。一次扫描把这些消息和最近上下文批量交给 DeepSeek 评分，避免逐条调用。普通消息的连续三条 SDR 记作 `a、b、c`，只有同时满足以下条件，第三条才成为自动回复候选：

```text
a > 0
b ≥ 1.3 × a
c ≥ 1.3 × b
```

例如 `30 → 40 → 52` 满足条件。三连可以跨越两次扫描；如果一轮有多个候选，最多只回复**第三条 SDR 最高**的一个。机器人被 @、被引用或遇到非文字消息时，会打断普通消息的连续性；@／引用本身仍会立即回复。普通自动回复的目标占比约 **5%**，这是观察和校准目标，**不是硬上限或保证值**，实际频率取决于群聊内容和模型评分。

可将 `sdr-examples.example.json` 复制成私有的 `sdr-examples.json`，按你所在群的习惯调整示例分数。每项格式为 `{ "message": "群里的一句话", "score": 65 }`；程序最多读取前 30 条。若文件不存在，仍可运行，只是不使用自定义示例。评分和生成回复都会消耗 DeepSeek API 额度。

## 群聊风格与数据

每个群单独维护最近聊天和风格概况。最近 20 条里至少有 6 条普通文字、来自至少 2 位群友时，SDR 评分请求会顺带总结群体的语气、句长、表情和玩笑频率；因此不增加独立的模型请求。普通接话和 @／引用回复都会参考最近上下文，逐渐贴近群里的表达习惯，但不冒充具体群友、不照搬私人内容。私聊不使用群风格。

程序会将白名单会话的相关文字、近期群上下文以及启用的 SDR 示例发送给 DeepSeek。`state/messages.json` 在本机保存有限的对话历史、群消息和去重状态，可能含私人内容；请自行保护或删除它。图片、语音等非文字内容不会交给模型生成回复。首次在群里启用前，请考虑告知群成员消息将由云端模型处理。

## 许可与致谢

本仓库的桥接代码采用 [MIT 许可证](LICENSE)，受到 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) 的启发；详情见 [第三方声明](THIRD_PARTY_NOTICES.md)。SnowLuma 是需单独安装的第三方程序，采用自己的[源码可见、非商业许可](https://github.com/SnowLuma/SnowLuma/blob/main/LICENSE)，**不受本仓库 MIT 许可证覆盖**。本项目与腾讯、QQ、SnowLuma 和 DeepSeek 均无官方关联。
