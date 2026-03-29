# 云端同步（Firebase）设置说明

本站的「云端同步」使用 **Google Firebase Firestore**（有免费额度）。按下面做一次即可。

## 1. 创建 Firebase 项目

1. 打开 [Firebase Console](https://console.firebase.google.com/)，登录 Google 账号  
2. **添加项目** → 按提示创建（可关闭 Google Analytics）  
3. 进入项目 → **构建** → **Firestore Database** → **创建数据库**  
4. 选 **以测试模式启动**（先跑通）或直接用下面规则创建为生产模式  

## 2. Firestore 安全规则

**Firestore** → **规则**，粘贴为（仅允许 24 位小写十六进制的文档 ID，与 App 生成的同步码一致）：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /ledgers/{docId} {
      allow read, write: if docId.matches('^[a-f0-9]{24}$');
    }
  }
}
```

点击 **发布**。  
说明：同步码足够长且随机时，他人难以猜到；若需更高安全，可再接入 Firebase Authentication。

## 3. 注册 Web 应用并填写配置

1. 项目 **设置**（齿轮）→ **您的应用** → **</>** Web  
2. 注册应用后，把 `firebaseConfig` 里的字段复制到本站根目录的 **`firebase-config.js`** 对应位置  
3. 保存后执行 `git add firebase-config.js && git commit && git push`，让 GitHub Pages 重新部署  

本地调试：用同一文件即可。

## 4. 两人怎么用

1. **第一台设备**：打开网页 → **记录** → **云端同步** → **生成同步码并上传当前数据**  
2. 把显示的 **同步码** 发给对方（微信等）  
3. **第二台设备**：同一页 → **已有同步码** 里粘贴 → **绑定此码并拉取云端数据**  

之后双方改动会约在 **1 秒内** 同步到对方（需联网）。  
**断开云同步** 只影响当前浏览器是否再连云端，不会删云端数据。

## 5. 微信 / 中国大陆网络说明

- 微信**内置浏览器**有时会拦截或限制连接 Google 服务，出现「拉取失败」时：复制链接，用 **Safari / Chrome** 打开再操作同步。  
- 部分运营商或地区访问 Firebase 不稳定，可换 **WiFi / 流量** 或稍后再试。

## 6. 与「导出备份」的关系

- 云同步：多设备自动一致  
- JSON 导出：离线备份、换号前存档  

建议重要节点仍偶尔 **导出备份**。

## 7. 国内网络：自建同步代理（推荐）

浏览器不直连 Google，只访问你部署在国内或香港机房的 **HTTPS 代理**；代理服务器用 **Firebase Admin** 读写同一套 Firestore。

### 架构

- 网页：在 **`firebase-config.js`** 里填写 `window.COUPLE_REWARDS_API_PROXY = "https://你的域名"`（无尾斜杠）。填写后页面 **不再加载** `gstatic` 上的 Firebase JS，微信内也可打开同步页。  
- 代理：本仓库目录 **`server-proxy/`**，Node 18+，需能访问 Google（**阿里云/腾讯云香港**、AWS `ap-east-1`、Railway/Fly.io 等区域通常可行；**大陆机房直连 Google 常失败**，勿把代理只部署在大陆若无出境线路）。

### 部署步骤（概要）

1. 在 [Firebase 控制台](https://console.firebase.google.com/) → 项目设置 → **服务账号** → 生成新私钥，得到 JSON 文件（**勿提交到 Git**）。  
2. 在代理服务器上设置环境变量（见 `server-proxy/.env.example`）：  
   - `FIREBASE_SERVICE_ACCOUNT_JSON`：JSON 整段字符串，或  
   - `GOOGLE_APPLICATION_CREDENTIALS`：密钥文件路径。  
3. （推荐）设置 `PROXY_SHARED_SECRET` 为长随机串；同时在网页 `firebase-config.js` 填写相同的 `COUPLE_REWARDS_PROXY_SECRET`。  
4. 在 `server-proxy` 目录执行 `npm install && npm start`（生产环境请用 systemd、PM2 或平台托管，并配置 **HTTPS** 反向代理，如 Nginx + 证书）。  
5. 健康检查：`GET https://你的域名/health` 应返回 `{"ok":true}`。  
6. 将 `COUPLE_REWARDS_API_PROXY` 设为上述 **HTTPS 根地址**，保存后重新部署 GitHub Pages（或刷新缓存）。

### API 说明（供排查）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 存活检查 |
| GET | `/v1/ledger/:id` | 读取文档（24 位 hex） |
| PUT | `/v1/ledger/:id` | 写入；`?merge=1` 或 body `merge: true` 为合并 |
| GET | `/v1/ledger/:id/stream` | SSE 实时推送；密钥通过 `?s=` 或头 `X-Proxy-Secret` |

Firestore 规则仍建议与第 2 节一致；代理使用 Admin SDK **绕过规则**，务必保护好服务账号与 `PROXY_SHARED_SECRET`。

### 免费云端托管（无自备服务器）

我**不能代替你**登录 Railway/Fly.io 或保存你的 Firebase 私钥；下面是你本人操作约 **5～10 分钟** 即可跑通的方式（平台常有免费额度，以官网为准）。

#### 方案 A：Railway（步骤最省）

界面文案会改版，**不一定**再叫「Deploy from GitHub」。按下面任一方式接上仓库即可。

**路径 1：新建项目时直接选 GitHub（官方 Quick Start）**

1. 把本仓库推到 **GitHub**（若已在 GitHub 可跳过）。  
2. 打开 [railway.app](https://railway.app/)，建议用 **GitHub 账号登录**（与仓库同一账号最省事）。  
3. 点 **New Project**。  
4. 在弹出选项里选带 **GitHub** 的那一项（常见英文：**Deploy from GitHub repo** / **GitHub Repository**；或带 GitHub 图标的卡片），在列表里**搜索并选中**你的仓库。  
5. 选 **Deploy Now**（或 **Configure** / **Add variables** 后再部署均可）。  

若**根本没有 GitHub 相关选项**：

- 先到 GitHub 安装并授权 Railway 应用：  
  [https://github.com/apps/railway-app/installations/new](https://github.com/apps/railway-app/installations/new)  
  勾选「允许访问」你的仓库（可只选 `couple-rewards-app`），保存后回到 Railway 再点 **New Project**。  
- 若你是用 **邮箱** 注册的 Railway，需在 **Account Settings** 里**关联 GitHub**，否则不会出现仓库列表。

**路径 2：先建空项目，再「连接仓库」**

1. **New Project** → 选 **Empty Project**（空项目）。  
2. 进入项目画布后，点右上角 **New**（或 **Create** / **Add a Service**）。  
3. 选 **GitHub** / **Connect Repo** / **Deploy from GitHub**，再选中仓库。  

**路径 3：不用 GitHub 连接，用本机 CLI 上传（适合仓库未上 GitHub）**

1. 电脑安装 [Railway CLI](https://docs.railway.com/cli)，终端执行 `railway login`。  
2. 在仓库根目录执行 `railway init`，按提示新建一个空项目并关联。  
3. `cd server-proxy`，执行 **`railway up`**（把当前目录打包上传部署）。  
4. 在网页里打开该项目 → 服务 **Variables** 里同样配置下面的环境变量；**Settings → Root Directory** 若 CLI 已只上传 `server-proxy` 可忽略，否则在网页里把构建根目录设为 **`server-proxy`**（若整仓上传则需设置）。

**所有路径完成后，在网页里继续：**

1. 选中该服务 → **Settings** → **Root Directory** 填 **`server-proxy`**（若从 monorepo 部署）→ 保存。  
2. **Variables** 里新增：  
   - **`FIREBASE_SERVICE_ACCOUNT_JSON`**：服务账号 JSON **全文**（勿提交到 Git）。  
   - （推荐）**`PROXY_SHARED_SECRET`**：长随机串；与网页 `firebase-config.js` 里 **`COUPLE_REWARDS_PROXY_SECRET`** 一致。  
3. **Settings** → **Networking** → **Generate Domain**（公网地址形如 `https://xxxx.up.railway.app`）。若提示填写 **Port**，填 **`8080`**（与当前 `server-proxy` 镜像默认 `PORT` 一致；若曾填 8787 请改成 8080）。  
4. 浏览器打开 `https://你的域名/health`，应看到 `{"ok":true}`（若带 `"firestore":false` 说明服务已起来但 Firebase 密钥无效，需检查 `FIREBASE_SERVICE_ACCOUNT_JSON`）。  
5. **`firebase-config.js`**：`window.COUPLE_REWARDS_API_PROXY = "https://你的域名"`（无尾斜杠），保存后更新 GitHub Pages。

说明：Railway 对大陆访问有时偏慢；若经常超时，可改用下面 Fly 香港区。

#### 方案 B：Fly.io（香港区，常更适合大陆访问）

1. 安装 [flyctl](https://fly.io/docs/hands-on/install-flyctl/)，终端登录：`fly auth login`。  
2. `cd server-proxy`，执行 **`fly launch`**（按提示选区域建议 **`Hong Kong (hkg)`**）。若提示 `app` 名称冲突，改一个唯一名字。  
3. 设置密钥：  
   `fly secrets set FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`  
   （整段 JSON 用单引号包住；Windows PowerShell 可用文件方式，见 Fly 文档。）  
4. 可选：`fly secrets set PROXY_SHARED_SECRET=你的长随机串`。  
5. `fly deploy`，部署完成后 `fly status` 里查看 **Hostname**，同上将 `COUPLE_REWARDS_API_PROXY` 设为 `https://该主机名`。

仓库内已带 **`server-proxy/Dockerfile`** 与 **`server-proxy/fly.toml`** 模板；`fly launch` 若改写 `fly.toml`，以你本机生成结果为准。

#### 不推荐：Render 免费实例

免费 Web 服务**无访问一段时间会休眠**，唤醒后 SSE 长连接易断，同步体验差，除非你愿意付费常驻。

#### 安全提醒

- **`FIREBASE_SERVICE_ACCOUNT_JSON` 拥有项目管理员级写权限**，只放在托管平台「环境变量」里，不要写进代码仓库、不要发聊天截图。  
- 设置 **`PROXY_SHARED_SECRET`** 后，未带密钥的请求会被代理拒绝，可降低被扫接口的风险。

#### Railway 出现「Application failed to respond」

多为**容器内进程没起来**或**端口不一致**。请依次检查：

1. **Deployments → Logs** 是否有一行 **`couple-rewards sync proxy listening on http://0.0.0.0:8080`**（端口以日志为准）。  
2. **Variables** 中添加 **`PORT`** = **`8080`**（与下面 Networking 一致）。  
3. **Settings → Networking** 里对外端口填 **`8080`**，保存后 **Redeploy**。  
4. 若曾用旧镜像构建失败：本仓库已改为 **Debian slim** 基础镜像（避免 Alpine 与 Firebase Admin 不兼容），请 **push 最新代码** 并触发重新部署。
