# Runtime conventions (`packages/source-api`)

The runtime gives translated Kotlin extension code the APIs it was written against (Kotlin stdlib,
Java, Android, OkHttp, Jsoup, kotlinx.serialization, keiyoushi `core`). The translator emits JS that
calls into it. These rules keep the two sides in agreement.

## Value representation

| Kotlin | JS |
|---|---|
| `List`, `MutableList`, `Array`, `IntArray` | `Array` |
| `ByteArray` | `Int8Array` (signed bytes, like the JVM) |
| `Map` / `Set` | `Map` / `Set` |
| `Char` | 1-character `string` |
| `Int`, `Long`, `Double`, `Float` | `number` (Long is not 64-bit safe) |
| `null` | `null` (treat `undefined` as null when reading) |
| `Unit` | `undefined` |

## Classes and members

- Kotlin classes become JS classes. Kotlin **properties** become JS properties or getters, and
  **functions** become methods with the same name. `response.code`, `url.host`, `request.url` are
  properties; `element.text()` and `document.location()` are methods.
- When a Kotlin class has a property and a method with the same name (OkHttp `Response.headers` and
  `headers(name)`), the property keeps the name and the method is `name$call`.
- `companion object` members and Java statics become JS statics on the class: `SManga.COMPLETED`,
  `Base64.DEFAULT`, `MessageDigest.getInstance("MD5")`.
- Nested classes become statics too: `Request.Builder`, `Filter.Select`.
- A **constructor** that Kotlin code may call with named arguments declares `static $params = ['a', 'b']`.
  The translator passes `Named` (from `src/kotlin/named.ts`) as the last argument and `construct()`
  reorders the arguments.
- A Kotlin `object` (singleton) is a plain JS object or a class instance.
- Interfaces implemented by user code are JS classes with `static $interface = true`.

## Extension functions and properties

Extension functions (`String.substringAfter`, `Response.asJsoup`, `ByteArray.toHexString`, ...) are
`ExtDef`s built with the helpers in `src/kotlin/hof.ts`:

```ts
ext('decodeHex', (x) => typeof x === 'string', (s: string) => ...)    // receiver first
extProp('size', (x) => Array.isArray(x), (xs) => xs.length)           // extension property
hof('map', isIterable, function* (xs, f) { ... yield f(x) ... })      // takes lambdas
```

- The receiver predicate does a runtime check: several extensions can share a name, and the first
  match wins.
- Higher-order functions that call lambdas are generators that `yield` each lambda call. That gives
  both a sync and an async (suspending-lambda) driver from a single definition.
- **Receiver lambdas** (`T.() -> R`, as in `apply`, `buildString`, `buildJsonObject`) receive the
  receiver as their **first argument**.

Each module exports its extensions as `ExtDef[]` (or a `Record<string, ExtDef[]>`). Top-level
functions and classes are plain exports. `src/modules.ts` maps Kotlin fully qualified names to these
values.

## Suspend functions

A Kotlin `suspend fun` (or anything that does I/O, like OkHttp `Call.execute()`) returns a
`Promise`. The translator awaits these calls. Everything else stays synchronous.

## Errors

Throw the classes from `src/kotlin/core.ts` (`IllegalArgumentException`, `NumberFormatException`,
`IOException`, ...) so Kotlin `catch (e: X)` blocks match.

## Tests

Use vitest, one `test/<module>.test.ts` per module, and compare against known JVM behaviour.
