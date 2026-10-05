import { TextInput, type TextInputProps } from 'react-native';

import { colors, radius, space } from '../theme';

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.textFaint}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[{ backgroundColor: colors.surfaceHigh, color: colors.text, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 15 }, props.style]}
    />
  );
}
