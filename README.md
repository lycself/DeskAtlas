# DeskAtlas

DeskAtlas 是部署在内网的研究生工位可视化、申请与管理平台。学生无需账号即可查看已发布房间、切换平面图或列表并申请空位；唯一管理员负责审批、直接分配、移动工位、编辑平面图、导入旧 Excel、维护教研中心和配置 SMTP。

## 技术结构

- Next.js 16 + TypeScript：学生端、管理员端和桌面版状态面板
- FastAPI + Python 3.11：业务 API；桌面版里同时托管静态前端
- PostgreSQL（服务器部署）或 SQLite（桌面版）：房间、工位、申请、分配历史、设置与审计
- React Konva：非 CAD 的拖放式工位图编辑器
- pnpm：唯一 JavaScript 包管理器，`pnpm dev` 统一管理本地数据库与前后端
- 桌面版：pystray 托盘 + pywebview 状态面板 + PyInstaller + Inno Setup，GitHub Actions 打 tag 即出安装包

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
2. 在“系统设置”中配置 SMTP，并先发送测试邮件。
3. 学生提交申请后，座位显示为黄色“审核中”，其他人不能申请。
4. 管理员可以修正申请信息；同意后创建正式分配，拒绝原因可以为空。
5. 旧表在“数据导入”中先预览。颜色会被忽略，缺少学号和邮箱的占用者标记为“信息待补全”。

### 在平面图上操作

“房间与工位”默认进入“工位管理”：点击已占用工位，在右侧直接编辑学生资料、移动或释放工位；点击空位，可搜索未分配学生并分配，也可录入新学生。移动时点击目标空位再确认，支持先切换房间，也可移至“翔安”或“未被分配”。虚拟分组在管理员端和学生端均按教研组显示独立虚拟位置，也可切换列表；管理员点击虚拟位置可管理学生。学生端点击已占用工位或虚拟位置时，在当前位置弹出学生资料。

“编辑布局”提供独立绘图工具：拖动空白区域框选，或按 Shift 点击多选，再使用六种边缘／中心对齐、水平／垂直等距分布。可添加横墙和竖墙；墙体可选中、拖动、调整坐标和尺寸、复制或移除。拖动支持可开关的网格吸附与邻近元素对齐参考线；方向键微调 1 px，Shift + 方向键移动 12 px。右侧可输入坐标及尺寸，离开输入框或按 Enter 生效。工具栏有“撤销”“重做”“恢复到上次保存”和“放弃草稿并退出”；Ctrl / ⌘ Z 撤销，Ctrl / ⌘ Shift Z 重做。“恢复到上次保存”丢弃本次未保存的修改并回到上次保存的草稿；“放弃草稿并退出”放弃所有未发布的布局修改（包括已保存草稿）、恢复到已发布布局，并返回工位管理，无需再次发布。有学生或待审批申请的工位需先处理人员再移除。布局保存为草稿后，发布才更新学生端的图形位置，房间列表和工作台会标出“未发布草稿”；人员调整保存后立即生效。

### 最新安排同步

以 `最新安排/` 中的四份 Excel 为准：学生信息用于学号、导师、年级和培养层次；教师人员名单用于教研中心与教师资料；用房汇总表和布局图用于房间归属和座位安排。学生邮箱始终由学号生成 `学号@stu.xmu.edu.cn`，忽略 Excel 邮箱。内部 API 的 `major_id` / `major_names` 字段保留以兼容原数据，对外统一显示“教研中心”。

```bash
pnpm db:migrate
.venv/bin/python scripts/import_latest_arrangement.py
.venv/bin/python scripts/import_latest_arrangement.py --apply
```

脚本在写入前创建 PostgreSQL 完整备份，预览与结果保存在 `uploads/latest-import/`，原 Excel 不修改。同步以学号建档，同名时结合导师与年级确认；未匹配人员保留座位并标记资料待补全。旧分配保留历史，未出现在最新名单或座位表中的旧人员归档。存在待审批申请时停止同步。同一批文件重复导入不会覆盖后续管理操作。

“翔安”和“未被分配”为系统虚拟工位分组，可容纳多名学生，不计入实际房间及工位统计，也不开放工位申请。最新名单中没有座位的学生、新录入且未选择工位的学生、释放实际工位的学生自动进入“未被分配”。管理员在“学生名册”中筛选分组并调整去向；学生端的位置图按教研组显示人员，无人分组也显示不可申请的示意位置。虚拟分组里的学生可正常申请实际空位。

若同一学生在汇总表有多个工位，默认将学生放在“未被分配”，对应座位保留待核对；确认后可通过 `--seat-override 学号=房间/座位号` 指定。布局图的缺号、重号不猜测位置，显示在“位置待核对”区域。

在“系统设置 → 教研组教师”中新增或编辑教师，维护所属中心、职称、中心职务及启用状态。教师名册维护不会追溯修改学生历史归属；学生归属可在学生资料中修改。

旧版两表导入脚本 `scripts/import_office_survey.py` 仅适用于旧表格式。当前数据同步请使用上述最新安排脚本。

若旧数据中的 311、406、680 房间仍缺少布局图边缘墙线，运行 `.venv/bin/python scripts/repair_latest_walls.py`。脚本先备份这三间房的布局，再补全墙线，不变更工位分配。

## 备份与恢复

管理端“系统设置 → 备份与账号”可以下载备份包、备份到本机目录、从备份包恢复，以及修改管理员密码。备份包是一个 zip，内含全部数据表的 SQLite 快照、上传文件、管理员账号和邮件配置加密密钥；无论当前运行在 PostgreSQL 还是 SQLite 上，同一个备份包都能恢复。恢复前会自动保留一份当前数据副本（SQLite 模式放在备份目录的 `pre-restore-*.db`）。

首次运行且尚未创建管理员时，登录页会显示初始化向导：可以直接创建管理员，也可以上传另一台电脑导出的备份包，房间、工位、学生资料、账号和设置一次到位，无需重新配置。

PostgreSQL 服务器部署仍可使用原生备份：

```bash
docker compose exec -T db pg_dump -U deskatlas -d deskatlas -Fc > deskatlas.backup
docker compose exec -T db pg_restore -U deskatlas -d deskatlas --clean --if-exists < deskatlas.backup
```

命令行方式修改管理员密码：运行 `pnpm admin:set` 并输入两次新密码，命令直接更新项目 `.env` 中的哈希，不保存明文，随后重启 `pnpm dev`（或 API 服务）生效。`pnpm admin:hash` 仅生成哈希，不修改配置。

## 桌面版（Windows 托盘程序）

桌面版把整个系统打包成一个 Windows 程序：安装后常驻任务栏托盘，FastAPI 在本机监听局域网端口，同时托管静态前端和 API；数据保存在 SQLite 文件里。适合没有常开服务器、由管理员自己的电脑对外提供服务的场景。

### 安装与首次运行

1. 从 GitHub Releases 下载 `DeskAtlas-Setup-<版本>.exe` 并运行。安装到当前用户目录，整个安装过程不需要管理员权限。首次安装时向导里可勾选“登录 Windows 后自动启动”（默认不勾选，升级时不再询问，以程序内的开关为准）。
2. DeskAtlas 第一次运行并开始监听局域网端口时，Windows 会弹出防火墙提示，选择“允许访问”（专用和公用网络都勾选）学生才能打开地址。如果点了取消，可到“Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙”里勾选 DeskAtlas。
3. 首次启动会打开状态面板窗口，并在托盘出现图标。面板显示学生访问地址和二维码；打开“管理端”后进入初始化向导，创建管理员或从备份包恢复。
4. 关闭面板窗口只是隐藏，服务继续运行；托盘图标右键“退出 DeskAtlas”并确认后才会停止服务。

### 状态面板与托盘菜单

- 地址：列出本机所有局域网 IPv4 地址并标出推荐项，可填写“对外显示地址”（固定 IP 或域名）用于二维码。
- 设置：服务端口（保存后自动重启监听）、开机自动启动、阻止电脑睡眠、每日自动备份及保留份数、更新源地址。开机自启与安装向导里的勾选操作同一个注册表启动项（`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的 `DeskAtlas`），在任务管理器“启动应用”里也能看到；1.0.0 留下的启动文件夹快捷方式仍然有效，切换一次开关后会自动迁移。
- 操作：打开学生端 / 管理端、立即备份、打开数据目录 / 备份目录 / 日志、检查更新、立即更新。
- 托盘图标颜色：绿色运行中，黄色有新版本，红色服务异常。

### 数据目录

默认位于 `%LOCALAPPDATA%\DeskAtlas`（可用 `--data-dir` 或环境变量 `DESKATLAS_DATA_DIR` 覆盖），内含：

- `deskatlas.db`：SQLite 数据库
- `config.env`：管理员账号、会话密钥、邮件配置加密密钥
- `settings.json`：端口、显示地址、睡眠、备份、更新源等托盘设置
- `uploads/`、`backups/`、`logs/`、`updates/`

换电脑时复制整个目录，或在管理端导出备份包后在新电脑的初始化向导里恢复。卸载程序会保留数据目录。

### 在线更新

程序启动后及每 6 小时读取更新源（默认 `https://github.com/lycself/DeskAtlas/releases/latest/download/latest.json`），校验 Ed25519 签名与安装包哈希后，在面板里提示“立即更新”。更新时下载安装包、静默安装并自动重启，新版本启动时先执行数据库迁移。校内网无法访问 GitHub 时，把 Release 里的 `latest.json` 和安装包放到校内可访问的静态目录，并在面板中修改更新源地址即可；此时清单必须是签名过的（见下文发布流程第 3 步），未签名的清单只在官方 GitHub 地址下被接受。

### 发布流程

1. 打带说明的 tag 并推送，不需要配置任何密钥。tag 说明就是更新说明，会显示在托盘面板的“发现新版本”下方和 GitHub Release 页面上，请用中文写给管理员看：

   ```bash
   git tag -a v1.2.0 -m "DeskAtlas 1.2.0" -m "- 新增……
   - 修复……"
   git push origin v1.2.0
   ```

   不带说明的轻量 tag 会退回使用该提交的提交信息。
2. `.github/workflows/release.yml` 在 Windows runner 上执行：静态导出前端、运行后端测试、PyInstaller 打包、Inno Setup 生成安装包、生成 `latest.json`，并用 Actions 自带的 token 发布到 GitHub Release。手动触发（workflow_dispatch）只产出构建产物，不发布。
3. 默认更新源是 GitHub Releases，走 HTTPS，客户端校验安装包 sha256，`latest.json` 不签名也会被接受。只有当更新源改为校内镜像时才需要签名：运行 `.venv/bin/python scripts/generate_update_keys.py`，公钥写入 `desktop/update_key.py`（仓库已包含当前公钥），私钥保存为 GitHub Actions 密钥 `DESKATLAS_UPDATE_PRIVATE_KEY`，之后的发布会自动签名，镜像里的清单才会被客户端接受。

没有代码签名证书时，首次运行安装包 SmartScreen 会提示“Windows 已保护你的电脑”，点击“更多信息 → 仍要运行”。

### 本机开发与调试

```bash
pnpm build:static        # 导出静态前端到 out/
pnpm serve:static        # 用 FastAPI 托管 out/ 与 API，数据目录为 outputs/sqlite-data
pnpm desktop:dev         # 运行托盘程序（macOS 也可运行，用于调试面板）
pnpm migrate:sqlite      # 把 .env 指向的 PostgreSQL 数据迁移到 SQLite 数据目录并导出备份包
```

`pnpm migrate:sqlite` 默认写入本机默认数据目录，可用 `--data-dir` 指定；生成的备份包位于 `outputs/backups/`，直接在新电脑的初始化向导里上传即可。日常开发仍使用 `pnpm dev` 与 PostgreSQL，两种数据库共用同一套模型与迁移。桌面版依赖列在 `desktop/requirements.txt`。

## 验证

```bash
pnpm check
pnpm build
```

完整任务计划位于 `ticketly/backlog.md`，可执行清单位于 `ticketly/tasks.md`。
