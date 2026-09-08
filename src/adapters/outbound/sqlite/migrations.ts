export interface SqliteMigration {
  readonly version: number;
  readonly sql: string;
}

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE cursor (
        account_id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE inbox (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        channel_message_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sequence INTEGER,
        context_token TEXT,
        text TEXT NOT NULL,
        received_at TEXT NOT NULL,
        raw_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (account_id, channel_message_id)
      ) STRICT;
      CREATE INDEX inbox_account_received_idx ON inbox (account_id, received_at);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        account_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        pi_session_id TEXT,
        pi_session_file TEXT,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED', 'CORRUPTED')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX sessions_active_peer_idx
        ON sessions (account_id, peer_id) WHERE status = 'ACTIVE';
      CREATE INDEX sessions_key_idx ON sessions (session_key, created_at DESC);

      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        inbox_id TEXT NOT NULL UNIQUE REFERENCES inbox(id),
        trace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'QUEUED', 'RUNNING', 'REPLY_PENDING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED')),
        queued_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        final_response TEXT,
        error_code TEXT,
        error_message TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX turns_claim_idx ON turns (status, queued_at);
      CREATE INDEX turns_session_idx ON turns (session_id, queued_at DESC);

      CREATE TABLE steps (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        parent_step_id TEXT REFERENCES steps(id),
        ordinal INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'INTERRUPTED')),
        started_at TEXT,
        ended_at TEXT,
        input_summary TEXT,
        output_summary TEXT,
        error_json TEXT,
        event_type TEXT,
        event_at TEXT,
        event_data_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (turn_id, ordinal)
      ) STRICT;
      CREATE INDEX steps_turn_idx ON steps (turn_id, ordinal);

      CREATE TABLE outbox (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES turns(id),
        account_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        context_token TEXT,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        client_id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'RETRY_WAIT', 'DEAD_LETTER')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        remote_request_id TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE (turn_id, chunk_index)
      ) STRICT;
      CREATE INDEX outbox_claim_idx ON outbox (status, next_attempt_at, created_at);

      CREATE TABLE outbox_attempts (
        id INTEGER PRIMARY KEY,
        outbox_id TEXT NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL,
        owner_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('STARTED', 'SENT', 'FAILED', 'INTERRUPTED')),
        error_name TEXT,
        error_message TEXT,
        retry_at TEXT,
        remote_request_id TEXT,
        UNIQUE (outbox_id, attempt_no)
      ) STRICT;
      CREATE INDEX outbox_attempts_outbox_idx ON outbox_attempts (outbox_id, attempt_no DESC);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE agent_traces (
        turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        skills_json TEXT NOT NULL,
        tools_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX agent_traces_captured_idx ON agent_traces (captured_at DESC, turn_id DESC);
    `,
  },
  {
    version: 3,
    sql: `ALTER TABLE inbox ADD COLUMN images_json TEXT;`,
  },
  {
    version: 4,
    sql: `ALTER TABLE agent_traces ADD COLUMN permission_revision INTEGER;
      ALTER TABLE agent_traces ADD COLUMN permission_mode TEXT;`,
  },
  {
    version: 5,
    sql: `CREATE TABLE permission_continuations (
      permission_request_id TEXT PRIMARY KEY,
      source_turn_id TEXT NOT NULL REFERENCES turns(id),
      approval_turn_id TEXT NOT NULL REFERENCES turns(id),
      continuation_turn_id TEXT NOT NULL UNIQUE REFERENCES turns(id),
      created_at TEXT NOT NULL
    ) STRICT;`,
  },
  {
    version: 6,
    sql: `ALTER TABLE inbox ADD COLUMN files_json TEXT;
      CREATE TABLE user_files (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, message_id TEXT NOT NULL, item_index INTEGER NOT NULL,
        name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ready','failed')), bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL, mime_type TEXT NOT NULL, error_code TEXT, created_at TEXT NOT NULL,
        UNIQUE(owner_id,message_id,item_index)
      ) STRICT;
      CREATE INDEX user_files_owner_idx ON user_files(owner_id,created_at DESC);
      CREATE TABLE model_file_refs (
        file_id TEXT NOT NULL REFERENCES user_files(id), scope TEXT NOT NULL, remote_id TEXT NOT NULL,
        PRIMARY KEY(file_id,scope)
      ) STRICT;`,
  },
  {
    version: 7,
    sql: `ALTER TABLE sessions ADD COLUMN end_reason TEXT;
      ALTER TABLE sessions ADD COLUMN cleanup_done INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE memory_jobs (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id), owner_id TEXT NOT NULL,
        detail_id TEXT NOT NULL, ended_at TEXT NOT NULL, reason TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'PENDING', should_merge INTEGER NOT NULL DEFAULT 1,
        attempts INTEGER NOT NULL DEFAULT 0, worker_id TEXT, lease_until TEXT,
        next_attempt_at TEXT NOT NULL, error TEXT
      ) STRICT;
      CREATE INDEX memory_jobs_claim_idx ON memory_jobs(phase,next_attempt_at,ended_at);
      CREATE TABLE memory_job_events (
        job_id TEXT NOT NULL REFERENCES memory_jobs(id), ordinal INTEGER NOT NULL,
        event_type TEXT NOT NULL, event_at TEXT NOT NULL, event_data_json TEXT,
        PRIMARY KEY(job_id,ordinal)
      ) STRICT;`,
  },
  {
    version: 8,
    sql: `CREATE TABLE user_model_settings(owner_id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,model_id TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL) STRICT;
      CREATE TABLE turn_model_bindings(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,provider_id TEXT NOT NULL,model_id TEXT NOT NULL,selection_revision INTEGER NOT NULL,credential_revision INTEGER NOT NULL) STRICT;
      CREATE TABLE provider_credential_revisions(provider_id TEXT PRIMARY KEY,revision INTEGER NOT NULL) STRICT;
      CREATE TABLE provider_auth_operations(id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT,candidate_hash TEXT) STRICT;
      CREATE TABLE model_management_events(id INTEGER PRIMARY KEY,event_type TEXT NOT NULL,event_at TEXT NOT NULL,event_data TEXT NOT NULL) STRICT;`,
  },
];
