CREATE TABLE `organizations` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `owner_email` text NOT NULL,
  `plan` text DEFAULT 'trial' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `email` text NOT NULL,
  `name` text DEFAULT '' NOT NULL,
  `role` text DEFAULT 'manager' NOT NULL,
  `password_hash` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);

CREATE TABLE `subscriptions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `provider` text DEFAULT 'stripe' NOT NULL,
  `provider_customer_id` text,
  `provider_subscription_id` text,
  `status` text DEFAULT 'trialing' NOT NULL,
  `current_period_end` text,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `allegro_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `account_name` text DEFAULT '' NOT NULL,
  `seller_id` text,
  `access_token_encrypted` text,
  `refresh_token_encrypted` text,
  `token_expires_at` text,
  `scopes` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `listing_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `created_by_user_id` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `vehicle_models` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `manufacturer` text NOT NULL,
  `short_name` text NOT NULL,
  `full_description` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `listings` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `title` text NOT NULL,
  `entered_part_number` text DEFAULT '' NOT NULL,
  `original_catalog_number` text DEFAULT '' NOT NULL,
  `category_id` text DEFAULT '' NOT NULL,
  `category_path` text DEFAULT '' NOT NULL,
  `manufacturer` text DEFAULT '' NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `required_parameters_json` text DEFAULT '{}' NOT NULL,
  `price_cents` integer,
  `stock` integer DEFAULT 1 NOT NULL,
  `shipping_rate_id` text DEFAULT '' NOT NULL,
  `return_policy_id` text DEFAULT '' NOT NULL,
  `implied_warranty_id` text DEFAULT '' NOT NULL,
  `warranty_id` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `allegro_offer_id` text,
  `publish_error` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `listing_sessions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `listing_images` (
  `id` text PRIMARY KEY NOT NULL,
  `listing_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `storage_key` text NOT NULL,
  `file_name` text NOT NULL,
  `content_type` text DEFAULT 'image/jpeg' NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `is_main` integer DEFAULT false NOT NULL,
  `allegro_url` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
