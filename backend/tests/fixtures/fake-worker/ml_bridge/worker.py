"""Stand-in for the real matching worker, for supervisor tests.

Speaks the same NDJSON protocol but loads nothing. When CRASH_MARKER names a
file that does not exist yet, the first process creates it, announces ready,
and then exits — simulating a crash — so the supervisor has to restart it.
"""
import json
import os
import sys
import time

marker = os.environ.get("CRASH_MARKER")
crash_after_ready = bool(marker) and not os.path.exists(marker)
if crash_after_ready:
    open(marker, "w").close()

sys.stdout.write(json.dumps({"event": "ready"}) + "\n")
sys.stdout.flush()

if crash_after_ready:
    time.sleep(0.1)
    sys.exit(1)

for line in sys.stdin:
    request = json.loads(line)
    sys.stdout.write(json.dumps({"id": request["id"], "ok": True, "result": {"count": 0}}) + "\n")
    sys.stdout.flush()
