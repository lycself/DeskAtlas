# DeskAtlas

DeskAtlas 是部署在内网的研究生工位可视化、申请与管理平台。学生无需账号即可查看已发布房间、切换平面图或列表并申请空位；唯一管理员负责审批、直接分配、移动工位、编辑平面图、导入旧 Excel、维护教研中心和配置 SMTP。

## 技术结构

- Next.js 16 + TypeScript：学生端和管理员端
- FastAPI + Python 3.11：业务 API
- PostgreSQL：房间、工位、申请、分配历史、设置与审计
- React Konva：非 CAD 的拖放式工位图编辑器
- pnpm：唯一 JavaScript 包管理器，`pnpm dev` 统一管理本地数据库与前后端

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

将输出填入 `ADMIN_PASSWORD_HASH`。本机已有 Homebrew PostgreSQL 17 和项目数据库时，日常开发只需：

```bash
pnpm dev
```

脚本读取 `.env`，自动启动本机 `5432` 端口的 PostgreSQL，确认数据库和 API 就绪后启动前端。在同一个终端按 `Ctrl+C`，前端、后端及本次启动的数据库会一起关闭，数据保留。启动失败时也会清理已启动的服务；重复运行会提示先关闭已有进程。

默认识别 Apple Silicon / Intel Mac 的 Homebrew PostgreSQL 17。其他安装位置可通过环境变量 `DESKATLAS_PGDATA` 和 `DESKATLAS_PG_CTL` 指定已有数据目录和 `pg_ctl` 路径。脚本不会初始化或覆盖数据库；启动前已经运行的数据库、外部数据库会复用，退出时保留。

如果没有现成 PostgreSQL，可以启动项目自带的 Docker 开发数据库（需要先启动 Docker，主机端口为 `55432`，此时同步修改 `.env` 中的端口；该方式的数据库仍由 `pnpm db:up` / `pnpm db:down` 单独管理）：

```bash
pnpm db:up
```

首次配置数据库或更新数据库结构后，需要在数据库运行时执行 `pnpm db:migrate`。Docker 方式的启动顺序为：

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

1. 在“房间与工位”中创建房间、填写所属教研中心，切换“编辑布局”添加工位或批量生成矩阵，保存草稿并发布。
2. 在“教研中心与设置”中配置 SMTP，并先发送测试邮件。
3. 学生提交申请后，座位显示为黄色“审核中”，其他人不能申请。
4. 管理员可以修正申请信息；同意后创建正式分配，拒绝原因可以为空。
5. 旧表在“数据导入”中先预览。颜色会被忽略，缺少学号和邮箱的占用者标记为“信息待补全”。

### 在平面图上操作

“房间与工位”默认进入“工位管理”：点击已占用工位，在右侧直接编辑学生资料、移动或释放工位；点击空位，可搜索未分配学生并分配，也可录入新学生。移动时点击目标空位再确认，支持先切换房间，也可移至“翔安”或“未被分配”。虚拟分组在管理员端和学生端均按教研组显示独立虚拟位置，也可切换列表；管理员点击虚拟位置可管理学生。学生端点击已占用工位或虚拟位置时，在当前位置弹出学生资料。

“编辑布局”提供独立绘图工具：拖动空白区域框选，或按 Shift 点击多选，再使用六种边缘／中心对齐、水平／垂直等距分布。可添加横墙和竖墙；墙体可选中、拖动、调整坐标和尺寸、复制或移除。拖动支持可开关的网格吸附与邻近元素对齐参考线；方向键微调 1 px，Shift + 方向键移动 12 px。右侧可输入坐标及尺寸，离开输入框或按 Enter 生效。工具栏有“撤销”“重做”“撤销所有修改”和“取消修改”；Ctrl / ⌘ Z 撤销，Ctrl / ⌘ Shift Z 重做。“撤销所有修改”恢复到上次保存的草稿；“取消修改”放弃所有未发布的布局修改（包括已保存草稿）、恢复到已发布布局，并返回工位管理，无需再次发布。有学生或待审批申请的工位需先处理人员再移除。布局保存为草稿后，发布才更新学生端的图形位置；人员调整保存后立即生效。

### 最新安排同步

以 `最新安排/` 中的四份 Excel 为准：学生信息用于学号、导师、年级和培养层次；教师人员名单用于教研中心与教师资料；用房汇总表和布局图用于房间归属和座位安排。学生邮箱始终由学号生成 `学号@stu.xmu.edu.cn`，忽略 Excel 邮箱。内部 API 的 `major_id` / `major_names` 字段保留以兼容原数据，对外统一显示“教研中心”。

```bash
pnpm db:migrate
.venv/bin/python scripts/import_latest_arrangement.py
.venv/bin/python scripts/import_latest_arrangement.py --apply
```

脚本在写入前创建 PostgreSQL 完整备份，预览与结果保存在 `uploads/latest-import/`，原 Excel 不修改。同步以学号建档，同名时结合导师与年级确认；未匹配人员保留座位并标记资料待补全。旧分配保留历史，未出现在最新名单或座位表中的旧人员归档。存在待审批申请时停止同步。同一批文件重复导入不会覆盖后续管理操作。

“翔安”和“未被分配”为系统虚拟工位分组，可容纳多名学生，不计入实际房间及工位统计，也不开放工位申请。最新名单中没有座位的学生、新录入且未选择工位的学生、释放实际工位的学生自动进入“未被分配”。管理员在“学生与工位”中筛选分组并调整去向；学生端的位置图按教研组显示人员，无人分组也显示不可申请的示意位置。虚拟分组里的学生可正常申请实际空位。

若同一学生在汇总表有多个工位，默认将学生放在“未被分配”，对应座位保留待核对；确认后可通过 `--seat-override 学号=房间/座位号` 指定。布局图的缺号、重号不猜测位置，显示在“位置待核对”区域。

在“教研中心与设置 → 教研组教师”中新增或编辑教师，维护所属中心、职称、中心职务及启用状态。教师名册维护不会追溯修改学生历史归属；学生归属可在学生资料中修改。

旧版两表导入脚本 `scripts/import_office_survey.py` 仅适用于旧表格式。当前数据同步请使用上述最新安排脚本。

若旧数据中的 311、406、680 房间仍缺少布局图边缘墙线，运行 `.venv/bin/python scripts/repair_latest_walls.py`。脚本先备份这三间房的布局，再补全墙线，不变更工位分配。

## 备份与恢复

```bash
docker compose exec -T db pg_dump -U deskatlas -d deskatlas -Fc > deskatlas.backup
docker compose exec -T db pg_restore -U deskatlas -d deskatlas --clean --if-exists < deskatlas.backup
```

恢复前应停止写入，并先在测试数据库验证备份文件。管理员密码通过运行 `pnpm admin:set` 并输入两次新密码设置，命令直接更新项目 `.env` 中的哈希，不保存明文。随后重启 `pnpm dev`（或 API 服务）生效。`pnpm admin:hash` 仅打印哈希，不修改配置。

## 验证

```bash
pnpm check
pnpm build
```

完整任务计划位于 `ticketly/backlog.md`，可执行清单位于 `ticketly/tasks.md`。
