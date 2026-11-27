import { useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { AuthPrimaryButton } from '@/components/auth/AuthPrimaryButton';
import { AuthTextField } from '@/components/auth/AuthTextField';
import { FormMessage } from '@/components/auth/FormMessage';
import { colors, fontFamily, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { getApiErrorMessage } from '@/lib/api-error';
import { createAppliance } from '@/lib/appliance-api';
import {
  hasApplianceErrors,
  normalizeCreateAppliance,
  validateCreateAppliance,
  type ApplianceFieldErrors,
} from '@/lib/appliance-validation';
import type { ApplianceCategory, CreateApplianceInput } from '@/types/appliance';

const EMPTY_ERRORS: ApplianceFieldErrors = {};
const FALLBACK_ERROR = 'We could not save this appliance. Please try again.';

const CATEGORY_OPTIONS: {
  value: ApplianceCategory;
  label: string;
  icon: 'washing-machine' | 'fridge-outline';
}[] = [
  { value: 'WASHING_MACHINE', label: 'Washing machine', icon: 'washing-machine' },
  { value: 'REFRIGERATOR', label: 'Refrigerator', icon: 'fridge-outline' },
];

/**
 * The category is unset until the user chooses one. An empty sentinel lets the
 * existing Phase 1 validator produce its own required-category message without
 * duplicating validation rules here.
 */
function toDraft(
  category: ApplianceCategory | null,
  brand: string,
  modelNumber: string,
  nickname: string,
): CreateApplianceInput {
  return {
    category: category ?? ('' as ApplianceCategory),
    brand,
    modelNumber,
    nickname,
  };
}

/** Create form with client validation, authenticated save and list refresh. */
export function CreateApplianceForm() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const submittingRef = useRef(false);
  const brandRef = useRef<TextInputInstance>(null);
  const modelRef = useRef<TextInputInstance>(null);
  const nicknameRef = useRef<TextInputInstance>(null);

  const [category, setCategory] = useState<ApplianceCategory | null>(null);
  const [brand, setBrand] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [nickname, setNickname] = useState('');
  const [errors, setErrors] = useState<ApplianceFieldErrors>(EMPTY_ERRORS);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clearError(field: keyof ApplianceFieldErrors): void {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    if (formError) setFormError(null);
  }

  async function handleSubmit(): Promise<void> {
    if (submittingRef.current) return;

    setFormError(null);
    const nextErrors = validateCreateAppliance(toDraft(category, brand, modelNumber, nickname));
    setErrors(nextErrors);
    if (hasApplianceErrors(nextErrors) || !category) return;

    const input: CreateApplianceInput = { category, brand, modelNumber, nickname };

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const normalized = normalizeCreateAppliance(input);
      const created = await createAppliance(accessToken, normalized);
      Keyboard.dismiss();
      // The list uses this id to trigger an explicit refresh after creation.
      router.navigate(`/appliances?created=${encodeURIComponent(created.id)}` as Href);
    } catch (error) {
      setFormError(getApiErrorMessage(error, FALLBACK_ERROR));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'android' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.eyebrow}>APPLIANCE DETAILS</Text>
          <Text style={styles.title}>Add an appliance</Text>
          <Text style={styles.description}>
            Save a few details now so diagnoses start with the right machine.
          </Text>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={styles.label}>
                Category <Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.categoryOptions}>
                {CATEGORY_OPTIONS.map((option) => {
                  const selected = category === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityLabel={option.label}
                      accessibilityState={{ checked: selected, disabled: submitting }}
                      disabled={submitting}
                      onPress={() => {
                        setCategory(option.value);
                        clearError('category');
                      }}
                      style={({ pressed }) => [
                        styles.categoryOption,
                        selected ? styles.categoryOptionSelected : null,
                        pressed && !submitting ? styles.categoryOptionPressed : null,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={option.icon}
                        size={22}
                        color={selected ? colors.forest : colors.secondary}
                      />
                      <Text style={[styles.categoryLabel, selected && styles.categoryLabelSelected]}>
                        {option.label}
                      </Text>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={20} color={colors.forest} />
                      ) : (
                        <View style={styles.radioRing} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
              {errors.category ? <Text style={styles.fieldError}>{errors.category}</Text> : null}
            </View>

            <AuthTextField
              ref={brandRef}
              label="Brand"
              error={errors.brand}
              placeholder="e.g. Whirlpool"
              value={brand}
              onChangeText={(value) => {
                setBrand(value);
                clearError('brand');
              }}
              maxLength={120}
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="organizationName"
              returnKeyType="next"
              editable={!submitting}
              onSubmitEditing={() => modelRef.current?.focus()}
            />

            <AuthTextField
              ref={modelRef}
              label="Model number"
              error={errors.modelNumber}
              hint="Optional"
              placeholder="e.g. WED8300SW0"
              value={modelNumber}
              onChangeText={(value) => {
                setModelNumber(value);
                clearError('modelNumber');
              }}
              maxLength={80}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="next"
              editable={!submitting}
              onSubmitEditing={() => nicknameRef.current?.focus()}
            />

            <AuthTextField
              ref={nicknameRef}
              label="Nickname"
              error={errors.nickname}
              hint="Optional"
              placeholder="e.g. Laundry room washer"
              value={nickname}
              onChangeText={(value) => {
                setNickname(value);
                clearError('nickname');
              }}
              maxLength={100}
              autoCapitalize="sentences"
              returnKeyType="done"
              editable={!submitting}
              onSubmitEditing={() => void handleSubmit()}
            />
          </View>

          {errors.form ? <FormMessage message={errors.form} /> : null}
          {formError ? <FormMessage message={formError} /> : null}

          <AuthPrimaryButton
            label="Save appliance"
            loadingLabel="Saving…"
            loading={submitting}
            onPress={() => void handleSubmit()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  eyebrow: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.2,
    color: colors.forest,
  },
  title: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.ink,
  },
  description: {
    marginTop: spacing.xs,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.bannerSubtitle,
  },
  fields: { marginTop: spacing.xl, gap: spacing.lg },
  field: { gap: spacing.sm },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
  required: { color: colors.error },
  categoryOptions: { gap: spacing.sm },
  categoryOption: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.surface,
  },
  categoryOptionSelected: {
    borderColor: colors.forest,
    backgroundColor: colors.primarySoft,
  },
  categoryOptionPressed: { opacity: 0.75 },
  categoryLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  categoryLabelSelected: { fontFamily: fontFamily.semiBold, color: colors.forest },
  radioRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  fieldError: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.error,
  },
});
