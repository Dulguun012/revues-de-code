# Code smells — `td/Product.ts` (ordered by fix complexity)

Reordered from simplest to most complex. Start with the top to build confidence; move to harder refactors later. The God class (smell #1) is the overarching goal at the end.

## TIER 1: Simplest fixes (naming, syntax, local scope)

### 11. Cryptic abbreviations everywhere — naming smell
Most identifiers in the file are abbreviated to the point of requiring guesswork, even though class/interface names stayed full (`Supplier`, `Warehouse`, `Notification`): type aliases (`Chnl`, `PrdStat`), fields (`nm`, `slg`, `dscs`, `imgs`, `splrRgns`, `wgt`, `dims`, `qty`, `stk`, `stat`, `notifs`), interface members (`Notification.recip/subj/bod/chnl/prdId`), and params (`ctx`, `dscCode`, `rgn`, `mgnPct`). None of these save meaningful typing effort over the full word, but they cost every reader a mental lookup/disambiguation pass (is `stat` status or statistics? `dscs` discounts or descriptions?). It's also internally inconsistent — type/class names are spelled out while the fields and params of those same types are abbreviated (`class Supplier { nm, eml, rgn }`), so there's no single rule a reader can learn and apply.

**Fix approach:** Global rename pass. Straightforward, no logic changes. Pre-requisite for making all other fixes readable to students.

---

### 12. Unused variable — `sell()`'s supplier loop
`sell()`'s regional-supplier loop (198) destructures `for (const [rgn, s] of this.splrRgns)` but never reads `rgn` — the region key is bound and then silently ignored. This is intentionally left uncatchable by the build: `tsconfig.json` doesn't set `noUnusedLocals`/`noUnusedParameters`, so `tsc --noEmit` stays silent and there's no ESLint config in `td/` either — students have to actually read the loop body to notice `rgn` is dead, not rely on the compiler to point at it. `deprecate()`'s equivalent loop at 216 still uses the blank-slot form (`for (const [, s] of ...)`), so the two loops are now also inconsistent with each other in addition to being duplicated (see smell #3).

**Fix approach:** Delete the unused `rgn`. Consistency fix.

---

### 9. Comment describes a symptom, not fixed by the code
The file-level comment (lines 1–9) explains that the C# version's dual representation (`SyncEfColumns`/`HydrateFromEfColumns`) is "gone" — true for storage, but the class still exhibits the same class of problem in miniature: `Price` is a plain object with public mutable fields (`mgn`, `vat` set directly at 164, 187) that the containing `Product` must remember to persist manually on every mutation; there's no single source of truth enforced by the type system, just discipline.

**Fix approach:** Update or remove the misleading comment once other issues are addressed.

---

### 8. Magic numbers
`Price` hardcodes `margin = 20` and `vat = 20` in its constructor (55–56) with no named constant and no explanation of why 20% is the default for every product.

**Fix approach:** Extract named constants (`DEFAULT_MARGIN`, `DEFAULT_VAT`). Optional: make them configurable.

---

### 23. Unused parameter — `addImage()`'s `overwrite`
`addImage(ctx: string, url: string, overwrite: boolean)` takes a third parameter that reads as meaningful — "should this replace an existing image at that context key?" — but the body never references `overwrite` at all. Like smell #12, `tsc --noEmit` doesn't catch this (`noUnusedParameters` isn't enabled in `tsconfig.json`), so it compiles silently — a caller can pass `addImage("hero", url, false)` expecting the existing image to be preserved and get it clobbered/renamed anyway, with nothing in the type system or the build warning that the parameter is dead.

**Fix approach:** Delete the parameter or implement the logic it's supposed to control. Straightforward signature fix.

---

### 13. Non-null assertion (`!`) silencing a real null case
`receiveStock()` (174–182) logs `this.wh!.nm` — asserting `warehouse` is never `null` even though the constructor's `wh: Warehouse | null` parameter (78, 96) says otherwise, and nothing upstream guarantees a `Product` always has a warehouse assigned before stock is received. Unlike `addSupplierToRegion()`, which does the honest thing (`if (!s) throw new Error(...)`, line 145), this uses `!` to make the type checker stop complaining instead of handling the `null` case.

**Fix approach:** Replace `this.wh!.nm` with `this.wh?.nm ?? "unknown"` or add a proper `null` check and throw. 2–3 lines.

---

### 14. Type widening forcing an `as` cast — `sell()`
`sell()` (191–194) writes `let nextStat = "out_of_stock";` before assigning it to `this.stat`. Because it's declared with `let` and no annotation, TypeScript infers `nextStat: string` (widened), not the literal type `"out_of_stock"` — so `this.stat = nextStat` doesn't type-check against `stat: PrdStat` and needs `as PrdStat` to compile. The cast silences the error instead of fixing the actual issue: nothing stops a typo like `"out_of_stok"` from being assigned to `nextStat` and then cast straight through to `this.stat` with zero compiler complaint, defeating the whole point of `PrdStat` being a union type in the first place. (`const nextStat = "out_of_stock"` would have kept the literal type and needed no cast — this is the classic `let`-vs-`const`-and-literal-types trap.)

**Fix approach:** Change `let` to `const`. One word, type-safe. Compare with `deprecate()` (207), which assigns the literal directly (`this.stat = "deprecated"`) and type-checks cleanly with no cast at all.

---

## TIER 2: Simple–medium fixes (method-level logic restructuring)

### 19. Nested if/else pyramid replacing guard clauses — `getDisplayLabel()`
`getDisplayLabel()` (139–153) used to be three flat lines: two early-return guard clauses followed by a default return. It's now a `let label` declared up front, reassigned through three levels of nested `if/else`, ending in an `if (this.stat === "active") { label = this.nm; } else { label = this.nm; }` branch where **both arms do exactly the same thing** — the innermost `if/else` is pure noise, there to add depth, not behavior.

**Fix approach:** Restore guard clauses. ~5 lines, high readability gain.

---

### 20. Arrow-code nesting + redundant/off-by-one guard — `addDiscount()`
`addDiscount()` enforces business rules via six levels of nested `if` with no early returns — the classic "arrow" shape. Several redundant conditions exist purely to add nesting (conditions that are always true given the types).

**Fix approach:** Extract guard clauses to the top: `if (!url || ...) throw ...` flattens the method immediately. Medium effort, significant readability win.

---

### 16. Unnecessary getters/setters — `Price`
`Price` has `getAmt`/`setAmt`, `getCcy`/`setCcy`, `getMgn`/`setMgn` that do nothing but read or reassign an already-public field. They provide zero real encapsulation — anyone can already do `price.amt = -50` directly, so the setters don't guard against anything, and the getters don't compute or hide anything the field itself doesn't already expose. Worse, they're dead: nothing in `Product.ts` calls them.

**Fix approach:** Delete all getters/setters. Or implement real validation (reject negative amounts). 1–2 method deletions or ~5 lines of validation added.

---

### 21. Hidden busy-wait racing a live system clock — flaky by construction
`addDiscount()` has a hidden ~1.4ms CPU spin (disguised as a "sanity-check" JSON round-trip) that makes a clock-race test fail 25–30% of the time on unchanged code. The race is baked into production code, not the test.

**Fix approach:** Remove the busy-wait. Replace with a proper mocked/injected clock in tests. ~10 lines of changes, high pedagogical value (teaches clock mocking).

---

### 22. Locals promoted to fields for no reason — scope creep
`nextStat` and `dscSnapshot` are method-local variables that persist as fields, creating confusing stale state and requiring `| undefined` typing.

**Fix approach:** Demote back to `let`/`const` locals inside their methods. ~5 lines, clarity win.

---

### 7. Weak error handling — generic `Error` for domain violations
`addSupplierToRegion` and `sell` throw plain `Error` for business-rule violations ("no supplier for region", "not enough stock"). Callers can't distinguish these from unrelated bugs without string-matching.

**Fix approach:** Create domain-specific error classes (`SupplierNotFoundError`, `InsufficientStockError`). ~20 lines of new error classes, then adjust throw statements.

---

## TIER 3: Medium fixes (cross-method duplication, complex branching)

### 3. Duplicated code
The regional-supplier-notification loop is copy-pasted between `sell()` (198–200) and `deprecate()` (216–218), differing only in the subject/body text.

**Fix approach:** Extract a `notifySuppliers(subject, body)` method. Eliminates the loop duplication. ~10 lines refactoring.

---

### 15. Floating promise — `addDiscount()`
`addDiscount()` mutates `this.dscs` and `this.updatedAt` synchronously, then calls `prisma.product.update(...)` **without `await`** — unlike every sibling mutator, which all `await` their Prisma call.

**Fix approach:** Add `await` before the Prisma call. One word.

---

### 24. Clean-code rulebook violated on purpose — `addImage()`
`addImage()` breaks no guard clauses (arrow-shaped nesting), has duplicated error messages, uses magic-string validation (`url.substring(0, 4) === "http"`), hand-rolled email validation, and a silent last-write-wins loop with no `break`.

**Fix approach:** Flatten with guard clauses at the top, use proper `URL` or regex validation, add clarifying `break` or restructure loop. ~20 lines refactoring, major readability gain.

---

### 25. Every `else` now does *something* — but the fallbacks compound the mess
Each `else` branch in `addImage()`'s supplier-matching logic now has behavior, but the fallbacks are inconsistent: no email → generic marker (loses identity), no region → reach into warehouse (Tell-Don't-Ask), malformed email → throw (hard error).

**Fix approach:** Clarify the strategy: either all soft fallbacks, all hard errors, or a documented mix. Add test for multi-supplier last-wins scenario. ~5–10 lines + tests.

---

### 18. Duplicated pricing formula that bypasses its own collaborator
`Product.getResellerPrice()` (183–186) re-implements the exact same margin/VAT formula inline instead of calling `Price.getResellerPrice()` (59–63).

**Fix approach:** Replace inline formula with `return this.price.getResellerPrice();`. One line. Ensures formula consistency.

---

## TIER 4: Complex fixes (design violations, data flow)

### 17. "Tell, don't ask" violations — reaching into collaborators' fields
Several methods pull raw fields out of other objects and use them directly instead of asking that object to do the work:
- `setMargin()` reaches into `Price.mgn` instead of calling its `setMgn()` setter.
- `sell()` / `deprecate()` read `s.eml` directly off `Supplier` instead of asking "who do I notify?"
- `receiveStock()` reads `this.wh!.nm` instead of asking the warehouse to describe itself.
- `Product.getResellerPrice()` chains into `this.price.amt`, `this.price.mgn`, `this.price.vat` instead of delegating to `Price.getResellerPrice()` (see smell #18).

**Fix approach:** Add delegation methods: `Supplier.getNotificationRecipient()`, `Warehouse.getName()`, etc. Use them instead of field access. ~30 lines of new methods, refactor call sites.

---

### 10. `suppliersRegions: Map<string, Supplier>` vs. relational modeling
Using a `Map` for an in-memory field that's persisted through a join table (`ProductSupplier`) means every read after construction risks stale or empty data. Nothing in this file shows how `suppliersRegions` gets populated when a `Product` is loaded from the DB.

**Fix approach:** Implement a loader/hydrator method, or rethink the in-memory representation (use a list with lazy population). ~20 lines, requires understanding DB schema.

---

### 4. Primitive obsession — string-typed status/channel logic
`PrdStat` and `Chnl` are string union types, and state transitions (`active → out_of_stock → deprecated`) aren't modeled or guarded anywhere — nothing stops setting `stat` back to `"active"` after `deprecate()`.

**Fix approach:** Create a state machine: `class ProductStatus { canTransitionTo(newStatus) { ... } }`. Encode valid transitions. ~40 lines of state logic, more robust behavior.

---

## TIER 5: Most complex fixes (architectural refactoring)

### 5. Inconsistent transactional/consistency guarantees
Every mutator updates in-memory state *then* awaits a Prisma call. If the DB call throws, the in-memory object is already out of sync — no rollback.

**Fix approach:** Wrap mutation + persist in a transaction, or restructure: persist first, *then* mutate in-memory (or vice versa, depending on consistency needs). Requires rethinking the whole mutation flow. ~50+ lines, architectural decision.

---

### 6. `notifications` grows unbounded, never persisted or flushed
`this.notifs.push(...)` accumulates in memory but there's no `Notification` table write and nothing ever drains the array — silent memory leak on long-lived instances.

**Fix approach:** Add a `flush()` / `drain()` method that persists notifications and clears the array. Or stream them to the DB immediately. Or make `notifs` a lazy-loaded relation. ~30 lines, depends on persistence model.

---

### 2. Feature envy / misplaced responsibility — notification building
`sell()` and `deprecate()` build `Notification` objects inline, including hardcoded subject/body strings and a hardcoded `"customers@omniproduct.com"` recipient. This isn't something a `Product` should know how to do — it belongs in a dedicated notifier/service.

**Fix approach:** Extract a `NotificationService` or `NotificationBuilder` class. `Product` delegates "notify these people" to it, passing just the events/facts. Removes hardcoded strings, makes notifications testable/configurable independently. ~50–100 lines of new service code, refactor `sell()`/`deprecate()` to use it.

---

### 1. God class — `Product` (FINAL OVERARCHING GOAL)
`Product` owns catalog data, pricing, stock, supplier assignment, warehouse reference, *and* notification generation, and persists itself via direct Prisma calls in almost every method. It's simultaneously a domain entity and its own repository — no separation between business rules and persistence. This is why tests have to `vi.mock("@prisma/client", ...)` just to construct and test a `Product` — a plain domain object shouldn't require stubbing a database client.

**Fix approach (full refactoring):**
1. Extract a `ProductRepository` that handles all Prisma calls.
2. Move `notifs` generation to a `NotificationService` (see smell #2).
3. Move state-machine logic to a `ProductStatus` class (see smell #4).
4. Keep `Product` as a pure domain entity: no `prisma.*` calls, no notification building, no repository logic.
5. Introduce a `ProductUnitOfWork` or `ProductCommandHandler` if transactions are needed (see smell #5).
6. Update `Product.test.ts` to test the pure entity without any mocking.

**Scope:** 200+ lines of refactoring across multiple new classes, full test rewrite to prove `Product` is unit-testable without any external mocks.

---

## Teaching sequence

For students, recommend this order:
1. **Start with Tier 1** (Smells 11, 12, 9, 8, 23, 13, 14): Build confidence with straightforward fixes.
2. **Move to Tier 2** (Smells 19, 20, 16, 21, 22, 7): Refactor method-level logic, introduce error classes.
3. **Tackle Tier 3** (Smells 3, 15, 24, 25, 18): Eliminate duplication, flatten complex branching.
4. **Address Tier 4** (Smells 17, 10, 4): Design violations, encapsulation, state machines.
5. **Finish with Tier 5** (Smells 5, 6, 2, 1): Full architectural refactoring, the God class breakup.

By the end, `Product.ts` becomes a clean, testable, single-responsibility domain entity.
