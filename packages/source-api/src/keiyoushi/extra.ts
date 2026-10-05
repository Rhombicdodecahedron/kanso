// FQN map for the keiyoushi `core` helpers ported outside index.ts (Next.js, GraphQL, protobuf)
// and the QuickJs shim used by several extensions. Registered in src/runtime.ts.

import { ANNOTATION } from '../modules';
import { nextJsModules } from './nextjs';
import { graphQLModules } from './graphql';
import { protobufModules } from '../serialization/protobuf';
import { quickJsModules } from '../lib/quickjs';

export const extraKeiyoushiModules: Record<string, unknown> = {
  ...nextJsModules,
  ...graphQLModules,
  ...protobufModules,
  'kotlinx.serialization.protobuf.ProtoNumber': ANNOTATION,
  'kotlinx.serialization.protobuf.ProtoOneOf': ANNOTATION,
  'kotlinx.serialization.protobuf.ProtoPacked': ANNOTATION,
  'kotlinx.serialization.protobuf.ProtoType': ANNOTATION,
  ...quickJsModules,
};
