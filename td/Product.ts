// Translated from Models/{Product,Price,Notification,Supplier,Warehouse}.cs
//
// The C# version kept two representations of the same data in sync by hand:
// domain fields marked [NotMapped] (Price, Discounts, Images, SuppliersRegions,
// Warehouse) plus flattened EF columns (PriceAmount/DiscountsCsv/ImagesJson/...),
// reconciled via SyncEfColumns()/HydrateFromEfColumns(). Prisma maps Decimal,
// String[] and Json columns natively (see schema.prisma), so that flattening
// and the two sync methods are gone: PrismaClient reads/writes plain objects
// and there is exactly one representation of each field.

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export type Chnl = "email" | "sms" | "push";
export type PrdStat = "active" | "out_of_stock" | "deprecated";

export interface Notif {
  id: string;
  recip: string;
  subj: string;
  bod: string;
  chnl: Chnl;
  sentAt: Date;
  prdId?: string;
}

export class Splr {
  constructor(
    public id: string,
    public nm: string,
    public eml: string,
    public rgn: string,
  ) {}
}

export class Wh {
  constructor(
    public id: string,
    public nm: string,
    public addr: string,
    public rgn: string,
  ) {}
}

export class Price {
  amt: number;
  ccy: string;
  mgn: number; // percentage
  vat: number; // percentage, applied on margin only

  constructor(amt: number, ccy: string) {
    this.amt = amt;
    this.ccy = ccy;
    this.mgn = 15;
    this.vat = 20;
  }

  getResellerPrice(): number {
    const mgnAmt = (this.amt * this.mgn) / 100;
    const vatAmt = (mgnAmt * this.vat) / 100;
    return this.amt + mgnAmt + vatAmt;
  }
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
    this.images[context] = url;
    this.updatedAt = new Date();
    await prisma.product.update({
      where: { id: this.id },
      data: { images: this.images as Prisma.InputJsonValue, updatedAt: this.updatedAt },
    });
  }

  async addDiscount(discountCode: string): Promise<void> {
    this.discounts.push(discountCode);
    this.updatedAt = new Date();
    await prisma.product.update({
      where: { id: this.id },
      data: { discounts: this.discounts, updatedAt: this.updatedAt },
    });
  }

  // --- Suppliers ---

  async addSupplierToRegion(region: string, suppliers: Supplier[]): Promise<void> {
    const supplier = suppliers.find((s) => s.region === region);
    if (!supplier) throw new Error(`No supplier found for region ${region}`);

    this.suppliersRegions.set(region, supplier);
    this.updatedAt = new Date();

    await prisma.productSupplier.upsert({
      where: { productId_region: { productId: this.id, region } },
      create: { productId: this.id, region, supplierId: supplier.id },
      update: { supplierId: supplier.id },
    });
  }

  // --- Pricing ---

  getResellerPrice(): number {
    return this.price.getResellerPrice();
  }

  async setMargin(marginPercent: number): Promise<void> {
    this.price.margin = marginPercent;
    this.updatedAt = new Date();
    await prisma.product.update({
      where: { id: this.id },
      data: { priceMargin: marginPercent, updatedAt: this.updatedAt },
    });
  }

  // --- Stock ---

  async receiveStock(quantity: number): Promise<void> {
    this.stock += quantity;
    this.quantity += quantity;
    this.updatedAt = new Date();
    await prisma.product.update({
      where: { id: this.id },
      data: { stock: this.stock, quantity: this.quantity, updatedAt: this.updatedAt },
    });
  }

  async sell(quantity: number): Promise<void> {
    if (this.stock < quantity) throw new Error("Not enough stock");

    this.stock -= quantity;
    this.updatedAt = new Date();

    if (this.stock === 0) this.status = "out_of_stock";

    await prisma.product.update({
      where: { id: this.id },
      data: { stock: this.stock, status: this.status, updatedAt: this.updatedAt },
    });

    // Notify all regional suppliers
    for (const [, supplier] of this.suppliersRegions) {
      this.notifications.push({
        id: crypto.randomUUID(),
        recipient: supplier.email,
        subject: `Product sold: ${this.name}`,
        body: `${quantity} unit(s) of ${this.name} were sold. Remaining stock: ${this.stock}.`,
        channel: "email",
        sentAt: new Date(),
        productId: this.id,
      });
    }
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
    for (const [, supplier] of this.suppliersRegions) {
      this.notifications.push({
        id: crypto.randomUUID(),
        recipient: supplier.email,
        subject: `Product deprecated: ${this.name}`,
        body: `The product ${this.name} has been deprecated and removed from the catalog.`,
        channel: "email",
        sentAt: new Date(),
        productId: this.id,
      });
    }

    // Notify customers
    this.notifications.push({
      id: crypto.randomUUID(),
      recipient: "customers@omniproduct.com",
      subject: `Product no longer available: ${this.name}`,
      body: `${this.name} is no longer available.`,
      channel: "email",
      sentAt: new Date(),
      productId: this.id,
    });
  }
}
