CREATE UNIQUE INDEX "credit_purchases_invoice_id_unique" ON "credit_purchases" USING btree ("invoice_id");--> statement-breakpoint
DROP INDEX "credit_purchases_invoice_id_idx";