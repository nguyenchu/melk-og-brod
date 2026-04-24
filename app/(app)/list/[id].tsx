import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import type { Item } from '@/lib/types';

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [listName, setListName] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [newItem, setNewItem] = useState('');

  useEffect(() => {
    if (!id) return;

    // 1. Last lista og eksisterende varer
    (async () => {
      const [{ data: list }, { data: existingItems, error }] = await Promise.all([
        supabase.from('lists').select('name').eq('id', id).single(),
        supabase.from('items').select('*').eq('list_id', id).order('created_at', { ascending: true }),
      ]);
      if (list) setListName(list.name);
      if (error) Alert.alert('Feil', error.message);
      else setItems(existingItems ?? []);
    })();

    // 2. Abonner på realtime-endringer
    const channel = supabase
      .channel(`items:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${id}` },
        payload => {
          setItems(prev => {
            if (!prev) return prev;
            if (payload.eventType === 'INSERT') {
              const newItem = payload.new as Item;
              if (prev.some(i => i.id === newItem.id)) return prev;
              return [...prev, newItem];
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map(i => (i.id === payload.new.id ? (payload.new as Item) : i));
            }
            if (payload.eventType === 'DELETE') {
              return prev.filter(i => i.id !== payload.old.id);
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  async function addItem() {
    const name = newItem.trim();
    if (!name || !id) return;
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    setNewItem('');
    const { error } = await supabase.from('items').insert({
      list_id: id,
      name,
      added_by: user.user.id,
    });
    if (error) Alert.alert('Feil', error.message);
  }

  async function toggleItem(item: Item) {
    await supabase.from('items').update({ checked: !item.checked }).eq('id', item.id);
  }

  async function deleteItem(item: Item) {
    await supabase.from('items').delete().eq('id', item.id);
  }

  if (!items) return <View style={styles.center}><ActivityIndicator /></View>;

  const sorted = [...items].sort((a, b) => Number(a.checked) - Number(b.checked));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen options={{ title: listName || 'Liste' }} />
      <FlatList
        data={sorted}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Listen er tom. Legg til første vare nedenfor.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.itemRow} onPress={() => toggleItem(item)} onLongPress={() => deleteItem(item)}>
            <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
              {item.checked && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={[styles.itemText, item.checked && styles.itemTextChecked]}>{item.name}</Text>
          </Pressable>
        )}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Legg til vare..."
          value={newItem}
          onChangeText={setNewItem}
          onSubmitEditing={addItem}
          returnKeyType="done"
          blurOnSubmit={false}
        />
        <Pressable style={styles.addButton} onPress={addItem}>
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16 },
  empty: { textAlign: 'center', color: '#999', marginTop: 40, fontStyle: 'italic' },
  itemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 8 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#ccc', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  checkboxChecked: { backgroundColor: '#34C759', borderColor: '#34C759' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  itemText: { fontSize: 16, flex: 1 },
  itemTextChecked: { textDecorationLine: 'line-through', color: '#999' },
  inputRow: { flexDirection: 'row', padding: 16, gap: 8, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' },
  input: { flex: 1, backgroundColor: '#f5f5f7', borderRadius: 12, padding: 14, fontSize: 16 },
  addButton: { backgroundColor: '#007AFF', width: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 24, fontWeight: '600' },
});
