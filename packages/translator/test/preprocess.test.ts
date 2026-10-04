import { describe, expect, it } from 'vitest';
import { rewriteMultiDollar } from '../src/preprocess';

describe('multi-dollar strings', () => {
  it('keeps single $ literal and interpolates $$', () => {
    expect(rewriteMultiDollar('val q = $$"""query($id: ID) { a(id: $$id, b: $${x + 1}) }"""')).toBe(
      "val q = \"\"\"query(${'$'}id: ID) { a(id: $id, b: ${x + 1}) }\"\"\"",
    );
  });
  it('leaves normal strings alone', () => {
    expect(rewriteMultiDollar('val a = "$b"')).toBe('val a = "$b"');
  });
});
