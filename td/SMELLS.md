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
