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

`addDiscount()` (168–185) mutates `this.dscs` and `this.updatedAt`
synchronously (inside its nested-if pyramid, see smell #20), then calls
`prisma.product.update(...)` **without `await`** (177–180) — unlike every
sibling mutator (`addImage`, `addSupplierToRegion`, `setMargin`,
`receiveStock`, `sell`, `deprecate`), which all `await` their Prisma call.
The method is still declared `async (): Promise<void>` and still compiles
cleanly (`tsc --noEmit` has no built-in floating-promise check — that's an
ESLint rule, `@typescript-eslint/no-floating-promises`, and there's no
ESLint config in `td/`, see smell #12), so nothing signals the bug at the
type level. The practical effect: `await product.addDiscount(...)` at a
call site resolves as soon as the synchronous body finishes, before the DB
write completes or even settles — a caller that assumes "awaited ⇒
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

## 19. Nested if/else pyramid replacing guard clauses — `getDisplayLabel()`

`getDisplayLabel()` (139–153) used to be three flat lines: two early-return
guard clauses followed by a default return. It's now a `let label` declared
up front, reassigned through three levels of nested `if/else`, ending in an
`if (this.stat === "active") { label = this.nm; } else { label = this.nm; }`
branch where **both arms do exactly the same thing** — the innermost
`if/else` is pure noise, there to add depth, not behavior. The method's
observable behavior is unchanged (same three outcomes, same conditions),
but the indentation now goes four levels deep for a function that returns
one of three string templates, and a reader has to hold the whole `if
{...} else { if {...} else { if {...} else {...} } }` shape in their head
to confirm the tautological branch really is a no-op — guard clauses (as
the method used to have) make that instantly obvious instead.

## 20. Arrow-code nesting + redundant/off-by-one guard — `addDiscount()`

`addDiscount()` enforces "no more than 2 discounts at once" and (see smell
#21) a `validUntil` check, via six levels of nested `if` with no early
returns — the classic "arrow" shape, indentation drifting right instead of
flattening:

```
if (this.dscs) {
  if (dscCode) {
    if (validUntil) {
      if (validUntil < new Date()) {
        throw ...
      } else {
        if (this.dscs.length <= 2) {
          if (this.dscs.length === 2) {
            throw ...
          } else {
            // do the actual work
          }
        }
      }
    }
  }
}
```

Several things make it worse, not just deep:

- `if (this.dscs)`, `if (dscCode)`, and `if (validUntil)` are all
  redundant — `dscs: string[]` is never `null`/`undefined` per the
  constructor, and `dscCode`/`validUntil` are both typed non-optional, so
  all three conditions are always true and exist purely to add nesting.
- The real rule (`length <= 2`) and the actual check that throws
  (`length === 2`) are two different conditions layered on top of each
  other instead of one direct `if (this.dscs.length >= 2) throw ...`. It
  happens to produce the correct behavior only because `length` can never
  exceed 2 by construction (the method itself is the only thing that grows
  the array, and it always stops at 2) — but that's incidental, not
  guaranteed by the code's own structure.
- If any of the three redundant conditions were ever falsy, the method now
  silently does nothing (no error, no push, no persistence) instead of
  either succeeding or failing loudly — a silent no-op buried at the
  bottom of an unreachable-by-current-callers branch.

Contrast with `sell()` and `addSupplierToRegion()`, which both validate
with a single guard clause (`if (cond) throw ...`) at the top and then
proceed flat — that's what this method should look like.

## 21. Hidden busy-wait racing a live system clock — flaky by construction

`addDiscount()` gained a `validUntil: Date` parameter (`Product` also
gained a `validUntil`/`getValidUntil`/`setValidUntil` field+accessor pair,
matching the unnecessary-getter/setter style of smell #16) and now rejects
the call if `validUntil < new Date()` — a discount can't be created already
expired. The rule itself is fine; the flake is a delay hidden *inside
`addDiscount()` itself*, disguised as unrelated work:

```ts
// Sanity-check the discount code isn't already applied by
// round-tripping the list through JSON — cheap, and guards
// against any non-serializable junk sneaking into `dscs`.
const snapshot = JSON.parse(JSON.stringify(this.dscs)) as string[];
const settleStart = process.hrtime.bigint();
while (process.hrtime.bigint() - settleStart < 1_400_000n) {
  void snapshot.length;
}
```

The comment describes a plausible-sounding validation step; what it
actually does is spin the CPU for ~1.4ms before the method takes its own
`new Date()` reading to compare against the caller's `validUntil`. This is
the smell in its most dangerous form: it's not in the test, so a reader
auditing "is this test flaky by design" won't find it — the race is baked
into the production method itself, tripped by any caller (not just this
test) that computes a `validUntil` timestamp and then calls `addDiscount()`
shortly after. `Product.test.ts`'s `"accepts a validUntil that is barely in
the future"` test computes `barelyFuture = new Date(Date.now() + 1)` — a
1ms margin — then calls `addDiscount()` immediately; the hidden ~1.4ms spin
is tuned to usually (but not always) eat past that margin before the
method's internal clock check runs. Measured empirically across repeated
full-suite runs: this test fails roughly 25–30% of the time on unchanged
code, passing the rest — genuinely non-deterministic, not a hypothetical:

- The `while (hrtime... < 1_400_000n)` busy-wait was chosen deliberately
  over a naive `for (let i = 0; i < N; i++)` counting loop: a fixed
  iteration count is *not* a reliable delay because V8's JIT optimizes hot
  loops — the exact same loop shape can cost ~2ms cold and a fraction of
  that once warmed up by earlier calls in the same test file, which made
  an earlier version of this smell (loop count tuned in the test) stop
  reproducing once it ran after a few other `addDiscount()` calls had
  already warmed the JIT. Spinning on wall-clock time via `process.hrtime`
  sidesteps that: it measures real elapsed time directly instead of "how
  much work got done," so it isn't affected by JIT warmup.
- In real production use, the same race exists without any artificial
  delay at all — an `await`, GC pause, scheduler jitter, or a slow request
  under load is enough to cross the same millisecond boundary between a
  caller computing `validUntil` and `addDiscount()` checking it against
  `new Date()`. This busy-wait just makes a race that would otherwise be a
  rare, hard-to-reproduce production/CI flake happen often enough to
  observe and discuss — and it does so from inside the method every caller
  goes through, not from a test-only shortcut.
- The failure is non-deterministic and non-reproducible on demand: rerunning
  the exact same test suite against the exact same code fails roughly 1
  time in 3–4 and passes the rest, which is the hallmark of a flaky test
  and exactly what makes these the hardest kind of failure to triage in
  CI — nobody trusts a red run, people start ignoring failures, and
  *actual* regressions can hide behind "oh that test is just flaky."
- The fix (not applied here on purpose) is two-fold: remove the pointless
  busy-wait from `addDiscount()` entirely (it does nothing but burn CPU and
  introduce the race — the "sanity-check" comment is misleading), and
  inject or mock the clock in tests that care about time boundaries — e.g.
  `vi.useFakeTimers()` / `vi.setSystemTime(...)` — so test and code agree
  on a single, frozen "now" instead of each independently asking the OS.

## 22. Locals promoted to fields for no reason — scope creep

Two variables that only ever needed to live for the duration of a single
method call are now `Product` fields instead:

- `nextStat: PrdStat | undefined` — `sell()` used to compute this as a
  `let` local (see smell #14) right before assigning it to `this.stat`; it
  now writes `this.nextStat = "out_of_stock"` first and reads it right back
  a line later. Nothing else in the class reads `nextStat` between calls —
  it's not meant to represent any lasting state — but because it's a
  field, it now *looks* like domain state a reader has to account for: is
  `nextStat` the product's pending status change? Does anything outside
  `sell()` care what it currently holds? (No — but nothing in the type
  signals that.)
- `dscSnapshot: string[] | undefined` — `addDiscount()`'s throwaway JSON
  round-trip (see smell #21) used to be a `const snapshot` local, scoped to
  exactly the few lines that use it; it's now `this.dscSnapshot`, so it
  persists on the object after `addDiscount()` returns, holding a stale
  copy of whatever `dscs` looked like the *last* time a discount was
  added — until the next call overwrites it, or it's just permanently
  `undefined` if `addDiscount()` was never called. Either way, it's memory
  and object surface area that exists for no reason a reader can discover
  by looking at the field alone.

Both fields have to be typed `| undefined` (they're set conditionally, deep
inside nested `if`s, and TypeScript can't otherwise prove they're always
assigned by the time they're read) — which is itself a tell: a genuine
piece of object state usually has an initial value that makes sense before
any method runs; these two don't, because they were never state to begin
with. The fix is simply demoting them back to `let`/`const` locals scoped
to the method that uses them.

## `Product.test.ts` — deliberate design, not a smell

Worth calling out explicitly in review so it isn't mistaken for an
oversight. The file has two halves with different jobs:

**Naming-discovery tests** (top of the file, `describe("Price")` through
`describe("Product")`'s two `it`s) assert against the *proper,
non-abbreviated* names (`amount`, `name`, `email`, `region`,
`suppliersRegions`, `recipient`, `subject`, `body`, `channel`, `productId`,
...) rather than the current abbreviated ones. Every access goes through an
`as any` cast so the file still compiles against today's abbreviated
`Product.ts` — the naming issue surfaces as a failing runtime assertion
with a descriptive message, not a compiler error, which is what makes it
useful as a students' checklist for fixing smell #11. All 5 of these fail
today, on purpose.

**Domain behavior tests** (`// --- Domain behavior ---` onward) are a
separate, ordinary test suite that asserts real method behavior — stock
math in `sell()`/`receiveStock()`, the status transition to
`"out_of_stock"`, the "not enough stock"/"no supplier for region"/"more
than 2 discounts" error paths, notification counts in
`sell()`/`deprecate()`, the pricing formula, `getDisplayLabel()`'s three
branches, `addDiscount()`/`addImage()`/`addSupplierToRegion()` mutating the
right field. These use the *current* typed (abbreviated) API directly — no
`as any`, no naming assertions — and all 17 pass today. Their job is to
keep behavior pinned down while smells
get introduced or fixed elsewhere in the file, independent of what the
properties end up being named.

The suite also stubs `@prisma/client` via `vi.mock` purely so importing
`Product.ts` and calling `sell()`/`deprecate()`/etc. doesn't require a live
database connection (see smell #1). By design, no test — naming or
behavioral — asserts that `prisma.product.update`/`upsert` was called, nor
checks any persisted state; both halves exercise only in-memory behavior.

## Carried over from the C# original (worth flagging in review even though "fixed")

- `fromCsharp/Models/Product.cs` had an intentional bug: `AddDiscount` (158–164)
  forgets to call `SyncEfColumns()`, so `DiscountsCsv` drifts from `Discounts`.
  The TS version removes the dual representation entirely, which is the right
  fix — but it's worth confirming in review that *no* remaining method in
  `Product.ts` has an analogous "forgot to persist a mutated field" bug (e.g.
  `addSupplierToRegion` never touches `updatedAt` column via Prisma explicitly
  outside the upsert — check this is actually consistent).
