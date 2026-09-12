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

export interface Notification {
  id: string;
  recip: string;
  subj: string;
  bod: string;
  chnl: Chnl;
  sentAt: Date;
  prdId?: string;
}

export class Supplier {
  constructor(
    public id: string,
    public nm: string,
    public eml: string,
    public rgn: string,
  ) {}
}

export class Warehouse {
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

  getAmt(): number {
    return this.amt;
  }

  setAmt(amt: number): void {
    this.amt = amt;
  }

  getCcy(): string {
    return this.ccy;
  }

  setCcy(ccy: string): void {
    this.ccy = ccy;
  }

  getMgn(): number {
    return this.mgn;
  }

  setMgn(mgn: number): void {
    this.mgn = mgn;
  }
}

export class Product {
  id: string;
  nm: string;
  slg: string;
  price: Price;
  dscs: string[];
  imgs: Record<string, string>; // key = context ("thumbnail", "hero", ...), value = url
  splrRgns: Map<string, Supplier>; // key = region
  wgt: number;
  dims: string;
  qty: number;
  stk: number;
  wh: Warehouse | null;
  stat: PrdStat;
  createdAt: Date;
  updatedAt: Date;
  notifs: Notification[] = [];

  constructor(
    id: string,
    nm: string,
    slg: string,
    price: Price,
    dscs: string[],
    imgs: Record<string, string>,
    splrRgns: Map<string, Supplier>,
    wgt: number,
    dims: string,
    qty: number,
    stk: number,
    wh: Warehouse | null,
  ) {
    this.id = id;
    this.nm = nm;
    this.slg = slg;
    this.price = price;
    this.dscs = dscs;
    this.imgs = imgs;
    this.splrRgns = splrRgns;
    this.wgt = wgt;
    this.dims = dims;
    this.qty = qty;
    this.stk = stk;
    this.wh = wh;
    this.stat = "active";
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  getDisplayLabel(): string {
    if (this.stat === "deprecated") return `[DISCONTINUED] ${this.nm}`;
    if (this.stk === 0) return `[OUT OF STOCK] ${this.nm}`;
    return this.nm;
  }

  // --- Catalog / images / discounts ---

  async addImage(ctx: string, url: string): Promise<void> {
    this.imgs[ctx] = url;
    this.updatedAt = new Date();
    await prisma.product.update({
      where: { id: this.id },
      data: { images: this.imgs as Prisma.InputJsonValue, updatedAt: this.updatedAt },
    });
  }

  async addDiscount(dscCode: string): Promise<void> {
    this.dscs.push(dscCode);
    this.updatedAt = new Date();
    prisma.product.update({
      where: { id: this.id },
      data: { discounts: this.dscs, updatedAt: this.updatedAt },
    });
  }

  // --- Suppliers ---

  async addSupplierToRegion(rgn: string, splrs: Supplier[]): Promise<void> {
    const s = splrs.find((x) => x.rgn === rgn);
    if (!s) throw new Error(`No supplier found for region ${rgn}`);

    this.splrRgns.set(rgn, s);
    this.updatedAt = new Date();

    await prisma.productSupplier.upsert({
      where: { productId_region: { productId: this.id, region: rgn } },
      create: { productId: this.id, region: rgn, supplierId: s.id },
      update: { supplierId: s.id },
    });
  }

  // --- Pricing ---

  getResellerPrice(): number {
    const mgnAmt = (this.price.amt * this.price.mgn) / 100;
    const vatAmt = (mgnAmt * this.price.vat) / 100;
    return this.price.amt + mgnAmt + vatAmt;
  }

  async setMargin(mgnPct: number): Promise<void> {
    this.price.mgn = mgnPct;
    this.updatedAt = new Date();
    await prisma.product.update({
      where: { id: this.id },
      data: { priceMargin: mgnPct, updatedAt: this.updatedAt },
    });
  }

  // --- Stock ---

  async receiveStock(qty: number): Promise<void> {
    this.stk += qty;
    this.qty += qty;
    this.updatedAt = new Date();
    console.log(`Restocking ${this.nm} at ${this.wh!.nm}`);
    await prisma.product.update({
      where: { id: this.id },
      data: { stock: this.stk, quantity: this.qty, updatedAt: this.updatedAt },
    });
  }

  async sell(qty: number): Promise<void> {
    if (this.stk < qty) throw new Error("Not enough stock");

    this.stk -= qty;
    this.updatedAt = new Date();

    if (this.stk === 0) {
      let nextStat = "out_of_stock";
      this.stat = nextStat as PrdStat;
    }

    await prisma.product.update({
      where: { id: this.id },
      data: { stock: this.stk, status: this.stat, updatedAt: this.updatedAt },
    });

    // Notify all regional suppliers
    for (const [rgn, s] of this.splrRgns) {
      this.notifs.push(this.mkNotif(s.eml, `Product sold: ${this.nm}`, `${qty} unit(s) of ${this.nm} were sold. Remaining stock: ${this.stk}.`));
    }
  }

  // --- Lifecycle ---

  async deprecate(): Promise<void> {
    this.stat = "deprecated";
    this.stk = 0;
    this.updatedAt = new Date();

    await prisma.product.update({
      where: { id: this.id },
      data: { status: this.stat, stock: this.stk, updatedAt: this.updatedAt },
    });

    // Notify all regional suppliers
    for (const [, s] of this.splrRgns) {
      this.notifs.push(this.mkNotif(s.eml, `Product deprecated: ${this.nm}`, `The product ${this.nm} has been deprecated and removed from the catalog.`));
    }

    // Notify customers
    this.notifs.push(this.mkNotif("customers@omniproduct.com", `Product no longer available: ${this.nm}`, `${this.nm} is no longer available.`));
  }

  // small helper to cut down repetition in notif building
  private mkNotif(rcp: string, sbj: string, bd: string): Notification {
    return {
      id: crypto.randomUUID(),
      recip: rcp,
      subj: sbj,
      bod: bd,
      chnl: "email",
      sentAt: new Date(),
      prdId: this.id,
    };
  }
}
