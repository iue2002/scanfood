# 通知音色（M3）

后端 `notif-pref/sound-catalog.ts` 默认指向 `/sounds/<id>.mp3`。请在此目录放置以下文件：

- `default.mp3`（必需 — 默认音色，所有降级路径都会回退到它）
- `ding.mp3`
- `bell.mp3`
- `chime.mp3`
- `alert.mp3`

## 推荐做法

生产环境建议把这些音频放到 TOS 对象存储，然后在 `server/.env` 配置：

```
NOTIF_SOUND_BASE_URL=https://your-tos-bucket.example.com/sounds/
```

后端 `BUILTIN_SOUND_ENTRIES` 会自动用 TOS URL 拼接，前端不需要改。

## 文件来源

可使用任意自有音频或 CC0 / 商用免费的提示音库。每段时长建议 0.5–2.5 秒，音量已归一化。
