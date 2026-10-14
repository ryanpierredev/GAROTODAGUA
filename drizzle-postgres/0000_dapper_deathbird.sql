CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" text DEFAULT 'client' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bottle_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"note" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"payment_id" integer,
	"amount_cents" integer NOT NULL,
	"kind" text NOT NULL,
	"note" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"payment_id" integer,
	"message" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"error" text,
	"created_at" bigint NOT NULL,
	"attempted_at" bigint
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"bottles" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"credit_used_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"total_bottles" integer DEFAULT 0 NOT NULL,
	"full_bottles" integer DEFAULT 0 NOT NULL,
	"bottle_price_cents" integer DEFAULT 2000 NOT NULL,
	"alert_threshold" integer DEFAULT 3 NOT NULL,
	"next_queue_position" integer DEFAULT 1 NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_user_id" text,
	"username" text,
	"password_hash" text,
	"password_salt" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" text DEFAULT 'client' NOT NULL,
	"queue_position" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bottle_events" ADD CONSTRAINT "bottle_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_accounts_username" ON "accounts" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_accounts_role_active" ON "accounts" USING btree ("role","active");--> statement-breakpoint
CREATE INDEX "idx_bottle_events_created" ON "bottle_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_bottle_events_account" ON "bottle_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_credit_member_created" ON "credit_transactions" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_status_created" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_member" ON "notifications" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_payments_member_created" ON "payments" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_payments_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_auth_user_id" ON "users" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_username" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_users_queue_active" ON "users" USING btree ("active","queue_position");