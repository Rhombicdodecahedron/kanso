import { ActivityIndicator, Pressable, View, type PressableProps, type ViewStyle } from 'react-native';

import { colors, radius, space } from '../theme';
import { Txt } from './Txt';

type Props = Omit<PressableProps, 'style'> & {
  label: string;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
  small?: boolean;
  style?: ViewStyle;
};

export function Button({ label, kind = 'primary', busy, small, disabled, style, ...rest }: Props) {
  const bg = kind === 'primary' ? colors.accent : kind === 'secondary' ? colors.surfaceHigh : 'transparent';
  const fg = kind === 'primary' ? '#1A1306' : kind === 'danger' ? colors.danger : colors.text;
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
          borderWidth: kind === 'ghost' ? 1 : 0,
          borderColor: colors.border,
        },
        style,
      ]}
      {...rest}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : <Txt size={small ? 13 : 15} weight="600" color={fg}>{label}</Txt>}
    </Pressable>
  );
}

export function IconButton({ glyph, onPress, label, active }: { glyph: string; onPress: () => void; label: string; active?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={10} style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
      <Txt size={20} color={active ? colors.accent : colors.text}>{glyph}</Txt>
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
        backgroundColor: active ? colors.accent : colors.surfaceHigh,
        marginRight: space.sm,
      }}
    >
      <Txt size={13} weight="600" color={active ? '#1A1306' : colors.text}>{label}</Txt>
    </Pressable>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}
