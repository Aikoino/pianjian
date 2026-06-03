import { Alert, Linking } from 'react-native';
import Constants from 'expo-constants';

const GITHUB_REPO = 'Aikoino/pianjian';
const CURRENT_VERSION = Constants.expoConfig?.version || '1.0.0';

export async function checkForUpdate() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github.v3+json' }, timeout: 10000 }
    );
    if (!response.ok) return;
    const release = await response.json();
    const latestVersion = release.tag_name?.replace('v', '') || '';
    if (!latestVersion || latestVersion === CURRENT_VERSION) return;

    // 找到 APK 下载链接
    const apkAsset = release.assets?.find(a => a.name?.endsWith('.apk'));
    const downloadUrl = apkAsset?.browser_download_url || release.html_url;

    Alert.alert(
      `发现新版本 v${latestVersion}`,
      `当前版本 v${CURRENT_VERSION}，是否前往下载？`,
      [
        { text: '稍后', style: 'cancel' },
        { text: '去下载', onPress: () => Linking.openURL(downloadUrl) },
      ]
    );
  } catch (e) {
    // 网络错误静默处理
  }
}
