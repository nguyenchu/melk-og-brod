import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import 'react-native-reanimated';
import { StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Onboarding, useOnboarding } from '@/components/onboarding';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.text}>Noe gikk galt. Start appen på nytt.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  text: { fontSize: 16, color: '#333', textAlign: 'center' },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { needsOnboarding, markDone } = useOnboarding();

  return (
    <ErrorBoundary>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />
        {needsOnboarding && <Onboarding onDone={markDone} />}
      </ThemeProvider>
    </ErrorBoundary>
  );
}
