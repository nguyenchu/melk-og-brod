import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const TOKEN_KEY = 'super-deal-push.token';
const URL = process.env.EXPO_PUBLIC_PUSH_URL;
export const supportsSuperDealPush = Boolean(URL) && Platform.OS !== 'web';

export async function isSuperDealPushEnabled() {
  return Boolean(await AsyncStorage.getItem(TOKEN_KEY));
}

async function updateSubscription(token: string, method: 'PUT' | 'DELETE') {
  if (!URL) throw new Error('Varseltjenesten er ikke konfigurert.');
  const response = await fetch(URL, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Fikk ikke kontakt med varseltjenesten. Prøv igjen.');
}

export async function setSuperDealPushEnabled(enabled: boolean) {
  const previousToken = await AsyncStorage.getItem(TOKEN_KEY);
  if (!enabled) {
    if (previousToken) await updateSubscription(previousToken, 'DELETE');
    await AsyncStorage.removeItem(TOKEN_KEY);
    return;
  }

  const notifications = await import('expo-notifications');
  if (Platform.OS === 'android') {
    await notifications.setNotificationChannelAsync('super-deals', {
      name: 'Kjempetilbud',
      importance: notifications.AndroidImportance.DEFAULT,
    });
  }
  const permissions = await notifications.requestPermissionsAsync();
  if (!permissions.granted)
    throw new Error('Gi Matkupp tillatelse til varsler i telefonens innstillinger.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Pushvarsler mangler prosjekt-ID.');
  const { data: token } = await notifications.getExpoPushTokenAsync({ projectId });
  if (previousToken && previousToken !== token) await updateSubscription(previousToken, 'DELETE');
  await updateSubscription(token, 'PUT');
  await AsyncStorage.setItem(TOKEN_KEY, token);
}
