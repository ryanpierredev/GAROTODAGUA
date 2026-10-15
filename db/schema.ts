import {
  integer,
  serial,
  bigint,
  pgTable,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    authUserId: text('auth_user_id'),
    username: text('username'),
    passwordHash: text('password_hash'),
    passwordSalt: text('password_salt'),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    role: text('role', { enum: ['admin', 'client'] })
      .notNull()
      .default('client'),
    queuePosition: integer('queue_position').notNull().default(0),
    creditCents: integer('credit_cents').notNull().default(0),
    active: integer('active').notNull().default(1),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_users_email').on(table.email),
    uniqueIndex('idx_users_auth_user_id').on(table.authUserId),
    uniqueIndex('idx_users_username').on(table.username),
    index('idx_users_queue_active').on(table.active, table.queuePosition),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    role: text('role', { enum: ['admin', 'client'] })
      .notNull()
      .default('client'),
    active: integer('active').notNull().default(1),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_accounts_username').on(table.username),
    index('idx_accounts_role_active').on(table.role, table.active),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => accounts.id),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_sessions_user').on(table.userId),
    index('idx_sessions_expires').on(table.expiresAt),
  ],
);

export const settings = pgTable('settings', {
  id: integer('id').primaryKey(),
  totalBottles: integer('total_bottles').notNull().default(0),
  fullBottles: integer('full_bottles').notNull().default(0),
  bottlePriceCents: integer('bottle_price_cents').notNull().default(2000),
  alertThreshold: integer('alert_threshold').notNull().default(3),
  nextQueuePosition: integer('next_queue_position').notNull().default(1),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const bottleEvents = pgTable(
  'bottle_events',
  {
    id: serial('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    kind: text('kind', { enum: ['empty', 'restock', 'adjustment'] }).notNull(),
    quantity: integer('quantity').notNull(),
    note: text('note'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_bottle_events_created').on(table.createdAt),
    index('idx_bottle_events_account').on(table.accountId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => users.id),
    bottles: integer('bottles').notNull(),
    totalCents: integer('total_cents').notNull(),
    creditUsedCents: integer('credit_used_cents').notNull().default(0),
    paidCents: integer('paid_cents').notNull().default(0),
    status: text('status', { enum: ['pending', 'paid'] })
      .notNull()
      .default('pending'),
    paidAt: bigint('paid_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_payments_member_created').on(table.memberId, table.createdAt),
    index('idx_payments_status').on(table.status),
  ],
);

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: serial('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => users.id),
    paymentId: integer('payment_id').references(() => payments.id),
    amountCents: integer('amount_cents').notNull(),
    kind: text('kind', { enum: ['credit', 'usage', 'adjustment'] }).notNull(),
    note: text('note').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_credit_member_created').on(table.memberId, table.createdAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => users.id),
    paymentId: integer('payment_id').references(() => payments.id),
    message: text('message').notNull(),
    status: text('status', { enum: ['queued', 'sent', 'failed'] })
      .notNull()
      .default('queued'),
    providerId: text('provider_id'),
    error: text('error'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    attemptedAt: bigint('attempted_at', { mode: 'number' }),
  },
  (table) => [
    index('idx_notifications_status_created').on(table.status, table.createdAt),
    index('idx_notifications_member').on(table.memberId),
  ],
);

// Independent outbox for the administrator's WhatsApp alerts. Customer billing
// notifications above keep their own status and destination.
export const adminWhatsappAlerts = pgTable(
  'admin_whatsapp_alerts',
  {
    id: serial('id').primaryKey(),
    eventKey: text('event_key').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    status: text('status').notNull().default('pending'),
    recipient: text('recipient'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: bigint('next_attempt_at', { mode: 'number' })
      .notNull()
      .default(0),
    leaseToken: text('lease_token'),
    leaseUntil: bigint('lease_until', { mode: 'number' }),
    providerId: text('provider_id'),
    error: text('error'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    submittedAt: bigint('submitted_at', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('idx_admin_alert_event').on(table.eventKey),
    index('idx_admin_alert_pending').on(table.status, table.nextAttemptAt),
  ],
);
