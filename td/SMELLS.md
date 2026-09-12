# Code smells — `td/Product.ts`

Quick review of `Product.ts` (the Prisma/TypeScript translation of the
`fromCsharp/Models/*.cs` originals).

## 1. God class — `Product`

`Product` owns catalog data, pricing, stock, supplier assignment, warehouse
reference, *and* notification generation, and persists itself via direct
`prisma.product.update()` calls in almost every method (`addImage`,
`addDiscount`, `addSupplierToRegion`, `setMargin`, `receiveStock`, `sell`,
`deprecate`). It's simultaneously a domain entity and its own repository —
no separation between business rules and persistence. (lines 66–247)

## 2. Feature envy / misplaced responsibility — notification building

`sell()` (184–209) and `deprecate()` (213–246) build `Notification` objects
inline, including hardcoded subject/body strings and a hardcoded
`"customers@omniproduct.com"` recipient (239). This isn't something a
`Product` should know how to do — it's duplicated across two methods and
belongs in a dedicated notifier/service.

## 3. Duplicated code

The regional-supplier-notification loop is copy-pasted between `sell()`
(198–208) and `deprecate()` (224–234), differing only in the subject/body
text. Same shape, same bug surface twice.

## 4. Primitive obsession — string-typed status/channel logic

`ProductStatus` and `Channel` are string union types, and `getDisplayLabel()`
(115–119) and `sell()`/`deprecate()` branch on string comparisons
(`this.status === "deprecated"`, `this.stock === 0`). Fine as literal types,
but state transitions (`active → out_of_stock → deprecated`) aren't modeled
or guarded anywhere — nothing stops setting `status` back to `"active"` after
`deprecate()`, and `sell()` never checks `status !== "deprecated"` before
selling.

## 5. Inconsistent transactional/consistency guarantees

Every mutator updates in-memory state *then* awaits a `prisma...update()`
call. If the DB call throws, the in-memory object is already out of sync
with the DB (e.g. `stock` decremented in `sell()` at line 187 before the
`await` at 192 — a failed write leaves the object claiming stock was sold).
No rollback, no transaction wrapping.

## 6. `notifications` grows unbounded, never persisted or flushed

`this.notifications.push(...)` accumulates in memory across `sell()` and
`deprecate()` calls (82, 199, 225, 237) but there's no `Notification` table
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
`Price` is a plain object with public mutable fields (`margin`, `vat` set
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

## Carried over from the C# original (worth flagging in review even though "fixed")

- `fromCsharp/Models/Product.cs` had an intentional bug: `AddDiscount` (158–164)
  forgets to call `SyncEfColumns()`, so `DiscountsCsv` drifts from `Discounts`.
  The TS version removes the dual representation entirely, which is the right
  fix — but it's worth confirming in review that *no* remaining method in
  `Product.ts` has an analogous "forgot to persist a mutated field" bug (e.g.
  `addSupplierToRegion` never touches `updatedAt` column via Prisma explicitly
  outside the upsert — check this is actually consistent).
