"""Instrumentation the learner's from-scratch code calls so the timeline panel
can replay what happened. The panel is generic: it renders whatever events
arrive, so a concept adds a new kind of event without any UI work.

Pure standard library, no imports, no clock. Time is the caller's: tick() moves
a logical counter so a run is deterministic and a test never sleeps.
"""
_EVENTS = []
_CLOCK = [0]


def reset():
    """Clear the buffer. The JS harness calls this before every run."""
    _EVENTS.clear()
    _CLOCK[0] = 0


def tick(n=1):
    """Advance logical time by n steps."""
    _CLOCK[0] += n


def now():
    """The current logical time."""
    return _CLOCK[0]


def record(kind, **payload):
    """Log one thing that happened, e.g. sim.record("cache_hit", key="a")."""
    _EVENTS.append({"t": _CLOCK[0], "kind": str(kind), "payload": dict(payload)})


def snapshot(label, **state):
    """Log the state of the system at this moment, rendered as a state block."""
    _EVENTS.append({"t": _CLOCK[0], "kind": "snapshot", "payload": {"label": label, **state}})


def events():
    return list(_EVENTS)
