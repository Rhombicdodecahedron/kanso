import { ActivityIndicator, Pressable, View, type PressableProps, type ViewStyle } from 'react-native';

import { colors, radius, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

type Props = Omit<PressableProps, 'style'> & {
  label: string;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
  small?: boolean;
  style?: ViewStyle;
};

export function Button({ label, kind = 'primary', busy, small, disabled, style, ...rest }: Props) {
  const bg = kind === 'primary' ? colors.accent : kind === 'secondary' ? colors.accentSoft : 'transparent';
  const fg = kind === 'primary' ? '#1A1306' : kind === 'secondary' ? colors.accent : kind === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.md,
          paddingVertical: small ? 6 : 11,
          paddingHorizontal: small ? space.md : space.lg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
          borderWidth: kind === 'ghost' || kind === 'danger' ? 1 : 0,
          borderColor: kind === 'danger' ? 'rgba(229,105,91,0.4)' : colors.border,
        },
        style,
      ]}
      {...rest}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : <Txt size={small ? 13 : 15} weight="600" color={fg}>{label}</Txt>}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, active, color, size = 22, disabled }: { icon: IconName; onPress: () => void; label: string; active?: boolean; color?: string; size?: number; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, opacity: disabled ? 0.35 : pressed ? 0.5 : 1 })}
    >
      <Icon name={icon} size={size} color={active ? colors.accent : (color ?? colors.text)} />
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: space.md,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: active ? colors.accent : 'transparent',
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.border,
        marginRight: space.sm,
      }}
    >
      <Txt size={13} weight="600" color={active ? '#1A1306' : colors.textDim}>{label}</Txt>
    </Pressable>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

/** Icon-over-label action, for bottom action bars. */
export function Action({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const color = danger ? colors.danger : colors.text;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 4, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: pressed ? colors.surfaceHigh : undefined })}>
      <Icon name={icon} size={22} color={color} />
      <Txt size={11} weight="500" color={danger ? colors.danger : colors.textDim} numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}
