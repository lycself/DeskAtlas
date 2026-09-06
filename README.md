# DeskAtlas

DeskAtlas 是部署在内网的研究生工位可视化、申请与管理平台。学生无需账号即可查看已发布房间、切换平面图或列表并申请空位；唯一管理员负责审批、直接分配、移动工位、编辑平面图、导入旧 Excel、维护专业和配置 SMTP。

## 技术结构

- Next.js 16 + TypeScript：学生端和管理员端
- FastAPI + Python 3.11：业务 API
- PostgreSQL：房间、工位、申请、分配历史、设置与审计
- React Konva：非 CAD 的拖放式工位图编辑器
- pnpm：唯一 JavaScript 包管理器，`pnpm dev` 同时启动前后端

## 本地运行

项目已经使用 Conda 环境 `py311` 创建根目录 `.venv`。在其他机器重新创建时运行：

```bash
conda run -n py311 python -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
pnpm install
```

复制并填写 `.env`，尤其要把 `DATABASE_URL` 指向准备好的 PostgreSQL。管理员密码必须先生成 Argon2 哈希：

```bash
pnpm admin:hash
```

将输出填入 `ADMIN_PASSWORD_HASH`。如果没有现成 PostgreSQL，可以启动项目自带的开发数据库（主机端口为 `55432`，此时同步修改 `.env` 中的端口）：

```bash
pnpm db:up
```

完成数据库配置后运行迁移并启动应用：

```bash
pnpm db:migrate
pnpm dev
```

- 学生端：http://localhost:3000
- 管理端：http://localhost:3000/admin/login
- FastAPI 文档：http://127.0.0.1:8000/docs

## 内网部署

既可以连接内网已有 PostgreSQL，也可以使用 Compose 内置数据库。先将 `.env` 中的 `POSTGRES_PASSWORD`、管理员密码哈希、会话密钥、配置加密密钥和 `PUBLIC_ORIGIN` 改为正式值，然后运行：

```bash
docker compose up -d --build
```

生产环境应在 `web` 服务前配置校内 HTTPS 反向代理。内网并不等同于可信网络，管理员登录和包含学生姓名的页面仍应使用 HTTPS。

## 日常管理

1. 在“房间与平面图”中创建房间、填写所属专业，单独添加工位或批量生成矩阵，保存草稿并发布。
2. 在“专业、邮件与日志”中配置 SMTP，并先发送测试邮件。
3. 学生提交申请后，座位显示为黄色“审核中”，其他人不能申请。
4. 管理员可以修正申请信息；同意后创建正式分配，拒绝原因可以为空。
5. 旧表在“数据导入”中先预览。颜色会被忽略，缺少学号和邮箱的占用者标记为“信息待补全”。

### 实测汇总表与工位分布图联合导入

根目录的两份实测 Excel 可通过下面的专用脚本联合导入。脚本按房间边界读取分布图中的座位与门，用“房间＋座位号”关联人员，忽略颜色；未能唯一定位的编号会放入标明“位置待核对”的区域。原始 Excel 不会修改。

```bash
.venv/bin/python scripts/import_office_survey.py
.venv/bin/python scripts/import_office_survey.py --apply
```

预览、导入结果及写入前的 PostgreSQL 完整备份保存在被 Git 忽略的 `uploads/office-import/`。默认保留平台已有占用冲突并记录备注；首次导入时，若已确认以 Excel 为准，可添加 `--replace-conflicts`，原分配会结束并保留历史。同一组源文件重复导入不会重复建档，也不会覆盖后续管理操作。分布图格式改变后，应先核对 `backend/app/office_import.py` 中的房间区域。

联合导入会将 Excel 中的粗边框保存为墙线，保留原始出入口缺口，细边框不会当作墙。对于已导入但缺少轮廓的数据，可运行 `.venv/bin/python scripts/restore_survey_walls.py` 补回墙线；该脚本先保存布局快照，不修改座位或人员分配。学生端支持缩放、适应窗口、编号/姓名切换和搜索高亮，位置不明确的工位单独列在平面图下方。

房间所属专业取自汇总表 G 列“教研中心”，包含空工位对应的专业，支持一间房多个专业；不根据当前占用人员推断。专业标签沿用分布图图例的分类颜色，学生端可按专业筛选。已有导入数据需先执行 `pnpm db:migrate`，再运行 `.venv/bin/python scripts/import_room_majors.py`，只补填尚未设置归属的房间并写入审计记录。管理员可在房间详情中维护归属。

## 备份与恢复

```bash
docker compose exec -T db pg_dump -U deskatlas -d deskatlas -Fc > deskatlas.backup
docker compose exec -T db pg_restore -U deskatlas -d deskatlas --clean --if-exists < deskatlas.backup
```

恢复前应停止写入，并先在测试数据库验证备份文件。管理员密码通过重新运行 `pnpm admin:hash`、更新 `.env` 并重启 API 服务完成轮换。

## 验证

```bash
pnpm check
pnpm build
```

完整任务计划位于 `ticketly/backlog.md`，可执行清单位于 `ticketly/tasks.md`。
