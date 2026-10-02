CREATE INDEX "campaigns_merchant_idx" ON "discount_campaigns" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_product_created_idx" ON "reviews" USING btree ("product_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "shopping_lists_user_idx" ON "shopping_lists" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_product_id_key" UNIQUE("user_id","product_id");--> statement-breakpoint
ALTER TABLE "discount_campaigns" ADD CONSTRAINT "discount_campaigns_dates_check" CHECK ("discount_campaigns"."end_date" > "discount_campaigns"."start_date");--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_target_price_check" CHECK ("price_alerts"."target_price" >= 0);--> statement-breakpoint
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_price_check" CHECK ("product_offers"."price" >= 0);--> statement-breakpoint
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_old_price_check" CHECK ("product_offers"."old_price" is null or "product_offers"."old_price" >= "product_offers"."price");--> statement-breakpoint
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_shipping_price_check" CHECK ("product_offers"."shipping_price" >= 0);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" between 1 and 5);--> statement-breakpoint
ALTER TABLE "seo_metadata" ADD CONSTRAINT "seo_metadata_score_check" CHECK ("seo_metadata"."score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_quantity_check" CHECK ("shopping_list_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "store_analytics_events" ADD CONSTRAINT "store_analytics_events_event_type_check" CHECK ("store_analytics_events"."event_type" in ('view', 'offer_click', 'favorite', 'alert'));