import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ApplianceRow } from '@/components/appliances/ApplianceRow';
import { colors, fontFamily, homeClassName, radius, spacing } from '@/constants/theme';
import type { Appliance } from '@/types/appliance';

interface Props {
  items: Appliance[];
  initialLoading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

const SKELETON_ROWS = [0, 1, 2];

function LoadingState() {
  return (
    <View style={styles.skeletonList} accessibilityRole="status" accessibilityLabel="Loading your appliances">
      {SKELETON_ROWS.map((index) => (
        <View key={index} className={homeClassName.listCard}>
          <View style={[styles.badge, styles.placeholder]} />
          <View style={styles.copy}>
            <View style={[styles.placeholderLine, styles.placeholderTitle]} />
            <View style={styles.placeholderLine} />
          </View>
        </View>
      ))}
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.messageCard}>
      <Text style={styles.messageTitle}>No appliances saved yet</Text>
      <Text style={styles.messageBody}>
        Once you save an appliance, it will appear here so diagnoses can start with the right details.
      </Text>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.messageCard}>
      <Text style={styles.messageTitle}>Couldn’t load appliances</Text>
      <Text style={styles.messageBody}>{message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry loading appliances" onPress={onRetry} hitSlop={8}>
        <Text style={styles.link}>Retry</Text>
      </Pressable>
    </View>
  );
}

/** Full list screen: skeleton, empty, error and populated states. */
export function ApplianceListView({
  items,
  initialLoading,
  refreshing,
  error,
  onRefresh,
  onRetry,
  onSelect,
  onAdd,
}: Props) {
  const renderItem = useCallback(
    ({ item }: { item: Appliance }) => (
      <ApplianceRow appliance={item} onPress={() => onSelect(item.id)} />
    ),
    [onSelect],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.pageTitle}>Saved appliances</Text>
          <Text style={styles.pageSubtitle}>Keep appliance details ready for diagnosis.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add appliance"
          onPress={onAdd}
          hitSlop={8}
          style={({ pressed }) => [styles.addButton, pressed ? styles.addButtonPressed : null]}
        >
          <Ionicons name="add" size={17} color={colors.white} />
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      {initialLoading ? (
        <View style={styles.page}>
          <LoadingState />
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.page}>
          <ErrorState message={error} onRetry={onRetry} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.page}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.forest]}
              progressBackgroundColor={colors.surface}
              tintColor={colors.forest}
            />
          }
          ListHeaderComponent={
            error ? (
              <View style={styles.banner}>
                <ErrorState message={error} onRetry={onRetry} />
              </View>
            ) : undefined
          }
          ListEmptyComponent={<EmptyState />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 },
  pageTitle: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 22, color: colors.ink },
  pageSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.bannerSubtitle,
  },
  addButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.forest,
  },
  addButtonPressed: { backgroundColor: colors.forestDeep },
  addButtonText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.white,
  },
  page: { paddingHorizontal: spacing.screen, paddingTop: 4, paddingBottom: spacing.xxl, gap: 10 },
  skeletonList: { gap: 10 },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.card,
    backgroundColor: colors.mist,
    flexShrink: 0,
  },
  copy: { flex: 1, minWidth: 0, gap: 8 },
  placeholderLine: { height: 8, borderRadius: radius.sm, backgroundColor: colors.mist },
  placeholderTitle: { width: '65%' },
  placeholder: { backgroundColor: colors.mist },
  messageCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.card,
    padding: 14,
    gap: 4,
  },
  banner: { marginBottom: 10 },
  messageTitle: { fontFamily: fontFamily.bold, fontSize: 15, lineHeight: 20, color: colors.ink },
  messageBody: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, color: colors.bannerSubtitle },
  link: { marginTop: 4, fontFamily: fontFamily.bold, fontSize: 13, color: colors.forest },
});
