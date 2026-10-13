# Claude 同声传译（手机网页版）

一个在手机浏览器里直接打开就能用的同声传译工具，由 Claude 提供翻译与总结：

- 🎙 **实时语音识别**：使用手机浏览器内置语音识别，边说边出字
- 🔁 **逐句同声传译**：每句话流式翻译，**原文与译文并排保留**（可切换 双语 / 仅译文 / 仅原文）
- 📝 **一键总结**：概要、要点、结论/决定、待办事项、关键术语对照，可选总结语言
- 📚 **会议主题 / 术语表**：提前填写，让专业名词翻译更准确
- 🔊 可选朗读译文、⤓ 导出 Markdown（含总结 + 全部原文译文）、记录自动保存在本机
- 📱 可"添加到主屏幕"，像 App 一样使用；录音时保持屏幕常亮
- 支持中、英、日、韩、法、德、西、俄、葡、意、阿、泰、越、印尼、粤语等

## 使用方式

### 方式一：GitHub Pages 链接（最简单，每人用自己的 API Key）

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**
2. 把代码合并到 `main` 分支，Actions 会自动部署 `public/` 目录
3. 手机打开 `https://<你的用户名>.github.io/<仓库名>/`
4. 首次打开在设置里填入 [Anthropic API Key](https://console.anthropic.com/)（只保存在本机浏览器，直接发往 api.anthropic.com）

> 私有仓库使用 GitHub Pages 需要付费计划；也可以把 `public/` 目录放到任何静态网站托管（Netlify、Vercel、Cloudflare Pages 等）。

### 方式二：自己的服务器（API Key 保存在服务器，适合分享给团队）

需要 Node.js 18+，无任何第三方依赖：

```bash
ANTHROPIC_API_KEY=sk-ant-xxx APP_PASSWORD=设置一个访问密码 npm start
# 默认端口 3000，可用 PORT 修改
```

服务器会提供网页并代理 Claude API 请求，使用者只需输入访问密码，看不到 API Key。
可部署到 Render、Railway、Fly.io、云服务器等。**语音识别要求 HTTPS**（localhost 除外），请在 HTTPS 域名下使用。

## 手机浏览器支持

| 系统 | 推荐浏览器 |
| --- | --- |
| Android | Chrome |
| iOS / iPadOS | Safari（iOS 14.5+） |

微信等 App 内置浏览器通常不支持语音识别，请点右上角"在浏览器中打开"。不支持语音识别时也可以在底部输入框直接打字翻译。

## 模型

设置中可选择：

- **Claude Opus 5.5**（默认，最准确）
- **Claude Sonnet 5.5**（速度与质量均衡）
- **Claude Haiku 5.5**（最快、最便宜，适合长时间会议）

翻译使用低推理强度以降低延迟，总结使用中等强度；Opus / Sonnet 启用了服务端拒答自动回退。

## 文件结构

```
public/            前端（纯静态，可直接托管）
  index.html
  app.js           语音识别、Claude 调用、总结、导出
  style.css
server.js          可选：静态服务 + Claude API 代理（隐藏 API Key、访问密码）
.github/workflows/pages.yml   GitHub Pages 自动部署
```
