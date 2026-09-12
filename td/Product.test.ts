// Naming-discovery tests for Product.ts.
//
// These tests are written against the PROPER, non-abbreviated names for
// every constructor parameter and property (the names this file *should*
// use once the abbreviation smell is fixed). They compile today only
// because every access goes through an `as any` cast — that's deliberate:
// the goal is a red assertion with a clear message ("expected product to
// have a property named `name`"), not a red compiler.
//
// If you're a student trying to fix the abbreviation smell: run these
// tests, read the failure messages, and use them as your checklist of
// what each field/param should actually be called.

import { describe, it, expect, vi } from "vitest";

// Product.ts instantiates a real PrismaClient at module load and calls
// prisma.product.update()/upsert() from inside its own mutators (this is
// itself one of the documented smells — the entity is its own repository).
// These tests care about naming, not persistence, so Prisma is stubbed out
// entirely rather than requiring a live database.
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(function (this: any) {
    this.product = { update: vi.fn().mockResolvedValue(undefined) };
    this.productSupplier = { upsert: vi.fn().mockResolvedValue(undefined) };
  }),
  Prisma: {},
}));

import { Product, Price, Supplier, Warehouse } from "./Product";

function hasProp(obj: unknown, propName: string): boolean {
  return typeof obj === "object" && obj !== null && propName in (obj as object);
}

describe("Price", () => {
  it("exposes proper names: amount, currency, margin, vat", () => {
    const price: any = new Price(100, "EUR");

    expect(hasProp(price, "amount"), "Price should have a property named `amount` (not an abbreviation)").toBe(true);
    expect(price.amount).toBe(100);

    expect(hasProp(price, "currency"), "Price should have a property named `currency` (not an abbreviation)").toBe(true);
    expect(price.currency).toBe("EUR");

    expect(hasProp(price, "margin"), "Price should have a property named `margin` (not an abbreviation)").toBe(true);
    expect(price.margin).toBe(15);

    expect(hasProp(price, "vat"), "Price should have a property named `vat`").toBe(true);
    expect(price.vat).toBe(20);
  });
});

describe("Supplier", () => {
  it("maps constructor params to proper names: id, name, email, region", () => {
    const supplier: any = new Supplier("s1", "Acme Corp", "acme@example.com", "EU");

    expect(hasProp(supplier, "id"), "Supplier should have a property named `id`").toBe(true);

    expect(hasProp(supplier, "name"), "Supplier's 2nd constructor param should be exposed as `name` (not an abbreviation)").toBe(true);
    expect(supplier.name).toBe("Acme Corp");

    expect(hasProp(supplier, "email"), "Supplier's 3rd constructor param should be exposed as `email` (not an abbreviation)").toBe(true);
    expect(supplier.email).toBe("acme@example.com");

    expect(hasProp(supplier, "region"), "Supplier's 4th constructor param should be exposed as `region` (not an abbreviation)").toBe(true);
    expect(supplier.region).toBe("EU");
  });
});

describe("Warehouse", () => {
  it("maps constructor params to proper names: id, name, address, region", () => {
    const warehouse: any = new Warehouse("w1", "Main Depot", "1 Dock Rd", "EU");

    expect(hasProp(warehouse, "id"), "Warehouse should have a property named `id`").toBe(true);

    expect(hasProp(warehouse, "name"), "Warehouse's 2nd constructor param should be exposed as `name` (not an abbreviation)").toBe(true);
    expect(warehouse.name).toBe("Main Depot");

    expect(hasProp(warehouse, "address"), "Warehouse's 3rd constructor param should be exposed as `address` (not an abbreviation)").toBe(true);
    expect(warehouse.address).toBe("1 Dock Rd");

    expect(hasProp(warehouse, "region"), "Warehouse's 4th constructor param should be exposed as `region` (not an abbreviation)").toBe(true);
    expect(warehouse.region).toBe("EU");
  });
});

function makeProduct(): any {
  const price = new Price(50, "EUR");
  return new Product(
    "p1",
    "Wireless Mouse",
    "wireless-mouse",
    price,
    ["WELCOME10"],
    { thumbnail: "http://img/thumb.png" },
    new Map(),
    0.2,
    "10x5x3cm",
    100,
    100,
    null,
  );
}

describe("Product", () => {
  it("maps constructor params to proper names", () => {
    const product = makeProduct();

    expect(hasProp(product, "id"), "Product should have a property named `id`").toBe(true);

    expect(hasProp(product, "name"), "2nd constructor param should be exposed as `name` (not an abbreviation)").toBe(true);
    expect(product.name).toBe("Wireless Mouse");

    expect(hasProp(product, "slug"), "3rd constructor param should be exposed as `slug` (not an abbreviation)").toBe(true);
    expect(product.slug).toBe("wireless-mouse");

    expect(hasProp(product, "price"), "Product should have a property named `price`").toBe(true);

    expect(hasProp(product, "discounts"), "5th constructor param should be exposed as `discounts` (not an abbreviation)").toBe(true);
    expect(product.discounts).toEqual(["WELCOME10"]);

    expect(hasProp(product, "images"), "6th constructor param should be exposed as `images` (not an abbreviation)").toBe(true);

    expect(hasProp(product, "suppliersRegions"), "7th constructor param should be exposed as `suppliersRegions` (not an abbreviation)").toBe(true);

    expect(hasProp(product, "weight"), "8th constructor param should be exposed as `weight` (not an abbreviation)").toBe(true);
    expect(product.weight).toBe(0.2);

    expect(hasProp(product, "dimensions"), "9th constructor param should be exposed as `dimensions` (not an abbreviation)").toBe(true);
    expect(product.dimensions).toBe("10x5x3cm");

    expect(hasProp(product, "quantity"), "10th constructor param should be exposed as `quantity` (not an abbreviation)").toBe(true);
    expect(product.quantity).toBe(100);

    expect(hasProp(product, "stock"), "11th constructor param should be exposed as `stock` (not an abbreviation)").toBe(true);
    expect(product.stock).toBe(100);

    expect(hasProp(product, "warehouse"), "12th constructor param should be exposed as `warehouse` (not an abbreviation)").toBe(true);
    expect(product.warehouse).toBe(null);

    expect(hasProp(product, "status"), "Product should have a property named `status` (not an abbreviation)").toBe(true);
    expect(product.status).toBe("active");

    expect(hasProp(product, "notifications"), "Product should have a property named `notifications` (not an abbreviation)").toBe(true);
    expect(product.notifications).toEqual([]);
  });

  it("sell() pushes a notification with proper field names: recipient, subject, body, channel, productId", async () => {
    const product = makeProduct();
    product.suppliersRegions.set("EU", new Supplier("s1", "Acme Corp", "acme@example.com", "EU"));

    await product.sell(1);

    expect(product.notifications.length, "sell() should push exactly one notification per regional supplier").toBe(1);
    const notification = product.notifications[0];

    expect(hasProp(notification, "recipient"), "Notification should have a property named `recipient` (not an abbreviation)").toBe(true);
    expect(notification.recipient).toBe("acme@example.com");

    expect(hasProp(notification, "subject"), "Notification should have a property named `subject` (not an abbreviation)").toBe(true);
    expect(hasProp(notification, "body"), "Notification should have a property named `body` (not an abbreviation)").toBe(true);

    expect(hasProp(notification, "channel"), "Notification should have a property named `channel` (not an abbreviation)").toBe(true);
    expect(notification.channel).toBe("email");

    expect(hasProp(notification, "productId"), "Notification should have a property named `productId` (not an abbreviation)").toBe(true);
    expect(notification.productId).toBe("p1");
  });
});
