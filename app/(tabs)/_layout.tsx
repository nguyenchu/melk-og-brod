import { Ionicons } from '@expo/vector-icons';
import { Link, Tabs } from 'expo-router';
import { Pressable } from 'react-native';

const ACCENT = '#E10A0A'; // Meny-rødt

function SettingsHeaderButton() {
  return (
    <Link href="/settings" asChild>
      <Pressable hitSlop={12} style={{ paddingHorizontal: 16 }}>
        {({ pressed }) => (
          <Ionicons name="settings-outline" size={22} color={pressed ? '#999' : '#444'} />
        )}
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: ACCENT,
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: { paddingHorizontal: 60 },
        headerRight: () => <SettingsHeaderButton />,
      }}
    >
      <Tabs.Screen
        name="deals"
        options={{
          title: 'Tilbud',
          tabBarIcon: ({ color, size }) => <Ionicons name="pricetag" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Handleliste',
          tabBarIcon: ({ color, size }) => <Ionicons name="cart" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
