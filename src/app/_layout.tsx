import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Fix-It' }} />
      <Stack.Screen name="scan" options={{ title: 'Scan sticker' }} />
    </Stack>
  );
}