CREATE TABLE "admin_telegram_alerts" (
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
CREATE UNIQUE INDEX "idx_telegram_alert_event" ON "admin_telegram_alerts" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "idx_telegram_alert_pending" ON "admin_telegram_alerts" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE FUNCTION enqueue_telegram_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  item_id text;
  alert_title text;
  alert_detail text;
  person_name text;
BEGIN
  IF current_setting('garotodagua.skip_telegram_alerts', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    -- Credit balance changes are reported by credit_transactions, avoiding
    -- duplicate balance-only alerts from users.
    IF TG_TABLE_NAME = 'users' AND (to_jsonb(NEW) - 'credit_cents') = (to_jsonb(OLD) - 'credit_cents') THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'notifications' AND (to_jsonb(NEW)->>'status') = (to_jsonb(OLD)->>'status') THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'settings' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN RETURN NEW; END IF;
  END IF;
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  item_id := row_data->>'id';
  CASE TG_TABLE_NAME
    WHEN 'users' THEN
      alert_title := CASE TG_OP WHEN 'INSERT' THEN 'Pessoa adicionada à cota' WHEN 'DELETE' THEN 'Pessoa removida da cota' ELSE 'Cadastro da pessoa atualizado' END;
      alert_detail := COALESCE(row_data->>'name', 'Pessoa') || '. Posição na fila: ' || COALESCE(row_data->>'queue_position', '-');
    WHEN 'accounts' THEN
      alert_title := CASE TG_OP WHEN 'INSERT' THEN 'Novo usuário de acesso' WHEN 'DELETE' THEN 'Usuário de acesso removido' ELSE 'Usuário de acesso atualizado' END;
      alert_detail := COALESCE(row_data->>'name', 'Usuário') || ' (@' || COALESCE(row_data->>'username', '') || ').';
    WHEN 'settings' THEN
      alert_title := 'Estoque e configuração atualizados';
      alert_detail := 'Garrafões cheios: ' || COALESCE(row_data->>'full_bottles', '0') || ' de ' || COALESCE(row_data->>'total_bottles', '0') || '. Limite de alerta: ' || COALESCE(row_data->>'alert_threshold', '0') || '.';
      IF COALESCE((row_data->>'full_bottles')::integer, 0) <= COALESCE((row_data->>'alert_threshold')::integer, 0) THEN
        alert_title := 'Atenção: estoque baixo';
      END IF;
    WHEN 'bottle_events' THEN
      SELECT name INTO person_name FROM accounts WHERE id = row_data->>'account_id';
      alert_title := CASE WHEN row_data->>'kind' = 'empty' THEN 'Garrafões vazios informados' ELSE 'Movimentação de garrafões' END;
      alert_detail := COALESCE(person_name, 'Usuário') || ': ' || COALESCE(row_data->>'quantity', '0') || ' garrafão(ões). ' || COALESCE(row_data->>'note', '');
    WHEN 'payments' THEN
      SELECT name INTO person_name FROM users WHERE id = row_data->>'member_id';
      alert_title := CASE WHEN row_data->>'status' = 'paid' THEN 'Pagamento confirmado' ELSE 'Pagamento pendente' END;
      alert_detail := COALESCE(person_name, 'Pessoa') || '. Garrafões: ' || COALESCE(row_data->>'bottles', '0') || '. Total: R$ ' || replace(((row_data->>'total_cents')::numeric / 100)::text, '.', ',') || '.';
    WHEN 'credit_transactions' THEN
      SELECT name INTO person_name FROM users WHERE id = row_data->>'member_id';
      alert_title := 'Crédito movimentado';
      alert_detail := COALESCE(person_name, 'Pessoa') || '. Valor: R$ ' || replace(((row_data->>'amount_cents')::numeric / 100)::text, '.', ',') || '. ' || COALESCE(row_data->>'note', '');
    WHEN 'notifications' THEN
      SELECT name INTO person_name FROM users WHERE id = row_data->>'member_id';
      alert_title := CASE row_data->>'status' WHEN 'sent' THEN 'Cobrança enviada pelo WhatsApp' WHEN 'failed' THEN 'Falha no envio da cobrança' ELSE 'Cobrança aguardando envio' END;
      alert_detail := 'Pessoa: ' || COALESCE(person_name, 'Pessoa da cota') || '. ' || COALESCE(row_data->>'message', '');
    ELSE
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END CASE;
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME NOT IN ('accounts', 'users') THEN alert_title := 'Registro removido: ' || alert_title; END IF;
  INSERT INTO admin_telegram_alerts (event_key, title, detail, created_at)
    VALUES (TG_TABLE_NAME || '-' || item_id || '-' || txid_current(), alert_title,
      left(alert_detail, 3000), (extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    ON CONFLICT (event_key) DO UPDATE SET title = EXCLUDED.title, detail = EXCLUDED.detail;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER telegram_users_change AFTER INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION enqueue_telegram_change();
--> statement-breakpoint
CREATE TRIGGER telegram_accounts_change AFTER INSERT OR UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION enqueue_telegram_change();
--> statement-breakpoint
CREATE TRIGGER telegram_settings_change AFTER INSERT OR UPDATE OR DELETE ON settings FOR EACH ROW EXECUTE FUNCTION enqueue_telegram_change();
--> statement-breakpoint
CREATE TRIGGER telegram_bottles_change AFTER INSERT OR UPDATE OR DELETE ON bottle_events FOR EACH ROW EXECUTE FUNCTION enqueue_telegram_change();
--> statement-breakpoint
CREATE TRIGGER telegram_payments_change AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION enqueue_telegram_change();
--> statement-breakpoint
CREATE TRIGGER telegram_credit_change AFTER INSERT OR UPDATE OR DELETE ON credit_transactions FOR EACH ROW EXECUTE FUNCTION enqueue_telegram_change();
--> statement-breakpoint
CREATE TRIGGER telegram_notifications_change AFTER INSERT OR UPDATE OR DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION enqueue_telegram_change();
