/**
 * 可选：国内/自建同步代理根地址（HTTPS，无尾斜杠）。填写后浏览器不再加载 Google 上的 Firebase SDK，
 * 所有同步经该域名转发到 Firestore（代理需部署在能访问 Google 的机器上，如香港云服务器）。
 * 留空则使用下方 Firebase 网页端直连。
 */
window.COUPLE_REWARDS_API_PROXY = "https://couple-rewards-app-production.up.railway.app";

/** 与代理服务环境变量 PROXY_SHARED_SECRET 一致时可填；不启用服务端密钥则留空 */
window.COUPLE_REWARDS_PROXY_SECRET = "";

/**
 * Firebase 网页端配置（来自 Firebase 控制台 → 项目设置 → 您的应用）
 */
window.COUPLE_REWARDS_FIREBASE = {
  apiKey: "AIzaSyBZ61QZqXvq_xPeo6tHlOxW2tJqq5r6-AA",
  authDomain: "couple-rewards-app.firebaseapp.com",
  projectId: "couple-rewards-app",
  storageBucket: "couple-rewards-app.firebasestorage.app",
  messagingSenderId: "668188766043",
  appId: "1:668188766043:web:088d162acd64d26524747e",
};
