# Yike Handwriting Web 字体说明

`public/fonts/YikeHandwritingWeb-Regular.woff2` 是基于官方 `LXGWWenKaiGBScreen.ttf v1.522` 制作的网页字符子集，继续采用 SIL Open Font License 1.1。

- 上游项目：https://github.com/lxgw/LxgwWenKai-Screen
- 上游发布：https://github.com/lxgw/LxgwWenKai-Screen/releases/tag/v1.522
- 上游文件 SHA-256：`23ec023913e1851925eb94462c4b0ccd1d78bb89533745aaa8cc682ccd339dc0`
- 修改内容：保留 GB2312 常用中文、宜刻页面字符和基础拉丁字符；转换为 WOFF2；内部字体家族名改为 `Yike Handwriting Web`，不使用上游保留名称。
- 构建脚本：`scripts/build-yike-webfont.py`

完整许可文本见 `OFL.txt`。
