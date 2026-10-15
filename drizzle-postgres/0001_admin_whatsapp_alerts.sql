CREATE TABLE "admin_whatsapp_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipient" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_until" bigint,
	"provider_id" text,
	"error" text,
	"created_at" bigint NOT NULL,
	"submitted_at" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_admin_alert_event" ON "admin_whatsapp_alerts" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "idx_admin_alert_pending" ON "admin_whatsapp_alerts" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE FUNCTION enqueue_admin_bottle_alert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_name text;
BEGIN
  IF current_setting('garotodagua.skip_whatsapp_alerts', true) = 'on' THEN RETURN NEW; END IF;
  SELECT name INTO person_name FROM accounts WHERE id = NEW.account_id;
  INSERT INTO admin_whatsapp_alerts (event_key, title, detail, created_at)
  VALUES (
    'event-' || NEW.id,
    CASE WHEN NEW.kind = 'empty' THEN 'Garrafões vazios informados' ELSE 'Estoque atualizado' END,
    left(COALESCE(person_name, 'Usuário') || ': ' || NEW.quantity || ' garrafão(ões). ' || COALESCE(NEW.note, ''), 1024),
    (extract(epoch FROM clock_timestamp()) * 1000)::bigint
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER admin_bottle_alert AFTER INSERT ON bottle_events
FOR EACH ROW EXECUTE FUNCTION enqueue_admin_bottle_alert();
--> statement-breakpoint
CREATE FUNCTION enqueue_admin_customer_alert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_name text;
BEGIN
  IF current_setting('garotodagua.skip_whatsapp_alerts', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  END IF;
  SELECT name INTO person_name FROM users WHERE id = NEW.member_id;
  INSERT INTO admin_whatsapp_alerts (event_key, title, detail, created_at)
  VALUES (
    'whatsapp-' || NEW.id || '-' || NEW.status,
    CASE NEW.status WHEN 'sent' THEN 'Mensagem enviada pelo WhatsApp'
                    WHEN 'failed' THEN 'Falha no envio pelo WhatsApp'
                    ELSE 'Mensagem aguardando envio' END,
    left('Destinatário: ' || COALESCE(person_name, 'Pessoa da cota') || '. ' || NEW.message, 1024),
    (extract(epoch FROM clock_timestamp()) * 1000)::bigint
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER admin_customer_alert AFTER INSERT OR UPDATE OF status ON notifications
FOR EACH ROW EXECUTE FUNCTION enqueue_admin_customer_alert();
