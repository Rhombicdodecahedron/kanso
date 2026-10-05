import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';

import { colors, radius, space } from '../theme';
import { Txt } from './Txt';

export interface SnackbarMessage {
  text: string;
  action?: { label: string; onPress: () => void };
}

/** Shows one message at a time; a new one replaces the current one. */
export function useSnackbar() {
  const [message, setMessage] = useState<(SnackbarMessage & { id: number }) | null>(null);
  const seq = useRef(0);
  const show = useCallback((m: SnackbarMessage) => setMessage({ ...m, id: ++seq.current }), []);
  const hide = useCallback(() => setMessage(null), []);
  return { message, show, hide };
}

/** Bottom message with an optional action, hidden after a few seconds. Place it last in the screen. */
export function Snackbar({ message, onHide, duration = 5000 }: { message: (SnackbarMessage & { id: number }) | null; onHide: () => void; duration?: number }) {
  // Keeps the last message on screen while it fades out.
  const [shown, setShown] = useState(message);
  if (message && message !== shown) setShown(message);
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!message) {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => finished && setShown(null));
      return;
    }
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    const t = setTimeout(onHide, duration);
    return () => clearTimeout(t);
  }, [message, anim, onHide, duration]);

  if (!shown) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: space.lg, alignItems: 'center', paddingHorizontal: space.lg }}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={{
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          width: '100%',
          maxWidth: 520,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          backgroundColor: colors.surfaceHigh,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          paddingLeft: space.lg,
          paddingRight: shown.action ? space.xs : space.lg,
          minHeight: 48,
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <Txt size={14} numberOfLines={2} style={{ flex: 1, paddingVertical: space.md }}>{shown.text}</Txt>
        {shown.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              shown.action?.onPress();
              onHide();
            }}
            hitSlop={6}
            style={({ pressed }) => ({ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm, opacity: pressed ? 0.6 : 1 })}
          >
            <Txt size={14} weight="700" color={colors.accent} upper>{shown.action.label}</Txt>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}
