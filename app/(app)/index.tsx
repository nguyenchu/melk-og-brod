import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { getMyHouseholds } from '@/lib/household';

type ListRow = { id: string; name: string; household_id: string };
type Row = { household: { id: string; name: string }; lists: ListRow[] };

export default function Home() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [newListName, setNewListName] = useState('');
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const memberships = await getMyHouseholds();
      if (!memberships || memberships.length === 0) {
        router.replace('/(app)/onboarding');
        return;
      }

      const householdIds = memberships.map((m: any) => m.household_id);
      const { data: lists, error } = await supabase
        .from('lists')
        .select('id, name, household_id')
        .in('household_id', householdIds)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const grouped: Row[] = memberships.map((m: any) => ({
        household: { id: m.households.id, name: m.households.name },
        lists: (lists ?? []).filter(l => l.household_id === m.household_id),
      }));
      setRows(grouped);
      if (!activeHouseholdId) setActiveHouseholdId(grouped[0]?.household.id ?? null);
    } catch (e: any) {
      Alert.alert('Kunne ikke laste', e.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function addList() {
    const name = newListName.trim();
    if (!name || !activeHouseholdId) return;
    const { error } = await supabase.from('lists').insert({ name, household_id: activeHouseholdId });
    if (error) return Alert.alert('Feil', error.message);
    setNewListName('');
    load();
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (!rows) return <View style={styles.center}><ActivityIndicator /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={r => r.household.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.addRow}>
              <TextInput
                style={styles.input}
                placeholder="Ny liste (f.eks. Ukeshandel)"
                value={newListName}
                onChangeText={setNewListName}
                onSubmitEditing={addList}
                returnKeyType="done"
              />
              <Pressable style={styles.addButton} onPress={addList}>
                <Text style={styles.addButtonText}>+</Text>
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.householdName}>{item.household.name}</Text>
              <Pressable onPress={() => {
                setActiveHouseholdId(item.household.id);
                router.push({ pathname: '/(app)/invite', params: { householdId: item.household.id } });
              }}>
                <Text style={styles.inviteLink}>Inviter</Text>
              </Pressable>
            </View>
            {item.lists.length === 0 ? (
              <Text style={styles.empty}>Ingen lister enda. Skriv inn navn og trykk +</Text>
            ) : (
              item.lists.map(list => (
                <Link key={list.id} href={`/(app)/list/${list.id}`} asChild>
                  <Pressable style={styles.listItem}>
                    <Text style={styles.listName}>{list.name}</Text>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                </Link>
              ))
            )}
          </View>
        )}
        ListFooterComponent={
          <Pressable onPress={signOut} style={styles.signOut}>
            <Text style={styles.signOutText}>Logg ut</Text>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 16 },
  addRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 16 },
  addButton: { backgroundColor: '#007AFF', width: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 24, fontWeight: '600' },
  section: { marginBottom: 24, paddingHorizontal: 16 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  householdName: { fontSize: 18, fontWeight: '600' },
  inviteLink: { color: '#007AFF', fontSize: 14 },
  empty: { color: '#999', fontStyle: 'italic', padding: 16, backgroundColor: '#fff', borderRadius: 12 },
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 8 },
  listName: { fontSize: 16 },
  chevron: { fontSize: 24, color: '#ccc' },
  signOut: { padding: 24, alignItems: 'center' },
  signOutText: { color: '#FF3B30' },
});
