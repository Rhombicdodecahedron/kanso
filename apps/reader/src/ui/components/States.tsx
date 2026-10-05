import { ActivityIndicator, View } from 'react-native';

import { colors, space } from '../theme';
import { Button } from './Buttons';
import { Txt } from './Txt';

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm }}>
      <Txt size={17} weight="600" center>{title}</Txt>
      {body ? <Txt dim center>{body}</Txt> : null}
      {action ? <Button label={action.label} onPress={action.onPress} style={{ marginTop: space.md }} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm }}>
      <Txt size={17} weight="600" center>Something went wrong</Txt>
      <Txt dim center selectable>{message}</Txt>
      {onRetry ? <Button label="Retry" kind="secondary" onPress={onRetry} style={{ marginTop: space.md }} /> : null}
    </View>
  );
}
