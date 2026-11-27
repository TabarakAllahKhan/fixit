import { Stack } from 'expo-router';
import { colors, fontFamily } from '@/constants/theme';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.heading,
        headerTitleStyle: { fontFamily: fontFamily.semiBold, fontSize: 17 },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Fix-It', headerShown: false }} />
      <Stack.Screen name="scan" options={{ title: 'Scan sticker' }} />
      <Stack.Screen name="appliances" options={{ title: 'Appliances' }} />
      <Stack.Screen name="appliances/new" options={{ title: 'New appliance' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="diagnose/[id]" options={{ title: 'Diagnosis' }} />
    </Stack>
  );
}
