import { StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontFamily } from '@/constants/theme';

interface Props {
  message: string;
  tone?: 'error' | 'success';
  type?: 'error' | 'success';
}

export function FormMessage({ message, tone, type }: Props) {
  const resolved = tone ?? type ?? 'error';
  const isError = resolved === 'error';
  return (
    <View accessibilityRole="alert" style={[styles.wrap, isError ? styles.errorWrap : styles.successWrap]}>
      <MaterialCommunityIcons
        name={isError ? 'alert-circle-outline' : 'check-circle-outline'}
        size={18}
        color={isError ? colors.error : colors.success}
      />
      <Text style={[styles.text, isError ? styles.errorText : styles.successText]}>{message}</Text>
    </View>
  );
}
export const AuthMessage = FormMessage;

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  errorWrap: { backgroundColor: colors.errorSoft, borderColor: '#F2CFCB' },
  successWrap: { backgroundColor: '#EEF7F2', borderColor: '#CFE6DA' },
  text: { flex: 1, fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 20 },
  errorText: { color: '#A9443D' },
  successText: { color: colors.success },
});
