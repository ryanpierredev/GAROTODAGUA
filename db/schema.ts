import { integer, sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  authUserId: text('auth_user_id'),
  email: text('email').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  role: text('role', { enum: ['admin', 'client'] }).notNull().default('client'),
  queuePosition: integer('queue_position').notNull().default(0),
  creditCents: integer('credit_cents').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
}, (table) => [uniqueIndex('idx_users_email').on(table.email), uniqueIndex('idx_users_auth_user_id').on(table.authUserId), index('idx_users_queue_active').on(table.active, table.queuePosition)]);

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  totalBottles: integer('total_bottles').notNull().default(0),
  fullBottles: integer('full_bottles').notNull().default(0),
  bottlePriceCents: integer('bottle_price_cents').notNull().default(2000),
  alertThreshold: integer('alert_threshold').notNull().default(3),
  nextQueuePosition: integer('next_queue_position').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
});

export const bottleEvents = sqliteTable('bottle_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id),
  kind: text('kind', { enum: ['empty', 'restock', 'adjustment'] }).notNull(),
  quantity: integer('quantity').notNull(),
  note: text('note'),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_bottle_events_created').on(table.createdAt), index('idx_bottle_events_user').on(table.userId)]);

export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memberId: text('member_id').notNull().references(() => users.id),
  bottles: integer('bottles').notNull(),
  totalCents: integer('total_cents').notNull(),
  creditUsedCents: integer('credit_used_cents').notNull().default(0),
  paidCents: integer('paid_cents').notNull().default(0),
  status: text('status', { enum: ['pending', 'paid'] }).notNull().default('pending'),
  paidAt: integer('paid_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_payments_member_created').on(table.memberId, table.createdAt), index('idx_payments_status').on(table.status)]);

export const creditTransactions = sqliteTable('credit_transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memberId: text('member_id').notNull().references(() => users.id),
  paymentId: integer('payment_id').references(() => payments.id),
  amountCents: integer('amount_cents').notNull(),
  kind: text('kind', { enum: ['credit', 'usage', 'adjustment'] }).notNull(),
  note: text('note').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_credit_member_created').on(table.memberId, table.createdAt)]);

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memberId: text('member_id').notNull().references(() => users.id),
  paymentId: integer('payment_id').references(() => payments.id),
  message: text('message').notNull(),
  status: text('status', { enum: ['queued', 'sent', 'failed'] }).notNull().default('queued'),
  providerId: text('provider_id'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  attemptedAt: integer('attempted_at'),
}, (table) => [index('idx_notifications_status_created').on(table.status, table.createdAt), index('idx_notifications_member').on(table.memberId)]);
