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

export class Supplier {
  constructor(
    public id: string,
    public name: string,
    public email: string,
    public region: string,
  ) {}
}

export class Warehouse {
  constructor(
    public id: string,
    public name: string,
    public address: string,
    public region: string,
  ) {}
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

    const isNewContext = this.images[context] === undefined;
    const key = isNewContext ? context : this.keyForExistingImage(context);

    this.images[key] = url;
    this.updatedAt = new Date();
    await prisma.product.update({
      where: { id: this.id },
      data: { images: this.images as Prisma.InputJsonValue, updatedAt: this.updatedAt },
    });
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

    const supplier = suppliers[0];
    if (!supplier.region) {
      return this.warehouse ? `${context}-${this.warehouse.name}` : context;
    }
    if (!supplier.email) return `${context}-supplier`;
    if (!isValidEmail(supplier.email)) {
      throw new SupplierError(`Supplier ${supplier.name} has a malformed email: ${supplier.email}`);
    }
    return `${context}-${supplier.name}`;
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

    // Sanity-check the discount code isn't already applied by
    // round-tripping the list through JSON — cheap, and guards
    // against any non-serializable junk sneaking into `dscs`.

    if (validUntil < new Date()) {
      throw new DiscountError("validUntil cannot be in the past");
    }
    if (this.discounts.length >= 2) {
      throw new DiscountError("Cannot have more than 2 discounts at the same time");
    }

    this.discounts.push(dscCode);
    this.setValidUntil(validUntil);
    this.updatedAt = new Date();
    await prisma.product.update({
      where: { id: this.id },
      data: { discounts: this.discounts, updatedAt: this.updatedAt },
    });
  }

  // --- Suppliers ---

  async addSupplierToRegion(region: string, suppliers: Supplier[]): Promise<void> {
    const s = suppliers.find((x) => x.region === region);
    if (!s) throw new SupplierError(`No supplier found for region ${region}`);

    this.suppliersRegions.set(region, s);
    this.updatedAt = new Date();

    await prisma.productSupplier.upsert({
      where: { productId_region: { productId: this.id, region: region } },
      create: { productId: this.id, region: region, supplierId: s.id },
      update: { supplierId: s.id },
    });
  }

  // --- Pricing ---

  getResellerPrice(): number {
    const mgnAmt = (this.price.amount * this.price.margin) / 100;
    const vatAmt = (mgnAmt * this.price.vat) / 100;
    return this.price.amount + mgnAmt + vatAmt;
  }

  async setMargin(mgnPct: number): Promise<void> {
    this.price.margin = mgnPct;
    this.updatedAt = new Date();
    await prisma.product.update({
      where: { id: this.id },
      data: { priceMargin: mgnPct, updatedAt: this.updatedAt },
    });
  }

  // --- Stock ---

  async receiveStock(qty: number): Promise<void> {
    this.stock += qty;
    this.quantity += qty;
    this.updatedAt = new Date();
    if (this.warehouse) {
      console.log(`Restocking ${this.name} at ${this.warehouse.name}`);
    } else {
      console.log(`Restocking ${this.name} (no warehouse assigned)`);
    }
    await prisma.product.update({
      where: { id: this.id },
      data: { stock: this.stock, quantity: this.quantity, updatedAt: this.updatedAt },
    });
  }

  async sell(qty: number): Promise<void> {
    if (this.stock < qty) throw new StockError("Not enough stock");

    this.stock -= qty;
    this.updatedAt = new Date();

    if (this.stock === 0) {
      this.status = "out_of_stock";
    }

    await prisma.product.update({
      where: { id: this.id },
      data: { stock: this.stock, status: this.status, updatedAt: this.updatedAt },
    });

    // Notify all regional suppliers
    this.notifyAllSuppliers(
      `Product sold: ${this.name}`,
      `${qty} unit(s) of ${this.name} were sold. Remaining stock: ${this.stock}.`,
    );
  }

  // --- Lifecycle ---

  async deprecate(): Promise<void> {
    this.status = "deprecated";
    this.stock = 0;
    this.updatedAt = new Date();

    await prisma.product.update({
      where: { id: this.id },
      data: { status: this.status, stock: this.stock, updatedAt: this.updatedAt },
    });

    // Notify all regional suppliers
    this.notifyAllSuppliers(
      `Product deprecated: ${this.name}`,
      `The product ${this.name} has been deprecated and removed from the catalog.`,
    );

    // Notify customers
    this.notifications.push(this.mkNotif("customers@omniproduct.com", `Product no longer available: ${this.name}`, `${this.name} is no longer available.`));
  }

  /** Pushes one email notification per regional supplier. */
  private notifyAllSuppliers(subject: string, body: string): void {
    for (const [, s] of this.suppliersRegions) {
      this.notifications.push(this.mkNotif(s.email, subject, body));
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
