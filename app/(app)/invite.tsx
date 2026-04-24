import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { createInvite } from '@/lib/household';

export default function InviteScreen() {
  const { householdId } = useLocalSearchParams<{ householdId: string }>();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId) return;
    createInvite(householdId)
      .then(invite => setCode(invite.code))
      .catch(e => Alert.alert('Feil', e.message))
      .finally(() => setLoading(false));
  }, [householdId]);

  async function share() {
    if (!code) return;
    await Share.share({
      message: `Bli med i husholdningen på Melk&Brød! Kode: ${code}`,
    });
  }

  if (loading) {
    return <View style={styles.container}><ActivityIndicator /></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Invitasjonskode</Text>
      <Text style={styles.code}>{code}</Text>
      <Text style={styles.info}>Gyldig i 7 dager. Kan brukes av opptil 10 personer.</Text>
      <Pressable style={styles.button} onPress={share}>
        <Text style={styles.buttonText}>Del kode</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  label: { fontSize: 16, color: '#666', marginBottom: 12 },
  code: { fontSize: 48, fontWeight: '700', letterSpacing: 4, marginBottom: 24 },
  info: { fontSize: 14, color: '#999', textAlign: 'center', marginBottom: 32 },
  button: { backgroundColor: '#007AFF', paddingHorizontal: 32, paddingVertical: 16, borderRadius: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
