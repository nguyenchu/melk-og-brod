import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import 'react-native-reanimated';
import { StyleSheet, Text, View } from 'react-native';
import { Onboarding, useOnboarding } from '@/components/onboarding';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
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
  const { needsOnboarding, markDone } = useOnboarding();

  return (
    <ErrorBoundary>
      {/* Skjermene har faste lyse farger, så appen er bare lys – også når
          systemet står i mørk modus (ellers blandes mørk navigasjon med lyse skjermer). */}
      <ThemeProvider value={DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="settings"
            options={{
              title: 'Innstillinger',
              presentation: 'modal',
              headerStyle: { backgroundColor: '#fff' },
              headerTitleStyle: { fontWeight: '700' },
            }}
          />
        </Stack>
        <StatusBar style="dark" />
        {needsOnboarding && <Onboarding onDone={markDone} />}
      </ThemeProvider>
    </ErrorBoundary>
  );
}
