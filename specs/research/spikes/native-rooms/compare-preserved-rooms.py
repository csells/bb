import argparse
import datetime
import hashlib
import json
import pathlib
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument("rooms_before")
parser.add_argument("rooms_after")
parser.add_argument("core_before")
parser.add_argument("core_after")
parser.add_argument("expected_room_id")
parser.add_argument("evidence")
args = parser.parse_args()


def opened(path, snapshot=False):
    resolved = pathlib.Path(path).resolve()
    if snapshot:
        wal = resolved.with_name(resolved.name + "-wal")
        assert not wal.exists() or wal.stat().st_size == 0, "Snapshot still has a write-ahead log"
    result = sqlite3.connect(resolved.as_uri() + "?mode=ro" + ("&immutable=1" if snapshot else ""), uri=True)
    result.row_factory = sqlite3.Row
    result.execute("PRAGMA query_only=ON")
    result.execute("BEGIN")
    return result


def quoted(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def columns(db, table):
    return [row["name"] for row in db.execute("PRAGMA table_info(" + quoted(table) + ")")]


def compare_rows(before, after, table, keys, selected=None, where="1", params=()):
    selected = selected or columns(before, table)
    projection = ",".join(map(quoted, selected))
    rows = [dict(row) for row in before.execute("SELECT " + projection + " FROM " + quoted(table) + " WHERE " + where, params)]
    preserved = []
    for row in rows:
        key_values = [row[key] for key in keys]
        found = after.execute("SELECT " + projection + " FROM " + quoted(table) + " WHERE " + " AND ".join(quoted(key) + " IS ?" for key in keys), key_values).fetchone()
        assert found is not None, table + " lost an existing row"
        actual = dict(found)
        assert actual == row, table + " changed an existing row; key digest " + digest(key_values)
        preserved.append(actual)
    before_hash = digest(sorted(rows, key=lambda row: json.dumps(row, sort_keys=True)))
    after_hash = digest(sorted(preserved, key=lambda row: json.dumps(row, sort_keys=True)))
    return {"table": table, "existingRows": len(rows), "beforeSha256": before_hash, "afterSha256": after_hash, "preserved": True}


rooms_before = opened(args.rooms_before, snapshot=True)
rooms_after = opened(args.rooms_after)
core_before = opened(args.core_before, snapshot=True)
core_after = opened(args.core_after)
try:
    assert rooms_before.execute("SELECT 1 FROM rooms_rooms WHERE id=?", (args.expected_room_id,)).fetchone(), "Expected Workshop is absent from backup"
    assert rooms_after.execute("SELECT 1 FROM rooms_rooms WHERE id=?", (args.expected_room_id,)).fetchone(), "Expected Workshop is absent after cutover"
    tables = [row[0] for row in rooms_before.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rooms_%' ORDER BY name")]
    history_tables = {"rooms_messages", "rooms_deliveries", "rooms_activations", "rooms_receipts", "rooms_streams", "rooms_chunks", "rooms_steering"}
    room_results = []
    for table in tables:
        pk = sorted([row for row in rooms_before.execute("PRAGMA table_info(" + quoted(table) + ")") if row["pk"]], key=lambda row: row["pk"])
        assert pk, "Missing comparison identity for " + table
        result = compare_rows(rooms_before, rooms_after, table, [row["name"] for row in pk])
        result["additionalRows"] = rooms_after.execute("SELECT count(*) FROM " + quoted(table)).fetchone()[0] - result["existingRows"]
        if table in history_tables:
            assert result["additionalRows"] == 0, table + " gained rows before new user activity; investigate replay"
        room_results.append(result)
    bindings = [dict(row) for row in rooms_before.execute("SELECT id,room_id,handle,provider,project_id,thread_id FROM rooms_agents WHERE thread_id IS NOT NULL ORDER BY id")]
    native_results = []
    for binding in bindings:
        thread_id = binding["thread_id"]
        before_thread = core_before.execute("SELECT * FROM threads WHERE id=?", (thread_id,)).fetchone()
        assert before_thread, "Existing native binding missing from core backup: " + thread_id
        assert before_thread["project_id"] == binding["project_id"]
        assert before_thread["provider_id"] == binding["provider"]
        preserved_columns = [name for name in columns(core_before, "threads") if name not in {"status", "updated_at", "last_read_at", "latest_attention_at"}]
        thread_result = compare_rows(core_before, core_after, "threads", ["id"], preserved_columns, "id=?", (thread_id,))
        history_result = compare_rows(core_before, core_after, "events", ["id"], where="thread_id=?", params=(thread_id,))
        last_sequence = core_before.execute("SELECT coalesce(max(sequence),0) FROM events WHERE thread_id=?", (thread_id,)).fetchone()[0]
        added_types = [dict(row) for row in core_after.execute("SELECT type,count(*) AS count FROM events WHERE thread_id=? AND sequence>? GROUP BY type ORDER BY type", (thread_id, last_sequence))]
        assert not any(row["type"] in {"client/turn/requested", "turn/started"} for row in added_types), "Native work replayed during migration: " + thread_id
        project_result = compare_rows(core_before, core_after, "projects", ["id"], where="id=?", params=(binding["project_id"],))
        defaults_result = compare_rows(core_before, core_after, "project_execution_defaults", ["project_id"], where="project_id=?", params=(binding["project_id"],))
        environment_columns = ["id", "project_id", "host_id", "path", "environment_provider_id", "environment_provider_plugin_id", "environment_provider_selection", "environment_provider_instance_key", "owner_thread_id", "created_at"]
        environment_result = compare_rows(core_before, core_after, "environments", ["id"], environment_columns, "id=?", (before_thread["environment_id"],))
        native_results.append({"binding": binding, "thread": thread_result, "history": history_result, "project": project_result, "executionDefaults": defaults_result, "environment": environment_result, "additionalEventTypes": added_types})
    for db in [rooms_after, core_after]:
        assert db.execute("PRAGMA integrity_check").fetchall()[0][0] == "ok"
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    report = {
        "verifiedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "expectedRoomId": args.expected_room_id,
        "sourceDatabasesOpenedReadOnly": True,
        "destinationDatabasesOpenedReadOnly": True,
        "historyReplayDetected": False,
        "roomTables": room_results,
        "nativeBindings": native_results,
        "ok": True,
    }
    evidence = pathlib.Path(args.evidence)
    evidence.parent.mkdir(parents=True, exist_ok=True)
    with evidence.open("x") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps({"ok": True, "roomTables": len(room_results), "nativeBindings": len(native_results), "evidence": str(evidence)}))
finally:
    for db in [rooms_before, rooms_after, core_before, core_after]:
        db.close()
