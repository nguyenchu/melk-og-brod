import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const TOKEN_KEY = 'push.token.v1';
const PERMISSION_ASKED_KEY = 'push.permission.asked.v1';

/**
 * Ask for push permission (only once across app lifetime) and return the
 * Expo push token. Returns null on simulator, denial, or any error.
 */
export async function ensurePushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;

  // Cache the token so we don't hit the Expo push service repeatedly.
  const cached = await AsyncStorage.getItem(TOKEN_KEY);
  if (cached) return cached;

  // Only ask for permission once; if the user already declined we respect that.
  const alreadyAsked = await AsyncStorage.getItem(PERMISSION_ASKED_KEY);
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== 'granted') {
    if (alreadyAsked === '1') return null;
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
    await AsyncStorage.setItem(PERMISSION_ASKED_KEY, '1');
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('deals', {
      name: 'Tilbud på favoritter',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    return token ?? null;
  } catch {
    return null;
  }
}

/**
 * Parkert: med statiske JSON-filer finnes ingen skrivbar backend for push-tokens.
 * Favoritter lagres lokalt på enheten. For å aktivere push igjen trengs et lite
 * skrivbart endepunkt (token + favoritt-EAN-er) som en sender kan lese.
 */
export async function syncFavoritesToServer(_favoriteEans: string[]): Promise<void> {
  // no-op
}
