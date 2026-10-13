# 同声传译（手机网页版，支持多家 AI）

在 iPhone Safari / 安卓 Chrome 里打开就能用的同声传译工具：

- 🎙 **麦克风持续识别**：使用浏览器内置语音识别，边说边出字
- 🔁 **逐句翻译**：每句话说完约 1～2 秒出译文，**原文与译文并排保留**（可切换 双语 / 仅译文 / 仅原文）
- 🤖 **多家 AI 可选**：Claude、DeepSeek、通义千问、Kimi、智谱 GLM、豆包；**翻译和总结可分别选择**（默认翻译用 DeepSeek，总结用 Claude）
- 📝 **一键总结**：概要、要点、结论/决定、待办事项、关键术语对照
- 🗂 **历史会议**：每场会议自动保存在本机浏览器，可回看、继续记录、删除
- 📚 会议主题 / 术语表、朗读译文、导出 Markdown、添加到主屏幕

## 开始使用

### 1. 部署链接（GitHub Pages）

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**
2. 把代码合并到 `main` 分支，Actions 会自动部署 `public/` 目录
3. 手机 Safari 打开 `https://<用户名>.github.io/<仓库名>/`，可"分享 → 添加到主屏幕"

> 私有仓库使用 GitHub Pages 需要付费计划；也可把 `public/` 放到 Netlify、Cloudflare Pages 等任意静态托管。

### 2. 填写 API Key

首次打开会弹出设置：

1. 选择「翻译使用」和「总结使用」的 AI
2. 在对应 AI 的卡片里填 API Key（点「获取 Key」直达各家控制台），模型名可留空用默认值
3. 点「测试连接」，显示「可用 ✓」即可；保存

Key 只保存在本机浏览器里，直接发送给对应 AI 服务。

| AI | 默认模型 | 默认接口地址 | 说明 |
| --- | --- | --- | --- |
| Claude | claude-opus-5-5 | api.anthropic.com | 可选 Sonnet 5.5 / Haiku 5.5 |
| DeepSeek | deepseek-chat | api.deepseek.com | 便宜快速，适合逐句翻译 |
| 通义千问 | qwen-plus | dashscope-intl（国际站） | 国内账号改为 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Kimi | moonshot-v1-32k | api.moonshot.ai（国际站） | 国内账号改为 `https://api.moonshot.cn/v1` |
| 智谱 GLM | glm-4-flash | open.bigmodel.cn | Z.ai 国际账号改为 `https://api.z.ai/api/paas/v4` |
| 豆包 | （需填写） | 火山方舟北京 | 模型处填方舟控制台的模型 ID 或接入点 ID（ep-…）；BytePlus 用 `https://ark.ap-southeast.bytepluses.com/api/v3` |

各家模型名会更新，如测试提示"找不到该模型"，到对应控制台复制最新模型名填入即可。接口地址在卡片的「高级」里修改。

### 3.（可选）某家「测试连接」显示无法连接时：部署免费中转

部分 AI 服务不允许网页直接调用（浏览器跨域限制）。用 Cloudflare 免费部署一个中转即可：

1. 注册并登录 [Cloudflare](https://dash.cloudflare.com/)（免费）
2. 左侧 **Workers & Pages → Create → Create Worker**，名字随意，点 **Deploy**
3. 点 **Edit code**，删掉默认代码，粘贴本仓库 [`relay/worker.js`](relay/worker.js) 的全部内容，点 **Deploy**
4. 复制 Worker 地址（形如 `https://xxx.你的子域.workers.dev`）
5. 回到网页 **设置 → 中转** 填入该地址，在连不上的 AI 卡片「高级」里勾选 **通过中转**，再点「测试连接」

建议在 Worker 的 **Settings → Variables** 添加变量 `ALLOW_ORIGIN`，值为你的网页地址（如 `https://用户名.github.io`），这样只有你的网页能使用这个中转。中转只转发请求，不保存任何内容；只允许访问上述 AI 服务的域名。

## 浏览器支持

| 系统 | 推荐浏览器 |
| --- | --- |
| iPhone / iPad | Safari（iOS 14.5+） |
| Android | Chrome |

微信等 App 内置浏览器通常不支持语音识别。首次点麦克风时请允许麦克风权限；被拒绝后可在 设置 → Safari → 麦克风 中修改。不支持语音识别时也可以在底部输入框打字翻译。

## 文件结构

```
public/                  网页（纯静态，可直接托管）
  index.html
  app.js                 语音识别、调用 AI、总结、历史、导出
  providers.js           各家 AI 的默认接口地址和模型
  style.css
relay/worker.js          可选：Cloudflare Worker 中转
claude-app/              Claude 会员版（在 Claude App 中以 Artifact 使用，键盘听写输入）
.github/workflows/pages.yml   GitHub Pages 自动部署
```
