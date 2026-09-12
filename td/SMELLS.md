# Code smells — `td/Product.ts`

Quick review of `Product.ts` (the Prisma/TypeScript translation of the
`fromCsharp/Models/*.cs` originals).

## 1. God class — `Product`

`Product` owns catalog data, pricing, stock, supplier assignment, warehouse
reference, *and* notification generation, and persists itself via direct
`prisma.product.update()` calls in almost every method (`addImage`,
`addDiscount`, `addSupplierToRegion`, `setMargin`, `receiveStock`, `sell`,
`deprecate`). It's simultaneously a domain entity and its own repository —
no separation between business rules and persistence. (lines 66–236)

This is also why `Product.test.ts` has to `vi.mock("@prisma/client", ...)`
just to construct a `Product` and call its behavior methods in a test — a
plain domain object shouldn't require stubbing a database client to be
unit-testable at all. That coupling is a direct symptom of this smell, not
a separate testing concern.

## 2. Feature envy / misplaced responsibility — notification building

`sell()` (184–201) and `deprecate()` (205–222) build `Notification` objects
inline (via the shared `mkNotif` helper, 225–235), including hardcoded
subject/body strings and a hardcoded `"customers@omniproduct.com"` recipient
(221). This isn't something a `Product` should know how to do — it belongs
in a dedicated notifier/service.

## 3. Duplicated code

The regional-supplier-notification loop is copy-pasted between `sell()`
(198–200) and `deprecate()` (216–218), differing only in the subject/body
text passed to `mkNotif`. `mkNotif` itself reduces the duplication in
*building* each `Notification` object, but the *looping over suppliers* is
still duplicated verbatim in both methods — same shape, same bug surface
twice.

## 4. Primitive obsession — string-typed status/channel logic

`PrdStat` and `Chnl` are string union types, and `getDisplayLabel()`
(115–119) and `sell()`/`deprecate()` branch on string comparisons
(`this.stat === "deprecated"`, `this.stk === 0`). Fine as literal types, but
state transitions (`active → out_of_stock → deprecated`) aren't modeled or
guarded anywhere — nothing stops setting `stat` back to `"active"` after
`deprecate()`, and `sell()` never checks `stat !== "deprecated"` before
selling.

## 5. Inconsistent transactional/consistency guarantees

Every mutator updates in-memory state *then* awaits a `prisma...update()`
call. If the DB call throws, the in-memory object is already out of sync
with the DB (e.g. `stk` decremented in `sell()` at line 187 before the
`await` at 192 — a failed write leaves the object claiming stock was sold).
No rollback, no transaction wrapping.

## 6. `notifications` grows unbounded, never persisted or flushed

`this.notifs.push(...)` accumulates in memory across `sell()` and
`deprecate()` calls (199, 217, 221) but there's no `Notification` table
write and nothing ever drains the array — it's a silent memory leak on any
long-lived `Product` instance, and notifications are lost if the process
restarts.

## 7. Weak error handling — generic `Error` for domain violations

`addSupplierToRegion` (145) and `sell` (185) throw plain `Error` for
business-rule violations ("no supplier for region", "not enough stock").
Callers can't distinguish these from unrelated bugs/exceptions without
string-matching the message.

## 8. Magic numbers

`Price` hardcodes `margin = 20` and `vat = 20` in its constructor (55–56)
with no named constant and no explanation of why 20% is the default for
every product.

## 9. Comment describes a symptom, not fixed by the code

The file-level comment (lines 1–9) explains that the C# version's dual
representation (`SyncEfColumns`/`HydrateFromEfColumns`) is "gone" — true for
storage, but the class still exhibits the same class of problem in miniature:
`Price` is a plain object with public mutable fields (`mgn`, `vat` set
directly at 164, 187) that the containing `Product` must remember to persist
manually on every mutation; there's no single source of truth enforced by
the type system, just discipline.

## 10. `suppliersRegions: Map<string, Supplier>` vs. relational modeling

Using a `Map` for an in-memory field that's persisted through a join table
(`ProductSupplier`, line 150) means every read of `suppliersRegions` after
construction is unsound unless the object was freshly loaded with the map
correctly rehydrated — but nothing in this file shows how `suppliersRegions`
gets populated when a `Product` is loaded from the DB (no `findUnique`/
mapping code present here), so the map risks silently being stale or empty.

## 11. Cryptic abbreviations everywhere — naming smell

Most identifiers in the file are abbreviated to the point of requiring
guesswork, even though class/interface names stayed full (`Supplier`,
`Warehouse`, `Notification`): type aliases (`Chnl`, `PrdStat`), fields (`nm`,
`slg`, `dscs`, `imgs`, `splrRgns`, `wgt`, `dims`, `qty`, `stk`, `stat`,
`notifs`), interface members (`Notification.recip/subj/bod/chnl/prdId`), and
params (`ctx`, `dscCode`, `rgn`, `mgnPct`). None of these save meaningful
typing effort over the full word, but they cost every reader a mental
lookup/disambiguation pass (is `stat` status or statistics? `dscs` discounts
or descriptions?). It's also internally inconsistent — type/class names are
spelled out while the fields and params of those same types are abbreviated
(`class Supplier { nm, eml, rgn }`), so there's no single rule a reader can
learn and apply.

## 12. Unused variable — `sell()`'s supplier loop

`sell()`'s regional-supplier loop (198) destructures `for (const [rgn, s] of
this.splrRgns)` but never reads `rgn` — the region key is bound and then
silently ignored. This is intentionally left uncatchable by the build:
`tsconfig.json` doesn't set `noUnusedLocals`/`noUnusedParameters`, so
`tsc --noEmit` stays silent and there's no ESLint config in `td/` either —
students have to actually read the loop body to notice `rgn` is dead, not
rely on the compiler to point at it. `deprecate()`'s equivalent loop at 216
still uses the blank-slot form (`for (const [, s] of ...)`), so the two
loops are now also inconsistent with each other in addition to being
duplicated (see smell #3).

## 13. Non-null assertion (`!`) silencing a real null case

`receiveStock()` (174–182) logs `this.wh!.nm` — asserting `warehouse` is
never `null` even though the constructor's `wh: Warehouse | null` parameter
(78, 96) says otherwise, and nothing upstream guarantees a `Product` always
has a warehouse assigned before stock is received. Unlike
`addSupplierToRegion()`, which does the honest thing (`if (!s) throw new
Error(...)`, line 145), this uses `!` to make the type checker stop
complaining instead of handling the `null` case — if `wh` is ever actually
`null` here, it throws a runtime `TypeError: Cannot read properties of null`
with no domain-meaningful error message, and `tsc --noEmit` won't catch it
because the assertion tells the compiler to trust the developer.

## 14. Type widening forcing an `as` cast — `sell()`

`sell()` (191–194) writes `let nextStat = "out_of_stock";` before assigning
it to `this.stat`. Because it's declared with `let` and no annotation,
TypeScript infers `nextStat: string` (widened), not the literal type
`"out_of_stock"` — so `this.stat = nextStat` doesn't type-check against
`stat: PrdStat` and needs `as PrdStat` to compile. The cast silences the
error instead of fixing the actual issue: nothing stops a typo like
`"out_of_stok"` from being assigned to `nextStat` and then cast straight
through to `this.stat` with zero compiler complaint, defeating the whole
point of `PrdStat` being a union type in the first place. (`const nextStat =
"out_of_stock"` would have kept the literal type and needed no cast — this
is the classic `let`-vs-`const`-and-literal-types trap.) Compare with
`deprecate()` (207), which assigns the literal directly
(`this.stat = "deprecated"`) and type-checks cleanly with no cast at all.

## 15. Floating promise — `addDiscount()`

`addDiscount()` (132–139) mutates `this.dscs` and `this.updatedAt`
synchronously, then calls `prisma.product.update(...)` **without `await`**
— unlike every sibling mutator (`addImage`, `addSupplierToRegion`,
`setMargin`, `receiveStock`, `sell`, `deprecate`), which all `await` their
Prisma call. The method is still declared `async (): Promise<void>` and
still compiles cleanly (`tsc --noEmit` has no built-in floating-promise
check — that's an ESLint rule, `@typescript-eslint/no-floating-promises`,
and there's no ESLint config in `td/`, see smell #12), so nothing signals
the bug at the type level. The practical effect: `await product.addDiscount(...)`
at a call site resolves as soon as the synchronous body finishes, before the
DB write completes or even settles — a caller that assumes "awaited ⇒
persisted" is wrong, the write races the rest of the request, and if the
Prisma call rejects, it surfaces as an unhandled promise rejection instead
of a catchable error at the call site.

## 16. Unnecessary getters/setters — `Price`

`Price` now has `getAmt`/`setAmt`, `getCcy`/`setCcy`, `getMgn`/`setMgn`
(added after `getResellerPrice()`) that do nothing but read or reassign an
already-public field (`amt`, `ccy`, `mgn` are all public, no `private`
anywhere in the class). This is boilerplate that provides zero real
encapsulation — anyone can already do `price.amt = -50` directly, so the
setters don't guard against anything (no validation, e.g. `setAmt` happily
accepts a negative amount), and the getters don't compute or hide
anything the field itself doesn't already expose. Worse, they're dead:
nothing in `Product.ts` calls them — `setMargin()` still mutates
`this.price.mgn` directly (164) instead of going through `setMgn()`, so the
class now has two inconsistent ways to do the same mutation.

## 17. "Tell, don't ask" violations — reaching into collaborators' fields

Several methods pull a raw field out of another object and use it directly,
instead of asking that object to do the work (or expose the derived
value/behavior itself):

- `setMargin()` (188): `this.price.mgn = mgnPct` reaches directly into
  `Price`'s field. This is the sharpest case — `Price` already has a
  `setMgn(mgn: number)` setter (smell #16), so `Product` bypasses its own
  collaborator's API to poke the field instead, meaning the same mutation
  now happens two different ways in the codebase depending on which line
  you're reading.
- `sell()` (227), `deprecate()` (245, 249): `s.eml` is read directly off
  each `Supplier` to build a notification recipient. `Supplier` never gets
  asked "who do I notify?" or "build me a notification" — `Product` decides
  that a `Supplier`'s email *is* its notification recipient and reaches in
  to get it, which is also what makes the notification-building logic
  impossible to reuse or override per-supplier (see smell #2).
- `receiveStock()` (202): `this.wh!.nm` is read directly off `Warehouse`
  for a log line, rather than asking the warehouse to identify/describe
  itself (e.g. a `describe()`/`toString()`-style method). Bundled with the
  non-null assertion (smell #13), so this line is actually two smells at
  once.
- `Product.getResellerPrice()` (183–186, see smell #18): chains
  `this.price.amt`, `this.price.mgn`, `this.price.vat` — three separate
  reaches past its immediate collaborator (`this.price`) into that
  collaborator's own fields — instead of asking `price` to compute its own
  reseller price. This is the sharpest Law of Demeter violation in the
  file: a method with the exact same name and purpose as
  `Price.getResellerPrice()` already exists one call away, and this method
  ignores it entirely.

There is no longer a "does it right" example of this pattern left in the
file — see smell #18.

## 18. Duplicated pricing formula that bypasses its own collaborator

`Product.getResellerPrice()` (183–186) used to simply delegate:
`return this.price.getResellerPrice();`. It now re-implements the exact
same margin/VAT formula inline —
`(this.price.amt * this.price.mgn) / 100`, then VAT on top, mirroring
`Price.getResellerPrice()` (59–63) line for line — instead of calling it.
`Price.getResellerPrice()` is untouched and still correct (and still worth
unit-testing on its own), but nothing in `Product` calls it anymore, so:

- The formula now exists in two places. If pricing rules change (say, VAT
  applies to the full amount instead of just the margin), a maintainer has
  to remember to update both `Price.getResellerPrice()` *and*
  `Product.getResellerPrice()` — miss one and the two methods silently
  disagree with no compiler warning, since both are individually valid
  TypeScript.
- It compounds smell #17's Law of Demeter violation: `Product` no longer
  just "asks" `price` for anything price-related — it reaches through
  `price` into `amt`/`mgn`/`vat` directly, so `Price` could change its
  internal field names or representation (e.g. switch `mgn` to a computed
  getter, or store VAT differently) and silently break
  `Product.getResellerPrice()` without touching `Price`'s own public API.

## `Product.test.ts` — deliberate design, not a smell

## `Product.test.ts` — deliberate design, not a smell

Worth calling out explicitly in review so it isn't mistaken for an
oversight: `Product.test.ts` asserts against the *proper, non-abbreviated*
names (`amount`, `name`, `email`, `region`, `suppliersRegions`, `recipient`,
`subject`, `body`, `channel`, `productId`, ...) rather than the current
abbreviated ones. Every access goes through an `as any` cast so the file
still compiles against today's abbreviated `Product.ts` — the naming issue
surfaces as a failing runtime assertion with a descriptive message, not a
compiler error, which is what makes it useful as a students' checklist for
fixing smell #11.

The suite also stubs `@prisma/client` via `vi.mock` purely so importing
`Product.ts` and calling `sell()`/`deprecate()` doesn't require a live
database connection (see smell #1). By design, the tests must not assert
that `prisma.product.update`/`upsert` was called, nor check any persisted
state — they exercise only in-memory behavior and naming, not persistence.

## Carried over from the C# original (worth flagging in review even though "fixed")

- `fromCsharp/Models/Product.cs` had an intentional bug: `AddDiscount` (158–164)
  forgets to call `SyncEfColumns()`, so `DiscountsCsv` drifts from `Discounts`.
  The TS version removes the dual representation entirely, which is the right
  fix — but it's worth confirming in review that *no* remaining method in
  `Product.ts` has an analogous "forgot to persist a mutated field" bug (e.g.
  `addSupplierToRegion` never touches `updatedAt` column via Prisma explicitly
  outside the upsert — check this is actually consistent).
