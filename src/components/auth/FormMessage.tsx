import { Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@/constants/theme';

interface Props {
  message: string;
  tone?: 'error' | 'success';
  type?: 'error' | 'success';
}

export function FormMessage({ message, tone, type }: Props) {
  const resolved = tone ?? type ?? 'error';
  const isError = resolved === 'error';

  return (
    <View
      accessibilityRole="alert"
      className={`flex-row items-start gap-2.5 rounded-[14px] border px-3.5 py-3 ${
        isError ? 'border-line bg-error-soft' : 'border-line bg-primary-soft'
      }`}
    >
      <MaterialCommunityIcons
        name={isError ? 'alert-circle-outline' : 'check-circle-outline'}
        size={18}
        color={isError ? colors.error : colors.success}
      />
      <Text
        className={`flex-1 font-manrope-medium text-[14px] leading-5 ${
          isError ? 'text-error' : 'text-success'
        }`}
      >
        {message}
      </Text>
    </View>
  );
}
export const AuthMessage = FormMessage;
