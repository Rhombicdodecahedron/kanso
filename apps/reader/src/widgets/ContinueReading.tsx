// Home screen widget (iOS): the chapter being read. A strip of the current page (or the cover)
// fills the widget, with the title, chapter and progress over a dark fade. Tapping it opens the
// reader at that chapter. Its content is pushed by the app (see widgets/sync.ts).
import { Image, ProgressView, Rectangle, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { aspectRatio, clipped, containerBackground, font, foregroundStyle, frame, lineLimit, padding, resizable, tint, widgetURL } from '@expo/ui/swift-ui/modifiers';
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
  /** current page strip or cover, in the shared app group directory, or '' */
  image: string;
  /** deep link into the reader */
  url: string;
};

const ContinueReading = (props: ContinueReadingProps, env: WidgetEnvironment) => {
  'widget';
  // Code here runs in the widget's own runtime: values must be declared inside this function.
  const accent = '#E8B04B';
  const surface = '#17171B';
  const text = '#ECEAE6';
  const dim = '#C9C6BF';
  // Required by iOS 17+: the widget's own background (Kanso's dark surface, in light mode too).
  const bg = containerBackground(surface, 'widget');
  // The widget has no content margins (edge-to-edge image), so the text sets its own.
  const inset = padding({ all: 14 });
  const fill = frame({ maxWidth: 10000, maxHeight: 10000 });
  const small = env.widgetFamily === 'systemSmall';

  if (props.empty) {
    return (
      <VStack spacing={6} modifiers={[inset, widgetURL('kanso://'), bg]}>
        <Image systemName="books.vertical" color={accent} size={28} />
        <Text modifiers={[font({ textStyle: 'headline' }), foregroundStyle(text)]}>Kanso</Text>
        <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(dim)]}>Start reading a series to see it here</Text>
      </VStack>
    );
  }

  return (
    <ZStack alignment="bottomLeading" modifiers={[fill, widgetURL(props.url), bg]}>
      {props.image ? <Image uiImage={props.image} modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), fill, clipped()]} /> : <Rectangle modifiers={[foregroundStyle(surface), fill]} />}
      <Rectangle
        modifiers={[
          fill,
          foregroundStyle({
            type: 'linearGradient',
            colors: ['#0E0E1000', '#0E0E10B3', '#0E0E10F2'],
            startPoint: { x: 0.5, y: 0.15 },
            endPoint: { x: 0.5, y: 1 },
          }),
        ]}
      />
      <VStack alignment="leading" spacing={3} modifiers={[inset, frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'bottomLeading' })]}>
        <Spacer />
        {small ? null : <Text modifiers={[font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(accent)]}>CONTINUE READING</Text>}
        <Text modifiers={[font({ textStyle: small ? 'subheadline' : 'headline', weight: 'bold' }), foregroundStyle(text), lineLimit(small ? 2 : 1)]}>{props.title}</Text>
        <Text modifiers={[font({ textStyle: small ? 'caption2' : 'caption' }), foregroundStyle(dim), lineLimit(1)]}>
          {small ? props.chapter : `${props.chapter} · ${props.page}`}
        </Text>
        <ProgressView value={props.progress} modifiers={[tint(accent)]} />
      </VStack>
    </ZStack>
  );
};

export default createWidget<ContinueReadingProps>('ContinueReading', ContinueReading);
