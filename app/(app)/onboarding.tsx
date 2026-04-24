import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createHousehold, redeemInvite } from '@/lib/household';

export default function Onboarding() {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleCreate() {
    if (!name.trim()) return Alert.alert('Mangler navn', 'Skriv inn et navn på husholdningen');
    setLoading(true);
    try {
      await createHousehold(name.trim());
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Feil', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!code.trim()) return Alert.alert('Mangler kode', 'Skriv inn invitasjonskoden');
    setLoading(true);
    try {
      await redeemInvite(code);
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Kunne ikke bli med', e.message);
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'choose') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Velkommen!</Text>
        <Text style={styles.subtitle}>Kom i gang med din første handleliste</Text>

        <Pressable style={styles.button} onPress={() => setMode('create')}>
          <Text style={styles.buttonText}>Opprett ny husholdning</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={() => setMode('join')}>
          <Text style={styles.buttonText}>Bli med via kode</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      {mode === 'create' ? (
        <>
          <Text style={styles.title}>Ny husholdning</Text>
          <TextInput
            style={styles.input}
            placeholder="F.eks. Familien Hansen"
            value={name}
            onChangeText={setName}
            autoFocus
          />
          <Pressable style={styles.button} onPress={handleCreate} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Oppretter...' : 'Opprett'}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.title}>Bli med</Text>
          <TextInput
            style={styles.input}
            placeholder="Invitasjonskode"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoFocus
          />
          <Pressable style={styles.button} onPress={handleJoin} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Blir med...' : 'Bli med'}</Text>
          </Pressable>
        </>
      )}
      <Pressable onPress={() => setMode('choose')}>
        <Text style={styles.link}>Tilbake</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 40, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 16, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: '#007AFF', padding: 16, borderRadius: 12, marginTop: 12 },
  secondary: { backgroundColor: '#34C759' },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
  link: { textAlign: 'center', marginTop: 24, color: '#007AFF' },
});
