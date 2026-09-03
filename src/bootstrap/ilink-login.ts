import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { FileCredentialStore } from "../adapters/outbound/ilink/file-credential-store.js";
import { ILinkQrLogin } from "../adapters/outbound/ilink/qr-login.js";

try {
  loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const credentialPath = resolve(dataDir, "credentials", "ilink.json");
const login = new ILinkQrLogin({
  baseUrl: process.env.ILINK_BASE_URL ?? "https://ilinkai.weixin.qq.com",
  onStatus: (status) => process.stdout.write(`iLink 登录状态：${status}\n`),
});

process.stdout.write("正在申请 iLink 登录二维码...\n");
const started = await login.start();
process.stdout.write(`\n请使用手机微信扫描并确认授权：\n${started.qrcodeUrl}\n\n`);
const credential = await login.waitForConfirmation(started);
await new FileCredentialStore(credentialPath).save(credential);

process.stdout.write("\n✅ iLink 登录成功，凭证已安全保存。\n");
process.stdout.write(`文件：${credentialPath}\n`);
process.stdout.write(`botId：${credential.botId}\n`);
process.stdout.write(`userId：${credential.userId ?? "(服务端未返回)"}\n`);
process.stdout.write(`baseUrl：${credential.baseUrl}\n`);
process.stdout.write("botToken：已保存，不在终端显示。\n");
