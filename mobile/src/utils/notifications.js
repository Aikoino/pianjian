import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// 配置通知行为：前台也弹横幅
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestPermission() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;

  // Android 13+ 需要额外请求 POST_NOTIFICATIONS
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: '便签提醒',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  return true;
}

export async function scheduleReminder(noteId, noteContent, remindAt) {
  const triggerDate = new Date(remindAt);
  // 如果提醒时间已过，不调度
  if (triggerDate.getTime() <= Date.now()) return null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '片笺提醒',
      body: noteContent || '(空内容)',
      data: { noteId },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });
  return id;
}

export async function cancelReminder(notificationId) {
  if (notificationId) {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  }
}
