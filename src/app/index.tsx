import { View, Text, Button, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function Home() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Is it a 5-minute fix?</Text>
      <Text style={styles.sub}>Snap the model sticker or the error display.</Text>
      <Button title="Scan sticker / error code" onPress={() => router.push('/scan')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 26, fontWeight: '700' },
  sub: { fontSize: 16, color: '#555', marginBottom: 12 },
});