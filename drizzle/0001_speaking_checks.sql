CREATE TABLE speaking_checks (request_id TEXT PRIMARY KEY NOT NULL, actor_hash TEXT NOT NULL, student_id TEXT REFERENCES students(id), word_id TEXT NOT NULL, lesson_id TEXT, status TEXT NOT NULL, result_json TEXT, created_at INTEGER NOT NULL, duration REAL NOT NULL);
--> statement-breakpoint
CREATE INDEX speaking_checks_actor_time ON speaking_checks(actor_hash,created_at);
--> statement-breakpoint
CREATE INDEX speaking_checks_time ON speaking_checks(created_at);
