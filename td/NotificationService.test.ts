import { describe, it, expect, vi } from "vitest";
import { NotificationService, CUSTOMERS_ADDRESS } from "./NotificationService";
import type { ProductEvent } from "./Product";

// No Product, no Prisma: the service only needs facts and recipients.
const target = (email: string) => ({ notificationRecipient: () => email });

const sold: ProductEvent = { type: "sold", productId: "p1", productName: "Wireless Mouse", quantity: 3, remainingStock: 7 };
const deprecated: ProductEvent = { type: "deprecated", productId: "p1", productName: "Wireless Mouse" };

describe("NotificationService", () => {
  const service = new NotificationService(async () => {});

  it("builds one email per supplier for a sale, with proper field names", () => {
    const notifications = service.build(sold, [target("acme@example.com"), target("widget@example.com")]);

    expect(notifications.length).toBe(2);
    expect(notifications[0]).toMatchObject({
      recipient: "acme@example.com",
      subject: "Product sold: Wireless Mouse",
      body: "3 unit(s) of Wireless Mouse were sold. Remaining stock: 7.",
      channel: "email",
      productId: "p1",
    });
  });

  it("notifies every supplier plus the customers on deprecation", () => {
    const notifications = service.build(deprecated, [target("acme@example.com")]);

    expect(notifications.map((n) => n.recipient)).toEqual(["acme@example.com", CUSTOMERS_ADDRESS]);
  });

  it("publish() sends every built notification", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    const sent = await new NotificationService(send).publish([sold, deprecated], [target("acme@example.com")]);

    expect(sent.length).toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
  });
});