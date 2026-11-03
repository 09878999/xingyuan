# 本地运营看板

## 启动

```powershell
cd StarMemory-XHS
node dashboard/server.js
```

打开：<http://127.0.0.1:4173>

服务只监听 `127.0.0.1`，不向局域网或公网开放。

## 功能

- 运营总览：待制作、待审核、已发布、作品数量、咨询、订单；
- 内容管理：筛选、搜索、读取完整草稿、人工审核状态流转、从看板删除；
- 内容日历：30 天计划视图，计划时间不等于发布时间；
- 产品管理：测试价、状态、咨询/报价/订单、真实反馈；
- 数据分析：真实发布数据与商业漏斗；
- 运营复盘：汇总本地真实数据并生成周报 Markdown；
- 导出：下载看板 JSON 快照。

## 数据文件

- `dashboard/data/dashboard.json`：看板主数据；
- `analytics/weekly-review-YYYY-Www.md`：生成的周报；
- 写入采用临时文件 + rename，降低半写入风险。

测试使用系统临时目录中的副本：

```powershell
node tests/validate-project.js
node tests/test-dashboard.js
node tests/test-ui.js
node tests/test-browser-interactions.js
```

## 安全边界

- 不保存账号密码、Cookie 或验证码；
- 不自动发布、不自动点赞/关注/评论/私信；
- 直接标记“已发布”会被拒绝，必须先录入真实发布日期、链接与指标；
- 删除只移除看板记录并写入 `notesArchive`，保留 Markdown 草稿文件；已发布或有真实数据的笔记不能删除；
- 数据缺失时拒绝写入，不用默认值/估算值补全；
- 所有重要操作仍需人工确认。
