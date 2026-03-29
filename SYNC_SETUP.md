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

## 5. 与「导出备份」的关系

- 云同步：多设备自动一致  
- JSON 导出：离线备份、换号前存档  

建议重要节点仍偶尔 **导出备份**。
