// Home screen widget (iOS): the chapter being read, with its cover and progress. Tapping it opens
// the reader at that chapter. Its content is pushed by the app (see widgets/sync.ts).
import { HStack, Image, ProgressView, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { aspectRatio, clipShape, font, foregroundStyle, frame, lineLimit, resizable, tint, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export type ContinueReadingProps = {
  /** nothing read yet */
  empty: boolean;
  title: string;
  chapter: string;
  /** "Page 12 of 40" */
  page: string;
  /** 0..1 through the chapter */
  progress: number;
  /** cover copied into the shared app group directory, or '' */
  cover: string;
  /** deep link into the reader */
  url: string;
};

const ContinueReading = (props: ContinueReadingProps, env: WidgetEnvironment) => {
  'widget';
  // Code here runs in the widget's own runtime: values must be declared inside this function.
  const accent = '#E8B04B';
  const dim = '#9A9890';

  if (props.empty) {
    return (
      <VStack spacing={6} modifiers={[widgetURL('kanso://')]}>
        <Image systemName="books.vertical" color={accent} size={28} />
        <Text modifiers={[font({ textStyle: 'headline' })]}>Kanso</Text>
        <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(dim)]}>Start reading a series to see it here</Text>
      </VStack>
    );
  }

  const cover = props.cover ? (
    <Image uiImage={props.cover} modifiers={[resizable(), aspectRatio({ ratio: 2 / 3, contentMode: 'fill' }), clipShape('roundedRectangle', 8)]} />
  ) : (
    <ZStack modifiers={[aspectRatio({ ratio: 2 / 3, contentMode: 'fit' })]}>
      <Image systemName="book.closed" color={accent} size={24} />
    </ZStack>
  );

  const progress = <ProgressView value={props.progress} modifiers={[tint(accent)]} />;

  if (env.widgetFamily === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[widgetURL(props.url)]}>
        <HStack alignment="top" spacing={8}>
          <VStack modifiers={[frame({ width: 40 })]}>{cover}</VStack>
          <Spacer />
          <Image systemName="book.fill" color={accent} size={16} />
        </HStack>
        <Spacer />
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), lineLimit(2)]}>{props.title}</Text>
        <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(dim), lineLimit(1)]}>{props.chapter}</Text>
        {progress}
      </VStack>
    );
  }

  return (
    <HStack spacing={12} modifiers={[widgetURL(props.url)]}>
      {cover}
      <VStack alignment="leading" spacing={4}>
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(accent)]}>CONTINUE READING</Text>
        <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(2)]}>{props.title}</Text>
        <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(dim), lineLimit(1)]}>{props.chapter}</Text>
        <Spacer />
        <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(dim)]}>{props.page}</Text>
        {progress}
      </VStack>
      <Spacer minLength={0} />
    </HStack>
  );
};

export default createWidget<ContinueReadingProps>('ContinueReading', ContinueReading);
