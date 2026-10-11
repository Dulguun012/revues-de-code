// Translated from Models/{Product,Price,Notification,Supplier,Warehouse}.cs
//
// Prisma maps String[] and Json columns natively (see schema.prisma), so
// discounts and images no longer need the CSV/JSON flattening of the C# version.
//
// WARNING: Price is still stored as flattened columns (e.g. priceMargin).
// The in-memory Price object and these columns are kept in sync BY HAND in
// each mutator (see setMargin()). This is discipline, not a real constraint:
// any code that changes a Price field must also persist the matching column.

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export type Channel = "email" | "sms" | "push";
export type ProductStatus = "active" | "out_of_stock" | "deprecated";


/** Allowed status changes. Defined once, enforced by Product.transitionTo(). */
const ALLOWED_TRANSITIONS: Record<ProductStatus, readonly ProductStatus[]> = {
  active: ["out_of_stock", "deprecated"],
  out_of_stock: ["active", "deprecated"],
  deprecated: [],
};

export interface Notification {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  channel: Channel;
  sentAt: Date;
  productId?: string;
}

/** Base class for business-rule violations (not bugs). */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class StockError extends DomainError {}
export class DiscountError extends DomainError {}
export class ImageError extends DomainError {}
export class SupplierError extends DomainError {}
export class StatusError extends DomainError {}

export class Supplier {
  constructor(
    public id: string,
    public name: string,
    public email: string,
    public region: string,
  ) {}

  /** Who receives this supplier's notifications. */
  notificationRecipient(): string {
    return this.email;
  }

  /**
   * Suffix this supplier gives to an image key, or null if it is not a
   * regional supplier. Missing email -> generic "supplier"; malformed email -> error.
   */
  imageKeySuffix(): string | null {
    if (!this.region) return null;
    if (!this.email) return "supplier";
    if (!isValidEmail(this.email)) {
      throw new SupplierError(`Supplier ${this.name} has a malformed email: ${this.email}`);
    }
    return this.name;
  }
}

export class Warehouse {
  constructor(
    public id: string,
    public name: string,
    public address: string,
    public region: string,
  ) {}

  /** How this warehouse names itself in labels and keys. */
  label(): string {
    return this.name;
  }
}

/** Default margin applied to a price, in percent. Business decision: change it here only. */
export const DEFAULT_MARGIN_PERCENT = 15;
/** Default VAT, in percent, applied on the margin only. */
export const DEFAULT_VAT_PERCENT = 20;

export class Price {
  amount: number;
  currency: string;
  margin: number; // percentage
  vat: number; // percentage, applied on margin only

  constructor(amount: number, currency: string) {
    this.amount = amount;
    this.currency = currency;
    this.margin = DEFAULT_MARGIN_PERCENT;
    this.vat = DEFAULT_VAT_PERCENT;
  }

  getResellerPrice(): number {
    const marginAmount = (this.amount * this.margin) / 100;
    const vatAmount = (marginAmount * this.vat) / 100;
    return this.amount + marginAmount + vatAmount;
  }

  
  /** Changes the margin, in percent. Rejects negative or non-numeric values. */
  changeMargin(percent: number): void {
    if (!Number.isFinite(percent) || percent < 0) {
      throw new DomainError(`Invalid margin: ${percent}`);
    }
    this.margin = percent;
  }

}

/** True if the value is a real http(s) URL (case-insensitive scheme). */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/** Every mutable field of a Product, used to undo a change. */
export interface ProductSnapshot {
  discounts: string[];
  images: Record<string, string>;
  suppliersRegions: Map<string, Supplier>;
  quantity: number;
  stock: number;
  status: ProductStatus;
  margin: number;
  validUntil: Date | null;
  updatedAt: Date;
}

export class Product {
  id: string;
  name: string;
  slug: string;
  price: Price;
  discounts: string[];
  images: Record<string, string>; // key = context ("thumbnail", "hero", ...), value = url
  suppliersRegions: Map<string, Supplier>; // key = region
  weight: number;
  dimensions: string;
  quantity: number;
  stock: number;
  warehouse: Warehouse | null;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
  notifications: Notification[] = [];
  validUntil: Date | null = null;

  constructor(
    id: string,
    name: string,
    slug: string,
    price: Price,
    discounts: string[],
    images: Record<string, string>,
    suppliersRegions: Map<string, Supplier>,
    weight: number,
    dimensions: string,
    quantity: number,
    stock: number,
    warehouse: Warehouse | null,
  ) {
    this.id = id;
    this.name = name;
    this.slug = slug;
    this.price = price;
    this.discounts = discounts;
    this.images = images;
    this.suppliersRegions = suppliersRegions;
    this.weight = weight;
    this.dimensions = dimensions;
    this.quantity = quantity;
    this.stock = stock;
    this.warehouse = warehouse;
    this.status = "active";
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  /** The only place that changes status (except the initial value). */
  private transitionTo(next: ProductStatus): void {
    if (!ALLOWED_TRANSITIONS[this.status].includes(next)) {
      throw new StatusError(`Cannot go from ${this.status} to ${next}`);
    }
    this.status = next;
  }

  private assertNotDeprecated(action: string): void {
    if (this.status === "deprecated") {
      throw new StatusError(`Cannot ${action} a deprecated product`);
    }
  }

  getDisplayLabel(): string {
    if (this.status === "deprecated") return `[DISCONTINUED] ${this.name}`;
    if (this.stock === 0) return `[OUT OF STOCK] ${this.name}`;
    return this.name;
  }

  // --- Catalog / images / discounts ---

  async addImage(context: string, url: string): Promise<void> {
    if (!url) {
      throw new ImageError("url is required");
    }
    if (!isHttpUrl(url)) {
      throw new ImageError("url must start with http");
    }

    const before = this.snapshot();
    const isNewContext = this.images[context] === undefined;
    const key = isNewContext ? context : this.keyForExistingImage(context);

    this.images[key] = url;
    this.updatedAt = new Date();
    await this.persistOrRollback(before, () =>
      prisma.product.update({
        where: { id: this.id },
        data: { images: this.images as Prisma.InputJsonValue, updatedAt: this.updatedAt },
      }),
    );
  }

  /**
   * Key used when an image already exists for this context.
   * Several suppliers: the FIRST supplier registered (insertion order) decides.
   *
   * Fallback policy:
   * - MISSING data falls back silently to a less specific key:
   *     no supplier          -> plain context
   *     supplier, no region  -> warehouse name, else plain context
   *     region, no email     -> generic "-supplier" suffix
   * - PRESENT but INVALID data is an error:
   *     malformed email      -> SupplierError
   * - Complete, valid data   -> supplier name suffix
   */
  private keyForExistingImage(context: string): string {
    const suppliers = [...this.suppliersRegions.values()];
    if (suppliers.length === 0) return context;

    const suffix = suppliers[0].imageKeySuffix();
    if (suffix !== null) return `${context}-${suffix}`;
    return this.warehouse ? `${context}-${this.warehouse.label()}` : context;
  }

  getValidUntil(): Date | null {
    return this.validUntil;
  }

  setValidUntil(validUntil: Date | null): void {
    this.validUntil = validUntil;
  }

  async addDiscount(dscCode: string, validUntil: Date): Promise<void> {
    if (!dscCode) {
      throw new DiscountError("Discount code cannot be empty");
    }
    if (validUntil < new Date()) {
      throw new DiscountError("validUntil cannot be in the past");
    }
    if (this.discounts.length >= 2) {
      throw new DiscountError("Cannot have more than 2 discounts at the same time");
    }

    const before = this.snapshot();
    this.discounts.push(dscCode);
    this.setValidUntil(validUntil);
    this.updatedAt = new Date();
    await this.persistOrRollback(before, () =>
      prisma.product.update({
        where: { id: this.id },
        data: { discounts: this.discounts, updatedAt: this.updatedAt },
      }),
    );
  }

  // --- Suppliers ---

  async addSupplierToRegion(region: string, suppliers: Supplier[]): Promise<void> {
    const s = suppliers.find((x) => x.region === region);
    if (!s) throw new SupplierError(`No supplier found for region ${region}`);

    const before = this.snapshot();
    this.suppliersRegions.set(region, s);
    this.updatedAt = new Date();

    await this.persistOrRollback(before, () =>
      prisma.productSupplier.upsert({
        where: { productId_region: { productId: this.id, region: region } },
        create: { productId: this.id, region: region, supplierId: s.id },
        update: { supplierId: s.id },
      }),
    );
  }

  /**
   * Invariant: suppliersRegions mirrors the ProductSupplier join table.
   * - Writes: only addSupplierToRegion() (memory + upsert).
   * - Reads: whoever loads a Product from the database MUST call
   *   hydrateSuppliers() with its ProductSupplier rows (the repository, see #25).
   */
  hydrateSuppliers(rows: { region: string; supplier: Supplier }[]): void {
    this.suppliersRegions = new Map(rows.map((row) => [row.region, row.supplier]));
  }

  // --- Pricing ---

  getResellerPrice(): number {
    return this.price.getResellerPrice();
  }

  async setMargin(marginPercent: number): Promise<void> {
    const before = this.snapshot();
    this.price.changeMargin(marginPercent);
    this.updatedAt = new Date();
    await this.persistOrRollback(before, () =>
      prisma.product.update({
        where: { id: this.id },
        data: { priceMargin: marginPercent, updatedAt: this.updatedAt },
      }),
    );
  }

  // --- Stock ---

  async receiveStock(qty: number): Promise<void> {
    this.assertNotDeprecated("restock");

    const before = this.snapshot();
    this.stock += qty;
    this.quantity += qty;
    if (this.status === "out_of_stock" && this.stock > 0) {
      this.transitionTo("active");
    }
    this.updatedAt = new Date();
    if (this.warehouse) {
      console.log(`Restocking ${this.name} at ${this.warehouse.label()}`);
    } else {
      console.log(`Restocking ${this.name} (no warehouse assigned)`);
    }
    await this.persistOrRollback(before, () =>
      prisma.product.update({
        where: { id: this.id },
        data: { stock: this.stock, quantity: this.quantity, status: this.status, updatedAt: this.updatedAt },
      }),
    );
  }

  async sell(qty: number): Promise<void> {
    this.assertNotDeprecated("sell");
    if (this.stock < qty) throw new StockError("Not enough stock");

    const before = this.snapshot();
    this.stock -= qty;
    this.updatedAt = new Date();
    if (this.stock === 0 && this.status !== "out_of_stock") {
      this.transitionTo("out_of_stock");
    }

    await this.persistOrRollback(before, () =>
      prisma.product.update({
        where: { id: this.id },
        data: { stock: this.stock, status: this.status, updatedAt: this.updatedAt },
      }),
    );

    this.notifyAllSuppliers(
      `Product sold: ${this.name}`,
      `${qty} unit(s) of ${this.name} were sold. Remaining stock: ${this.stock}.`,
    );
  }

  // --- Lifecycle ---

  async deprecate(): Promise<void> {
    const before = this.snapshot();
    this.transitionTo("deprecated");
    this.stock = 0;
    this.updatedAt = new Date();

    await this.persistOrRollback(before, () =>
      prisma.product.update({
        where: { id: this.id },
        data: { status: this.status, stock: this.stock, updatedAt: this.updatedAt },
      }),
    );

    this.notifyAllSuppliers(
      `Product deprecated: ${this.name}`,
      `The product ${this.name} has been deprecated and removed from the catalog.`,
    );

    // Notify customers
    this.notifications.push(this.mkNotif("customers@omniproduct.com", `Product no longer available: ${this.name}`, `${this.name} is no longer available.`));
  }

  // --- Consistency ---

  /**
   * Consistency policy: a mutator changes memory, then persists.
   * If persisting fails, memory is restored to its state before the call and
   * the error is rethrown. So after `await product.x()`:
   *   - resolved -> memory and database agree;
   *   - rejected -> the product is exactly as it was before the call.
   * Notifications are only pushed after a successful write.
   */
  private async persistOrRollback(before: ProductSnapshot, persist: () => Promise<unknown>): Promise<void> {
    try {
      await persist();
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  /** Copy of every mutable field (collections are copied, not shared). */
  snapshot(): ProductSnapshot {
    return {
      discounts: [...this.discounts],
      images: { ...this.images },
      suppliersRegions: new Map(this.suppliersRegions),
      quantity: this.quantity,
      stock: this.stock,
      status: this.status,
      margin: this.price.margin,
      validUntil: this.validUntil,
      updatedAt: this.updatedAt,
    };
  }

  /** Puts every mutable field back. Restoring is not a status transition. */
  restore(snapshot: ProductSnapshot): void {
    this.discounts = [...snapshot.discounts];
    this.images = { ...snapshot.images };
    this.suppliersRegions = new Map(snapshot.suppliersRegions);
    this.quantity = snapshot.quantity;
    this.stock = snapshot.stock;
    this.status = snapshot.status;
    this.price.changeMargin(snapshot.margin);
    this.validUntil = snapshot.validUntil;
    this.updatedAt = snapshot.updatedAt;
  }

  // --- Notifications ---


  /**
   * Hands the pending notifications to whoever sends them, and empties the list.
   * Lifecycle owner: the caller (the NotificationService, see #24).
   */
  pullNotifications(): Notification[] {
    const pending = this.notifications;
    this.notifications = [];
    return pending;
  }
  
  /** Pushes one email notification per regional supplier. */
  private notifyAllSuppliers(subject: string, body: string): void {
    for (const [, s] of this.suppliersRegions) {
      this.notifications.push(this.mkNotif(s.notificationRecipient(), subject, body));
    }
  }

  // small helper to cut down repetition in notif building
  private mkNotif(recipient: string, subject: string, body: string): Notification {
    return {
      id: crypto.randomUUID(),
      recipient: recipient,
      subject: subject,
      body: body,
      channel: "email",
      sentAt: new Date(),
      productId: this.id,
    };
  }
}
