import { Text, type TextProps } from 'react-native';

import { colors } from '../theme';

type Props = TextProps & {
  size?: number;
  weight?: '400' | '500' | '600' | '700' | '800';
  color?: string;
  center?: boolean;
  dim?: boolean;
  faint?: boolean;
  upper?: boolean;
};

export function Txt({ size = 15, weight = '400', color, center, dim, faint, upper, style, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontSize: size,
          fontWeight: weight,
          color: color ?? (faint ? colors.textFaint : dim ? colors.textDim : colors.text),
          textAlign: center ? 'center' : undefined,
          textTransform: upper ? 'uppercase' : undefined,
          letterSpacing: upper ? 0.6 : undefined,
        },
        style,
      ]}
    />
  );
}
