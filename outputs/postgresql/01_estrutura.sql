-- Cota Dagua: exportacao dos dados locais para PostgreSQL
-- Gerado em: 2026-10-15T10:44:49.868Z
-- Datas mantidas como epoch numerico (BIGINT), valores monetarios em centavos.
-- Destino: schema public; estrutura compativel com 01_estrutura.sql.

BEGIN;
SET LOCAL search_path = public;
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" text DEFAULT 'client' NOT NULL,
	"queue_position" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"active" BOOLEAN DEFAULT TRUE NOT NULL,
	"created_at" BIGINT NOT NULL
, "auth_user_id" text, "username" text, "password_hash" text, "password_salt" text);
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" text DEFAULT 'client' NOT NULL,
	"active" BOOLEAN DEFAULT TRUE NOT NULL,
	"created_at" BIGINT NOT NULL
);
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"total_bottles" integer DEFAULT 0 NOT NULL,
	"full_bottles" integer DEFAULT 0 NOT NULL,
	"bottle_price_cents" integer DEFAULT 2000 NOT NULL,
	"alert_threshold" integer DEFAULT 3 NOT NULL,
	"next_queue_position" integer DEFAULT 1 NOT NULL,
	"updated_at" BIGINT NOT NULL
);
CREATE TABLE "payments" (
	"id" SERIAL PRIMARY KEY,
	"member_id" text NOT NULL,
	"bottles" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"credit_used_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" BIGINT,
	"created_at" BIGINT NOT NULL,
	FOREIGN KEY ("member_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE no action
);
CREATE TABLE "bottle_events" (
	"id" SERIAL PRIMARY KEY,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"note" text,
	"created_at" BIGINT NOT NULL,
	FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON UPDATE no action ON DELETE no action
);
CREATE TABLE "credit_transactions" (
	"id" SERIAL PRIMARY KEY,
	"member_id" text NOT NULL,
	"payment_id" integer,
	"amount_cents" integer NOT NULL,
	"kind" text NOT NULL,
	"note" text NOT NULL,
	"created_at" BIGINT NOT NULL,
	FOREIGN KEY ("member_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE no action,
	FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON UPDATE no action ON DELETE no action
);
CREATE TABLE "notifications" (
	"id" SERIAL PRIMARY KEY,
	"member_id" text NOT NULL,
	"payment_id" integer,
	"message" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"error" text,
	"created_at" BIGINT NOT NULL,
	"attempted_at" BIGINT,
	FOREIGN KEY ("member_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE no action,
	FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON UPDATE no action ON DELETE no action
);
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" BIGINT NOT NULL,
	"created_at" BIGINT NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "accounts"("id") ON UPDATE no action ON DELETE no action
);
CREATE INDEX "idx_credit_member_created" ON "credit_transactions" ("member_id","created_at");
CREATE INDEX "idx_notifications_status_created" ON "notifications" ("status","created_at");
CREATE INDEX "idx_notifications_member" ON "notifications" ("member_id");
CREATE INDEX "idx_payments_member_created" ON "payments" ("member_id","created_at");
CREATE INDEX "idx_payments_status" ON "payments" ("status");
CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");
CREATE INDEX "idx_users_queue_active" ON "users" ("active","queue_position");
CREATE UNIQUE INDEX "idx_users_auth_user_id" ON "users" ("auth_user_id");
CREATE UNIQUE INDEX "idx_users_username" ON "users" ("username");
CREATE UNIQUE INDEX "idx_accounts_username" ON "accounts" ("username");
CREATE INDEX "idx_accounts_role_active" ON "accounts" ("role","active");
CREATE INDEX "idx_bottle_events_created" ON "bottle_events" ("created_at");
CREATE INDEX "idx_bottle_events_account" ON "bottle_events" ("account_id");
CREATE INDEX "idx_sessions_user" ON "sessions" ("user_id");
CREATE INDEX "idx_sessions_expires" ON "sessions" ("expires_at");
COMMIT;
