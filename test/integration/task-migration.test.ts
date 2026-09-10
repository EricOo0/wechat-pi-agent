import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../src/adapters/sqlite/migrations.js";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";

it('migrates populated version 8 without losing Turn dependents or changing their IDs', () => {
  const root = mkdtempSync(join(tmpdir(), 'task-migration-'));
  const path = join(root, 'app.db'); const db = new DatabaseSync(path);
  let control: SqliteControlPlane | undefined;
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL) STRICT;');
    for (const migration of SQLITE_MIGRATIONS.filter(m => m.version <= 8)) { db.exec(migration.sql); db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(migration.version, '2026-09-10'); }
    const now = new Date().toISOString();
    db.prepare("INSERT INTO sessions(id,session_key,account_id,peer_id,status,created_at,updated_at) VALUES('session','weixin:bot:owner','bot','owner','ACTIVE',?,?)").run(now, now);
    db.prepare("INSERT INTO inbox(id,account_id,channel_message_id,peer_id,sender_id,text,received_at,created_at) VALUES('message','bot','channel-message','owner','owner','hello',?,?)").run(now, now);
    db.prepare("INSERT INTO turns(id,session_id,inbox_id,trace_id,run_id,status,queued_at,created_at,updated_at) VALUES('turn','session','message','trace','run','REPLY_PENDING',?,?,?)").run(now, now, now);
    db.prepare("INSERT INTO steps(id,turn_id,ordinal,kind,name,status,created_at) VALUES('step','turn',0,'agent_run','agent','SUCCEEDED',?)").run(now);
    db.prepare("INSERT INTO outbox(id,turn_id,account_id,peer_id,chunk_index,text,client_id,run_id,status,attempt_count,next_attempt_at,created_at,updated_at) VALUES('out','turn','bot','owner',0,'reply','client','run','PENDING',0,?,?,?)").run(now, now, now);
    db.exec("UPDATE turns SET rowid=9 WHERE id='turn'");
    control = new SqliteControlPlane(path); control.migrate(); control.migrate();
    expect(control.healthCheck().ready).toBe(true);
    expect(db.prepare('SELECT id FROM steps').all()).toMatchObject([{ id: 'step' }]);
    expect(db.prepare('SELECT id FROM outbox').all()).toMatchObject([{ id: 'out' }]);
    expect(db.prepare('SELECT id,inbox_id,source FROM turns').get()).toMatchObject({ id: 'turn', inbox_id: 'message', source: 'user_message' });
    expect(db.prepare("SELECT rowid FROM turns WHERE id='turn'").get()?.rowid).toBe(9);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.prepare("INSERT INTO turns(id,session_id,inbox_id,trace_id,run_id,status,queued_at,created_at,updated_at,source,input_text) VALUES('internal','session','message','trace2','run2','QUEUED',?,?,?,'task_continue','continue')").run(now, now, now);
    expect(db.prepare('SELECT count(*) AS n FROM inbox').get()?.n).toBe(1);
    expect(() => db.prepare("INSERT INTO turns(id,session_id,inbox_id,trace_id,run_id,status,queued_at,created_at,updated_at) VALUES('duplicate','session','message','x','x','QUEUED',?,?,?)").run(now, now, now)).toThrow();
  } finally { control?.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});
