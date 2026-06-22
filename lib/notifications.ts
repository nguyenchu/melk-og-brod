/**
 * Parkert: push er deaktivert etter pivoten til statiske JSON-filer — det finnes
 * ingen skrivbar backend å lagre push-tokens i. Favoritter lagres lokalt på enheten.
 *
 * For å aktivere push igjen:
 *   1. `npx expo install expo-notifications` + legg plugin tilbake i app.json
 *   2. hent Expo push-token (se `ensurePushToken` i git-historikken)
 *   3. et lite skrivbart endepunkt (token + favoritt-EAN-er) som en sender kan lese
 */
export async function syncFavoritesToServer(_favoriteEans: string[]): Promise<void> {
  // no-op
}
