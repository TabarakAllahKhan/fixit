import { Button, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function Diagnosis() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const sessionId = Array.isArray(id) ? id[0] : id;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Diagnosis</Text>
      <Text style={styles.session}>Session {sessionId}</Text>
      <View style={styles.state}>
        <Text style={styles.stateTitle}>No results for this session yet</Text>
        <Text style={styles.stateBody}>
          Diagnosis results are not connected in this version of the app. When they are, you will see the likely
          issue, the evidence behind it, and the safe next steps here.
        </Text>
      </View>
      <Button title="Back to home" onPress={() => router.replace('/(app)' as never)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F5', padding: 24, gap: 16 },
  title: { fontSize: 26, fontWeight: '700', color: '#192722' },
  session: { fontSize: 14, color: '#68756E' },
  state: {
    borderWidth: 1,
    borderColor: '#E7ECE8',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 20,
    gap: 8,
  },
  stateTitle: { fontSize: 18, fontWeight: '600', color: '#192722' },
  stateBody: { fontSize: 15, lineHeight: 22, color: '#68756E' },
});
