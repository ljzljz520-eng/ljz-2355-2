#!/usr/bin/env python3
"""
Zero-dependency backend for the component documentation site.

Responsibilities
----------------
* SQL persistence of component versions, builds, test artifacts, release
  relations, breaking changes, migration notes, retest cases, deprecations.
* On-demand contract extraction from an EXACT git commit (shells out to the
  Node static extractor).
* Partial-upload artifact registry (each artifact is acknowledged separately;
  a failed upload never blocks or corrupts siblings).
* Release gate: a breaking change cannot be published without a migration note
  AND passing retest cases; production site data only exposes examples whose
  artifacts uploaded AND passed.
* Static doc hosting + a separate, locked-down preview origin.

Run:  python3 server/server.py --db docs.db --storage store --site dist \
       --port 4173 --preview-port 4174
"""
import argparse, hashlib, json, os, sqlite3, subprocess, sys, threading, time, secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent.parent
TOKEN_TTL = 12 * 3600

PREVIEW_HEADERS = {
    # The preview renders USER CODE, isolated from the main site's login
    # context. It is served from a distinct port (separate origin in
    # production, e.g. preview.docs.example.com) and locked down hard.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; sandbox",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}
SITE_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src http://localhost:4174 http://127.0.0.1:4174; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


class Store:
    def __init__(self, db_path, storage):
        self.storage = Path(storage); self.storage.mkdir(parents=True, exist_ok=True)
        # RLock: higher-level readers (site_data) call nested helpers that
        # also take the lock while iterating a connection.
        self.lock = threading.RLock()
        self.db = db_path
        self.init()

    def conn(self):
        c = sqlite3.connect(self.db, timeout=15)
        c.row_factory = sqlite3.Row; c.execute("PRAGMA foreign_keys=ON")
        return c

    def init(self):
        with self.lock, self.conn() as c:
            c.executescript((ROOT / "server/schema.sql").read_text())

    # ---------- helpers ----------
    def token_ok(self, token):
        if not token: return False
        with self.lock, self.conn() as c:
            r = c.execute("SELECT created_at FROM sessions WHERE token=?", (token,)).fetchone()
        if not r: return False
        try: age = time.time() - time.mktime(time.strptime(r["created_at"], "%Y-%m-%d %H:%M:%S"))
        except Exception: age = 0
        return age < TOKEN_TTL

    def extract(self, commit, component):
        p = subprocess.run(["node", "tools/extract.mjs", commit, component], cwd=ROOT,
                           capture_output=True, text=True, timeout=30)
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip() or "extraction failed")
        return json.loads(p.stdout)

    def register_version(self, component, version, sha, branch=None):
        with self.lock, self.conn() as c:
            c.execute("INSERT OR IGNORE INTO components(name) VALUES(?)", (component,))
            cid = c.execute("SELECT id FROM components WHERE name=?", (component,)).fetchone()["id"]
            c.execute("""INSERT INTO component_versions(component_id,version,commit_sha,branch,released_at)
                         VALUES(?,?,?,?,?) ON CONFLICT(component_id,version) DO UPDATE SET commit_sha=excluded.commit_sha, branch=excluded.branch""",
                      (cid, version, sha, branch, None))
            vid = c.execute("SELECT id FROM component_versions WHERE component_id=? AND version=?", (cid, version)).fetchone()["id"]
        return cid, vid

    def save_build(self, component, version, sha, status, contract, gates, warnings, test_runs, artifacts_meta):
        with self.lock, self.conn() as c:
            c.execute("INSERT OR IGNORE INTO components(name) VALUES(?)", (component,))
            cid = c.execute("SELECT id FROM components WHERE name=?", (component,)).fetchone()["id"]
            vr = c.execute("SELECT id FROM component_versions WHERE component_id=? AND version=?", (cid, version)).fetchone()
            if not vr: raise LookupError(f"version {component}@{version} not registered")
            vid = vr["id"]
            cur = c.execute("INSERT INTO builds(component_id,version_id,commit_sha,status,gates,warnings) VALUES(?,?,?,?,?,?)",
                            (cid, vid, sha, status, json.dumps(gates), json.dumps(warnings)))
            bid = cur.lastrowid
            for k, v in (contract.get("props") or {}).items():
                c.execute("INSERT INTO contract_props(build_id,component_version_id,name,data) VALUES(?,?,?,?)", (bid, vid, k, json.dumps(v, ensure_ascii=False)))
            for table, key in (("contract_events", "events"), ("contract_slots", "slots"), ("contract_types", "types")):
                for k, v in (contract.get(key) or {}).items():
                    c.execute(f"INSERT INTO {table}(build_id,component_version_id,name,data) VALUES(?,?,?,?)", (bid, vid, k, json.dumps(v, ensure_ascii=False)))
            for tr in test_runs:
                c.execute("""INSERT INTO test_runs(build_id,example,status,html,events,violations,error,duration_ms,uploaded)
                             VALUES(?,?,?,?,?,?,?,?,0)""",
                          (bid, tr["example"], tr["status"], tr.get("html"), json.dumps(tr.get("events", []), ensure_ascii=False),
                           json.dumps(tr.get("violations", []), ensure_ascii=False), tr.get("error"), tr.get("durationMs")))
            for a in artifacts_meta:
                c.execute("INSERT INTO artifacts(build_id,kind,name,uploaded,upload_error) VALUES(?,?,?,0,?)",
                          (bid, a["kind"], a["name"], a.get("error")))
        return bid

    def write_artifact(self, build_id, kind, name, data: bytes, fail_rate=0):
        # Test hooks for partial-upload acceptance:
        #   ARTIFACT_FAIL_RATE  : random failure probability (object-store flake)
        #   ARTIFACT_FAIL_KINDS : comma list of kinds that ALWAYS fail
        import random
        fail_kinds = {k.strip() for k in os.environ.get("ARTIFACT_FAIL_KINDS", "").split(",") if k.strip()}
        forced_fail = os.environ.get("ARTIFACT_FAIL_NAME") == name
        if (fail_rate and random.random() < fail_rate) or kind in fail_kinds or forced_fail:
            with self.lock, self.conn() as c:
                c.execute("UPDATE artifacts SET uploaded=0, upload_error=? WHERE build_id=? AND kind=? AND name=?",
                          ("simulated store 503", build_id, kind, name))
            return False
        sha = hashlib.sha256(data).hexdigest()
        d = self.storage / sha[:2]; d.mkdir(parents=True, exist_ok=True)
        path = d / sha
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data); os.replace(tmp, path)  # atomic, immutable content-addressed
        with self.lock, self.conn() as c:
            c.execute("""INSERT INTO artifacts(build_id,kind,name,sha256,bytes,uploaded,upload_error)
                         VALUES(?,?,?,?,?,1,NULL)
                         ON CONFLICT(id) DO NOTHING""", (build_id, kind, name, sha, len(data)))
            c.execute("""UPDATE artifacts SET sha256=?,bytes=?,uploaded=1,upload_error=NULL
                         WHERE build_id=? AND kind=? AND name=?""", (sha, len(data), build_id, kind, name))
            if kind == "preview":
                c.execute("UPDATE test_runs SET uploaded=1 WHERE build_id=? AND example=?", (build_id, name))
        return True

    def latest_build(self, c, vid):
        return c.execute("SELECT * FROM builds WHERE version_id=? ORDER BY id DESC LIMIT 1", (vid,)).fetchone()

    def published_examples(self, bid):
        # Production rule: only examples that (a) passed all gates and
        # (b) actually uploaded their preview bundle may appear on the page.
        with self.lock, self.conn() as c:
            rows = c.execute("SELECT * FROM test_runs WHERE build_id=? AND status='pass' AND uploaded=1", (bid,)).fetchall()
            blocked = c.execute("SELECT example,status,uploaded FROM test_runs WHERE build_id=? AND (status!='pass' OR uploaded=0)", (bid,)).fetchall()
        return [dict(r) for r in rows], [dict(r) for r in blocked]

    def release(self, component, version, channel, retest_results):
        with self.lock, self.conn() as c:
            cid = c.execute("SELECT id FROM components WHERE name=?", (component,)).fetchone()["id"]
            vr = c.execute("SELECT id FROM component_versions WHERE component_id=? AND version=?", (cid, version)).fetchone()
            if not vr: raise LookupError("unknown version")
            vid = vr["id"]
            build = self.latest_build(c, vid)
            if not build or build["status"] != "passed":
                raise PermissionError("release gate: no passed build for this version")
            # Breaking changes must have a migration note recorded.
            bcs = c.execute("SELECT * FROM breaking_changes WHERE component_id=? AND introduced_version=?", (cid, version)).fetchall()
            note = c.execute("SELECT 1 FROM migration_notes WHERE component_id=? AND version=?", (cid, version)).fetchone()
            missing = []
            if bcs and not note: missing.append("migration note")
            # retest cases must exist and all pass
            cases = c.execute("SELECT * FROM retest_cases WHERE component_id=? AND version=?", (cid, version)).fetchall()
            case_results = retest_results or {}
            failed_cases = []
            for rc in cases:
                if not case_results.get(rc["case_id"]):
                    failed_cases.append(rc["case_id"])
            if bcs and not cases: missing.append("retest cases")
            if missing or failed_cases:
                raise PermissionError(f"release gate blocked: missing={missing} failed_retest={failed_cases}")
            prev = c.execute("""SELECT v.id FROM releases r JOIN component_versions v ON v.id=r.version_id
                                WHERE r.component_id=? ORDER BY r.id DESC LIMIT 1""", (cid,)).fetchone()
            c.execute("""INSERT INTO releases(component_id,version_id,channel,supersedes_version_id,published_at)
                         VALUES(?,?,?,?,datetime('now'))
                         ON CONFLICT(component_id,version_id) DO UPDATE SET channel=excluded.channel, supersedes_version_id=excluded.supersedes_version_id""",
                      (cid, vid, channel, prev["id"] if prev else None))
            c.execute("UPDATE component_versions SET released_at=datetime('now') WHERE id=?", (vid,))
            return {"version": version, "channel": channel, "superseded": prev["id"] if prev else None}

    def backfill_deprecation(self, component, subject_type, subject_name, removed_in):
        with self.lock, self.conn() as c:
            cid = c.execute("SELECT id FROM components WHERE name=?", (component,)).fetchone()["id"]
            c.execute("""UPDATE deprecations SET removed_in_version=?
                         WHERE component_id=? AND subject_type=? AND subject_name=? AND removed_in_version IS NULL""",
                      (removed_in, cid, subject_type, subject_name))

    def add_deprecation(self, component, stype, sname, since, note, removed_in=None):
        with self.lock, self.conn() as c:
            cid = c.execute("INSERT OR IGNORE INTO components(name) VALUES(?) RETURNING id", (component,)).fetchone()
            if cid is None: cid = c.execute("SELECT id FROM components WHERE name=?", (component,)).fetchone()
            c.execute("""INSERT INTO deprecations(component_id,subject_type,subject_name,since_version,removed_in_version,note)
                         VALUES(?,?,?,?,?,?) ON CONFLICT(component_id,subject_type,subject_name,since_version)
                         DO UPDATE SET removed_in_version=excluded.removed_in_version""",
                      (cid["id"], stype, sname, since, removed_in, note))

    def add_breaking(self, component, change_id, kind, version, doc):
        with self.lock, self.conn() as c:
            cid = c.execute("SELECT id FROM components WHERE name=?", (component,)).fetchone()["id"]
            c.execute("""INSERT OR IGNORE INTO breaking_changes(component_id,change_id,kind,introduced_version,migration_doc)
                         VALUES(?,?,?,?,?)""", (cid, change_id, kind, version, doc))

    def add_migration(self, component, version, sha, body):
        with self.lock, self.conn() as c:
            cid = c.execute("SELECT id FROM components WHERE name=?", (component,)).fetchone()["id"]
            c.execute("""INSERT INTO migration_notes(component_id,version,commit_sha,body) VALUES(?,?,?,?)
                         ON CONFLICT(component_id,version) DO UPDATE SET body=excluded.body, commit_sha=excluded.commit_sha""",
                      (cid, version, sha, body))

    def add_retest(self, component, version, cases):
        with self.lock, self.conn() as c:
            cid = c.execute("SELECT id FROM components WHERE name=?", (component,)).fetchone()["id"]
            for case in cases:
                c.execute("""INSERT INTO retest_cases(component_id,version,case_id,data,passed) VALUES(?,?,?,?,0)
                             ON CONFLICT(id) DO NOTHING""", (cid, version, case["id"], json.dumps(case, ensure_ascii=False)))

    def mark_retest(self, component, version, results):
        with self.lock, self.conn() as c:
            cid = c.execute("SELECT id FROM components WHERE name=?", (component,)).fetchone()["id"]
            for cid_case, ok in results.items():
                c.execute("UPDATE retest_cases SET passed=? WHERE component_id=? AND version=? AND case_id=?", (1 if ok else 0, cid, version, cid_case))

    def site_data(self):
        """Immutable per-version view used by the static site renderer.
        Each page only ever references the build pinned to that version."""
        out = {"components": {}}
        with self.lock, self.conn() as c:
            for comp in c.execute("SELECT * FROM components").fetchall():
                versions = []
                for vr in c.execute("""SELECT v.*, r.channel FROM component_versions v
                                       JOIN releases r ON r.version_id=v.id WHERE v.component_id=?
                                       ORDER BY v.id""", (comp["id"],)).fetchall():
                    build = self.latest_build(c, vr["id"])
                    if not build: continue
                    bid = build["id"]
                    props = [json.loads(r["data"]) | {"name": r["name"]} for r in c.execute("SELECT name,data FROM contract_props WHERE build_id=?", (bid,))]
                    events = [json.loads(r["data"]) | {"name": r["name"]} for r in c.execute("SELECT name,data FROM contract_events WHERE build_id=?", (bid,))]
                    slots = [json.loads(r["data"]) | {"name": r["name"]} for r in c.execute("SELECT name,data FROM contract_slots WHERE build_id=?", (bid,))]
                    types = [json.loads(r["data"]) | {"name": r["name"]} for r in c.execute("SELECT name,data FROM contract_types WHERE build_id=?", (bid,))]
                    examples, blocked = self.published_examples(bid)
                    preview_sha = {r["name"]: r["sha256"] for r in c.execute(
                        "SELECT name,sha256 FROM artifacts WHERE build_id=? AND kind='preview' AND uploaded=1", (bid,))}
                    deps = [dict(r) for r in c.execute("""SELECT subject_type,subject_name,since_version,removed_in_version,note FROM deprecations
                                                          WHERE component_id=? AND since_version<=? AND (removed_in_version IS NULL OR removed_in_version>?)""",
                                                       (comp["id"], vr["version"], vr["version"]))]
                    note = c.execute("SELECT body,commit_sha FROM migration_notes WHERE component_id=? AND version=?", (comp["id"], vr["version"])).fetchone()
                    versions.append({
                        "version": vr["version"], "commit": vr["commit_sha"], "branch": vr["branch"],
                        "channel": vr["channel"], "buildId": bid, "buildStatus": build["status"],
                        "props": props, "events": events, "slots": slots, "types": types,
                        "examples": [{"name": r["example"], "hash": preview_sha.get(r["example"]), "html": r["html"], "events": json.loads(r["events"] or "[]"),
                                      "violations": json.loads(r["violations"] or "[]"), "durationMs": r["duration_ms"]} for r in examples],
                        "blockedExamples": blocked,
                        "deprecations": deps,
                        "migration": dict(note) if note else None,
                    })
                if versions:
                    out["components"][comp["name"]] = {"name": comp["name"], "versions": versions}
        return out

    def login(self):
        token = secrets.token_hex(24)
        with self.lock, self.conn() as c:
            c.execute("INSERT INTO sessions(token) VALUES(?)", (token,))
        return token


class Handler(BaseHTTPRequestHandler):
    store = None; site_dir = None; preview_dir = None
    def log_message(self, fmt, *a):  # quiet
        pass

    def _send(self, code, body=b"", headers=None, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)): body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)

    def _auth(self):
        h = self.headers.get("Authorization", "")
        token = h[7:] if h.startswith("Bearer ") else parse_qs(urlparse(self.path).query).get("token", [""])[0]
        return self.store.token_ok(token)

    def _json_body(self):
        n = int(self.headers.get("Content-Length", 0)); raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw or b"{}")

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        try:
            if u.path == "/healthz": return self._send(200, {"ok": True})
            if u.path == "/api/site-data": return self._send(200, self.store.site_data())
            if u.path == "/api/contract":
                if not self._auth(): return self._send(401, {"error": "unauthorized"})
                return self._send(200, self.store.extract(q["commit"][0], q["component"][0]))
            if u.path.startswith("/preview/"):
                return self._serve_preview(u.path[len("/preview/"):], q)
            return self._serve_site(u.path)
        except Exception as e:
            return self._send(500, {"error": str(e)})

    def do_POST(self):
        u = urlparse(self.path)
        try:
            if u.path == "/api/admin/login":
                body = self._json_body()
                pwd = os.environ.get("DOC_ADMIN_PASSWORD", "dev-password")
                if body.get("password") != pwd: return self._send(403, {"error": "bad credentials"})
                return self._send(200, {"token": self.store.login()})
            if not self._auth(): return self._send(401, {"error": "unauthorized"})
            body = self._json_body()
            if u.path == "/api/admin/versions":
                cid, vid = self.store.register_version(body["component"], body["version"], body["sha"], body.get("branch"))
                return self._send(200, {"componentId": cid, "versionId": vid})
            if u.path == "/api/admin/builds":
                bid = self.store.save_build(body["component"], body["version"], body["sha"], body["status"],
                                            body["contract"], body.get("gates", {}), body.get("warnings", []),
                                            body.get("testRuns", []), body.get("artifacts", []))
                return self._send(200, {"buildId": bid})
            if u.path == "/api/admin/deprecations":
                self.store.add_deprecation(body["component"], body["subjectType"], body["subjectName"], body["since"], body.get("note"), body.get("removedIn"))
                return self._send(200, {"ok": True})
            if u.path == "/api/admin/breaking":
                self.store.add_breaking(body["component"], body["changeId"], body["kind"], body["version"], body.get("migrationDoc"))
                self.store.add_migration(body["component"], body["version"], body["sha"], body["migrationBody"])
                if body.get("removedIn"):
                    self.store.backfill_deprecation(body["component"], body["subjectType"], body["subjectName"], body["version"])
                return self._send(200, {"ok": True})
            if u.path == "/api/admin/retest":
                self.store.add_retest(body["component"], body["version"], body["cases"])
                self.store.mark_retest(body["component"], body["version"], body.get("results", {}))
                return self._send(200, {"ok": True})
            if u.path == "/api/admin/releases":
                r = self.store.release(body["component"], body["version"], body.get("channel", "latest"), body.get("retestResults"))
                return self._send(200, r)
            return self._send(404, {"error": "not found"})
        except PermissionError as e:
            return self._send(409, {"error": str(e)})
        except Exception as e:
            return self._send(400, {"error": str(e)})

    def do_PUT(self):
        u = urlparse(self.path)
        if not self._auth(): return self._send(401, {"error": "unauthorized"})
        try:
            if u.path == "/api/admin/artifacts":
                q = parse_qs(u.query)
                n = int(self.headers.get("Content-Length", 0)); data = self.rfile.read(n) if n else b""
                ok = self.store.write_artifact(int(q["buildId"][0]), q["kind"][0], q["name"][0], data,
                                               fail_rate=float(os.environ.get("ARTIFACT_FAIL_RATE", "0")))
                return self._send(200 if ok else 503, {"uploaded": ok, "name": q["name"][0]})
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(400, {"error": str(e)})

    def _serve_site(self, path):
        return self._serve_static(path, self.site_dir, SITE_HEADERS, default="index.html")

    def _serve_preview(self, name, q):
        # Preview pages are keyed by content hash, fetched from the content store,
        # and served with sandbox CSP + no cookies. They never share an origin
        # with the admin/login surface.
        name = name.strip("/")
        if not name or "/" in name or ".." in name: return self._send(400, {"error": "bad preview id"}, PREVIEW_HEADERS)
        candidates = list(self.store.storage.glob(f"*/{name}"))
        if not candidates: return self._send(404, {"error": "unknown or unpublished artifact"}, PREVIEW_HEADERS)
        data = candidates[0].read_bytes()
        return self._send(200, data, PREVIEW_HEADERS, ctype="text/html; charset=utf-8")

    def _serve_static(self, path, base: Path, extra, default=None):
        if not base or not base.exists(): return self._send(404, {"error": "site not built"})
        rel = path.lstrip("/")
        p = (base / rel).resolve() if rel else (base / default)
        if rel.endswith("/"): p = (base / rel / "index.html").resolve()
        if not str(p).startswith(str(base.resolve()) + os.sep) and p != base.resolve(): return self._send(403, {"error": "forbidden"})
        if (not p.exists() or p.is_dir()) and default: p = base / default
        if not p.exists() or p.is_dir(): return self._send(404, {"error": "not found"})
        ctype = "text/html; charset=utf-8" if p.suffix in (".html", "") else "application/javascript" if p.suffix == ".js" else "text/css" if p.suffix == ".css" else "application/octet-stream"
        return self._send(200, p.read_bytes(), extra, ctype=ctype)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="docs.db"); ap.add_argument("--storage", default="store")
    ap.add_argument("--site", default="dist"); ap.add_argument("--port", type=int, default=4173)
    ap.add_argument("--preview-port", type=int, default=4174)
    args = ap.parse_args()
    Handler.store = Store(args.db, args.storage)
    Handler.site_dir = Path(args.site).resolve()
    s1 = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    # Preview on a second origin (different port locally; separate domain in prod)
    s2 = ThreadingHTTPServer(("127.0.0.1", args.preview_port), Handler)
    print(f"site    http://127.0.0.1:{args.port}")
    print(f"preview http://127.0.0.1:{args.preview_port}  (sandboxed origin)")
    threading.Thread(target=s2.serve_forever, daemon=True).start()
    try: s1.serve_forever()
    except KeyboardInterrupt: pass

if __name__ == "__main__":
    main()
