import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const PRIVACY_URL = 'https://nguyenchu.com/privacy/';
const ONBOARDING_KEY = 'onboarding.v1.completed';

export default function SettingsScreen() {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);
  const version = Constants.expoConfig?.version ?? '—';
  const buildNumber =
    (Constants.expoConfig as any)?.android?.versionCode ??
    (Constants.expoConfig as any)?.ios?.buildNumber ??
    '—';

  async function onResetOnboarding() {
    setResetting(true);
    try {
      await AsyncStorage.removeItem(ONBOARDING_KEY);
      Alert.alert('Klart', 'Velkomst-skjermen vises ved neste app-oppstart.');
    } finally {
      setResetting(false);
    }
  }

  function onOpenPrivacy() {
    WebBrowser.openBrowserAsync(PRIVACY_URL).catch(() => {});
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Section title="Om appen">
        <Row label="Versjon" value={`${version} (${buildNumber})`} />
        <Row label="Datakilde" value="Meny.no via offentlig API" />
      </Section>

      <Section title="Personvern">
        <ActionRow icon="shield-checkmark-outline" label="Personvernerklæring" onPress={onOpenPrivacy} chevron />
        <Hint>
          Handlelista lagres lokalt på telefonen din. Vi samler ikke brukerkontoer, plassering eller analytikk.
        </Hint>
      </Section>

      <Section title="Avansert">
        <ActionRow
          icon="refresh-outline"
          label={resetting ? 'Tilbakestiller…' : 'Vis velkomst på nytt'}
          onPress={onResetOnboarding}
        />
      </Section>

      <Pressable style={styles.closeBtn} onPress={() => router.back()}>
        <Text style={styles.closeBtnText}>Lukk</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  chevron,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  chevron?: boolean;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress}>
      <View style={styles.actionLabel}>
        <Ionicons name={icon} size={18} color="#E10A0A" />
        <Text style={[styles.rowLabel, { color: '#111' }]}>{label}</Text>
      </View>
      {chevron ? <Ionicons name="chevron-forward" size={18} color="#bbb" /> : null}
    </Pressable>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f7' },
  content: { padding: 16, paddingBottom: 48, gap: 24 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 4,
  },
  sectionCard: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rowPressed: { backgroundColor: '#f9f9fb' },
  rowLabel: { fontSize: 15, color: '#444' },
  rowValue: { fontSize: 14, color: '#888' },
  actionLabel: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hint: { fontSize: 12, color: '#888', paddingHorizontal: 16, paddingVertical: 10, lineHeight: 17 },
  closeBtn: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  closeBtnText: { color: '#E10A0A', fontSize: 15, fontWeight: '700' },
});
