CREATE TABLE `bailu_service_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`request_timestamp` integer NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `bailu_service_requests` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`request_kind` text NOT NULL,
	`request_sha256` text NOT NULL,
	`external_project_id` text,
	`studio_run_id` text,
	`external_task_id` text,
	`composition_id` text,
	`state` text NOT NULL,
	`terminal_payload` text,
	`terminal_payload_sha256` text,
	`callback_idempotency_key` text,
	`callback_nonce` text,
	`callback_status` text DEFAULT 'pending' NOT NULL,
	`callback_attempts` integer DEFAULT 0 NOT NULL,
	`callback_last_error_code` text,
	`callback_delivered_at` integer,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bailu_service_requests_studio_run_id_unique` ON `bailu_service_requests` (`studio_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bailu_service_requests_external_task_id_unique` ON `bailu_service_requests` (`external_task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bailu_service_requests_composition_id_unique` ON `bailu_service_requests` (`composition_id`);