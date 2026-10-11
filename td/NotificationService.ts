import type { ProductEvent } from "./Product";

export type Channel = "email" | "sms" | "push";

export interface Notification {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  channel: Channel;
  sentAt: Date;
  productId?: string;
}

/** Anything that can receive a notification (e.g. a Supplier). */
export interface NotificationTarget {
  notificationRecipient(): string;
}

/** Address used for customer-facing announcements. */
export const CUSTOMERS_ADDRESS = "customers@omniproduct.com";

/** Sends one notification (email gateway, queue...). Injected so tests can fake it. */
export type Sender = (notification: Notification) => Promise<void>;

/**
 * Turns product facts into notifications and sends them.
 * Product says "3 units sold, 7 left"; this service decides who hears about it, and how.
 */
export class NotificationService {
  constructor(private readonly send: Sender) {}

  /** Builds the notifications for one event. Does not send anything. */
  build(event: ProductEvent, suppliers: NotificationTarget[]): Notification[] {
    switch (event.type) {
      case "sold":
        return suppliers.map((s) =>
          this.email(
            s.notificationRecipient(),
            event.productId,
            `Product sold: ${event.productName}`,
            `${event.quantity} unit(s) of ${event.productName} were sold. Remaining stock: ${event.remainingStock}.`,
          ),
        );
      case "deprecated":
        return [
          ...suppliers.map((s) =>
            this.email(
              s.notificationRecipient(),
              event.productId,
              `Product deprecated: ${event.productName}`,
              `The product ${event.productName} has been deprecated and removed from the catalog.`,
            ),
          ),
          this.email(
            CUSTOMERS_ADDRESS,
            event.productId,
            `Product no longer available: ${event.productName}`,
            `${event.productName} is no longer available.`,
          ),
        ];
    }
  }

  /** Builds and sends the notifications for every event. Returns what was sent. */
  async publish(events: ProductEvent[], suppliers: NotificationTarget[]): Promise<Notification[]> {
    const notifications = events.flatMap((event) => this.build(event, suppliers));
    for (const notification of notifications) {
      await this.send(notification);
    }
    return notifications;
  }

  private email(recipient: string, productId: string, subject: string, body: string): Notification {
    return { id: crypto.randomUUID(), recipient, subject, body, channel: "email", sentAt: new Date(), productId };
  }
}