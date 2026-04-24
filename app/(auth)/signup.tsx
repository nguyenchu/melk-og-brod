import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { supabase } from '@/lib/supabase';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signUp() {
    if (password.length < 6) {
      Alert.alert('Passord for kort', 'Minst 6 tegn');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      Alert.alert('Registrering feilet', error.message);
    } else {
      Alert.alert('Konto opprettet', 'Sjekk e-post for bekreftelseslenke, eller logg inn direkte.');
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <Text style={styles.title}>Melk&Brød</Text>
      <Text style={styles.subtitle}>Lag konto</Text>

      <TextInput
        style={styles.input}
        placeholder="E-post"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Passord (min. 6 tegn)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Pressable style={styles.button} onPress={signUp} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Oppretter...' : 'Registrer'}</Text>
      </Pressable>

      <Link href="/(auth)/login" asChild>
        <Pressable>
          <Text style={styles.link}>Har du allerede konto? Logg inn</Text>
        </Pressable>
      </Link>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 40, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 18, textAlign: 'center', marginBottom: 32, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 16, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: '#007AFF', padding: 16, borderRadius: 12, marginTop: 12 },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
  link: { textAlign: 'center', marginTop: 24, color: '#007AFF' },
});
