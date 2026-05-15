CREATE TABLE `run` (
  `id` TEXT PRIMARY KEY,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  `new_entry_count` INTEGER NOT NULL DEFAULT 0,
  `entry_total_count` INTEGER NOT NULL DEFAULT 0,
  `successful_entry_count` INTEGER NOT NULL DEFAULT 0,
  `errored_entry_count` INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `run_args` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `run_id` TEXT NOT NULL REFERENCES run(id),
  `arg_name` TEXT NOT NULL,
  `arg_value` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `domain` (
  `name` TEXT PRIMARY KEY,
  `run_id` TEXT NOT NULL REFERENCES run(id),
  `normalized_name` TEXT NOT NULL,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  `entry_total_count` INTEGER NOT NULL DEFAULT 0,
  `successful_entry_count` INTEGER NOT NULL DEFAULT 0,
  `errored_entry_count` INTEGER NOT NULL DEFAULT 0,
  `pending_entry_count` INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `cdx_source` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `base_url` TEXT NOT NULL UNIQUE,
  `replay_base_url` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cdx_entry` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `run_id` TEXT NOT NULL REFERENCES run(id),
  `domain_name` TEXT NOT NULL REFERENCES domain(name),
  `line` INTEGER NOT NULL,
  `url_key` TEXT,
  `timestamp` INTEGER,
  `original` TEXT,
  `mimetype` TEXT,
  `status_code` INTEGER,
  `digest` TEXT,
  `length` INTEGER,
  `raw` TEXT NOT NULL,
  `is_valid` INTEGER NOT NULL,
  `cdx_source_id` INTEGER NOT NULL REFERENCES cdx_source(id),
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(`cdx_source_id`, `raw`)
);
--> statement-breakpoint
CREATE TABLE `tree_node` (
  `path` TEXT PRIMARY KEY,
  `level` INTEGER NOT NULL,
  UNIQUE(`path`, `level`)
);
--> statement-breakpoint
CREATE TABLE `resource` (
  `url` TEXT PRIMARY KEY,
  `normalized_url` TEXT REFERENCES tree_node(path)
);
--> statement-breakpoint
CREATE TABLE `resource_version` (
  `url` TEXT NOT NULL REFERENCES resource(`url`),
  `timestamp` INTEGER NOT NULL,
  `successful_request_id` TEXT REFERENCES request(id),
  `last_errored_request_id` TEXT REFERENCES request(id),
  CHECK (successful_request_id IS NULL OR last_errored_request_id IS NULL),
  PRIMARY KEY (`url`, `timestamp`)
);
--> statement-breakpoint
CREATE TABLE `resource_version_source` (
  `url` TEXT NOT NULL,
  `timestamp` INTEGER NOT NULL,
  `domain_name` TEXT NOT NULL REFERENCES domain(name),
  FOREIGN KEY (`url`, `timestamp`) REFERENCES resource_version(`url`, `timestamp`),
  UNIQUE(`url`, `timestamp`, `domain_name`)
);
--> statement-breakpoint
CREATE TABLE `request` (
  `id` TEXT PRIMARY KEY,
  `run_id` TEXT NOT NULL REFERENCES run(id),
  `resource_version_url` TEXT NOT NULL,
  `resource_version_timestamp` INTEGER NOT NULL,
  `status_code` INTEGER,
  `mimetype` TEXT,
  `location` TEXT,
  `location_original` TEXT,
  `location_timestamp` INTEGER,
  `body_digest` TEXT,
  `inferred_gzip` INTEGER,
  `duration_ms` INTEGER NOT NULL,
  `proxy_address` TEXT,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  `is_successful` INTEGER NOT NULL,
  `encoding` TEXT,
  `encoding_source` TEXT,
  `chardet_confidence` REAL,
  `is_foreign_redirect` INTEGER,
  `redirect_domain` TEXT,
  `redirect_normalized_domain` TEXT,
  FOREIGN KEY (`resource_version_url`, `resource_version_timestamp`) REFERENCES resource_version(`url`, `timestamp`)
);
--> statement-breakpoint
CREATE TABLE `request_errors` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `request_id` TEXT NOT NULL REFERENCES request(id),
  `error_name` TEXT NOT NULL,
  `error_code` TEXT NOT NULL,
  `error_message` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `response_header` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `request_id` TEXT NOT NULL REFERENCES request(id),
  `header_name` TEXT NOT NULL,
  `header_value` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_domain_stats` (
  `run_id` TEXT NOT NULL REFERENCES run(id),
  `domain_name` TEXT NOT NULL REFERENCES domain(name),
  `attempted_entry_count` INTEGER NOT NULL DEFAULT 0,
  `successful_entry_count` INTEGER NOT NULL DEFAULT 0,
  `errored_entry_count` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`run_id`, `domain_name`)
);
--> statement-breakpoint
CREATE TABLE `run_error_type_stats` (
  `run_id` TEXT NOT NULL REFERENCES run(id),
  `domain_name` TEXT NOT NULL REFERENCES domain(name),
  `error_name` TEXT NOT NULL,
  `error_code` TEXT NOT NULL,
  `count` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`run_id`, `domain_name`, `error_name`, `error_code`)
);
--> statement-breakpoint
CREATE INDEX `idx_cdx_entry_raw` ON `cdx_entry`(`raw`);
--> statement-breakpoint
CREATE INDEX `idx_cdx_entry_run_id` ON `cdx_entry`(`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_request_run_id_id` ON `request`(`run_id`, `id`);
--> statement-breakpoint
CREATE INDEX `idx_resource_version_source_domain_name` ON `resource_version_source`(`domain_name`);
--> statement-breakpoint
CREATE INDEX `idx_resource_version_successful_request_id` ON `resource_version`(`successful_request_id`);
--> statement-breakpoint
CREATE INDEX `idx_request_resource_version` ON `request`(`resource_version_url`, `resource_version_timestamp`);
--> statement-breakpoint
CREATE INDEX `idx_request_run_id_resource_version_is_successful` ON `request`(`run_id`, `resource_version_url`, `resource_version_timestamp`, `is_successful`);
--> statement-breakpoint
CREATE INDEX `idx_request_errors_request_id` ON `request_errors`(`request_id`);
--> statement-breakpoint
CREATE INDEX `idx_request_errors_request_id_error_name_error_code` ON `request_errors`(`request_id`, `error_name`, `error_code`);
--> statement-breakpoint
CREATE INDEX `idx_request_mimetype_location_body_digest` ON `request`(`mimetype`, `location`, `body_digest`);
--> statement-breakpoint
CREATE INDEX `idx_request_v_url_ts_location_null` ON `request`(`mimetype`, `resource_version_url`, `resource_version_timestamp`) WHERE location IS NULL AND mimetype = 'text/html';
--> statement-breakpoint
CREATE INDEX `idx_resource_version_source_domain_name_url_timestamp` ON `resource_version_source`(`domain_name`, `url`, `timestamp`);
--> statement-breakpoint
CREATE INDEX `idx_resource_normalized_url` ON `resource`(`normalized_url`);
--> statement-breakpoint
CREATE INDEX `idx_tree_node_level_path` ON `tree_node`(`level`, `path`);
