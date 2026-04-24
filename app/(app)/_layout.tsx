import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Melk&Brød' }} />
      <Stack.Screen name="onboarding" options={{ title: 'Kom i gang', headerBackVisible: false }} />
      <Stack.Screen name="list/[id]" options={{ title: 'Liste' }} />
      <Stack.Screen name="settings" options={{ title: 'Innstillinger' }} />
      <Stack.Screen name="invite" options={{ title: 'Inviter', presentation: 'modal' }} />
    </Stack>
  );
}
