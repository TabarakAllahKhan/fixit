import { Button, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

export default function Appliances() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Appliances</Text>
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No appliances saved yet</Text>
        <Text style={styles.emptyBody}>
          Saved appliances will appear here so you can start a diagnosis without entering the details again.
        </Text>
      </View>
      <Button title="Scan a sticker" onPress={() => router.push('/scan')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F5', padding: 24, gap: 20 },
  title: { fontSize: 26, fontWeight: '700', color: '#192722' },
  emptyState: {
    borderWidth: 1,
    borderColor: '#E7ECE8',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 20,
    gap: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#192722' },
  emptyBody: { fontSize: 15, lineHeight: 22, color: '#68756E' },
});
