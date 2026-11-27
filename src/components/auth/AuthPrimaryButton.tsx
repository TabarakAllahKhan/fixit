import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/constants/theme';

interface Props {
  label: string;
  loadingLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export function AuthPrimaryButton({
  label,
  loadingLabel = 'Please wait…',
  loading = false,
  disabled = false,
  onPress,
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={loading ? loadingLabel : label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      android_ripple={isDisabled ? undefined : { color: colors.primaryPressed }}
      className={`min-h-[56px] w-full items-center justify-center rounded-[14px] px-5 ${
        isDisabled ? 'bg-line' : 'bg-primary'
      }`}
      style={({ pressed }) => (!isDisabled && pressed ? styles.pressed : undefined)}
    >
      <View className="flex-row items-center justify-center gap-2">
        {loading ? (
          <>
            <ActivityIndicator color={colors.white} size="small" />
            <Text className="font-manrope-semibold text-[16px] leading-5 text-surface">
              {loadingLabel}
            </Text>
          </>
        ) : (
          <>
            <Text className="font-manrope-semibold text-[16px] leading-5 text-surface">
              {label}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={colors.white} />
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.primaryPressed,
    transform: [{ scale: 0.985 }],
  },
});
