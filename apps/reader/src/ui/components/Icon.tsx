import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import { colors } from '../theme';

type Names = Extract<SymbolViewProps['name'], object>;
/** SF Symbol name on iOS, Material Symbol name on Android. */
export type IconName = { ios: NonNullable<Names['ios']>; android: NonNullable<Names['android']> };

/** Icons used across the app, so the same action looks the same everywhere. */
export const icons = {
  back: { ios: 'chevron.left', android: 'arrow_back' },
  close: { ios: 'xmark', android: 'close' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh' },
  search: { ios: 'magnifyingglass', android: 'search' },
  options: { ios: 'line.3.horizontal.decrease.circle', android: 'tune' },
  settings: { ios: 'gearshape', android: 'settings' },
  sort: { ios: 'arrow.up.arrow.down', android: 'swap_vert' },
  web: { ios: 'safari', android: 'open_in_new' },
  clearAll: { ios: 'trash', android: 'delete_sweep' },
  moveUp: { ios: 'arrow.up', android: 'arrow_upward' },
  download: { ios: 'arrow.down.circle', android: 'download' },
  downloaded: { ios: 'checkmark.circle.fill', android: 'download_done' },
  queued: { ios: 'clock', android: 'schedule' },
  failed: { ios: 'exclamationmark.arrow.circlepath', android: 'error' },
  bookmark: { ios: 'bookmark', android: 'bookmark_border' },
  bookmarked: { ios: 'bookmark.fill', android: 'bookmark' },
  checked: { ios: 'checkmark.square.fill', android: 'check_box' },
  unchecked: { ios: 'square', android: 'check_box_outline_blank' },
  include: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  exclude: { ios: 'xmark.circle.fill', android: 'cancel' },
  neutral: { ios: 'circle', android: 'radio_button_unchecked' },
  markRead: { ios: 'checkmark.circle', android: 'done_all' },
  markUnread: { ios: 'circle', android: 'remove_done' },
  markPrevious: { ios: 'checkmark.circle.badge.questionmark', android: 'playlist_add_check' },
  delete: { ios: 'trash', android: 'delete' },
  prevChapter: { ios: 'backward.end.fill', android: 'skip_previous' },
  nextChapter: { ios: 'forward.end.fill', android: 'skip_next' },
} satisfies Record<string, IconName>;

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: ColorValue }) {
  return <SymbolView name={name} tintColor={color} size={size} weight="medium" resizeMode="scaleAspectFit" />;
}
