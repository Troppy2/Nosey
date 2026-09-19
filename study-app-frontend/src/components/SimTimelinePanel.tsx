import type { SimEvent } from "../lib/sdHarness";

/**
 * One generic renderer for every concept's run. The learner's code decides what
 * to record through the sim module and this panel replays whatever arrives, so
 * a new concept needs no UI work at all.
 *
 * Everything here is plain DOM and plain text: payload values come from code the
 * learner wrote, so nothing is ever treated as markup.
 */

const MAX_VALUE_CHARS = 300;

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string): string {
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}...` : text;
}

function PayloadTable({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload);
  if (!entries.length) return null;
  return (
    <dl className="sd-timeline-payload">
      {entries.map(([key, value]) => (
        <div key={key} className="sd-timeline-pair">
          <dt>{key}</dt>
          <dd>{truncate(formatValue(value))}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function SimTimelinePanel({ events }: { events: SimEvent[] }) {
  if (!events.length) {
    return (
      <div className="sd-timeline sd-timeline--empty" data-testid="sd-timeline-empty">
        <p className="muted">
          Nothing was recorded on this run. Add sim.record("something", key=value) calls to your
          code and the timeline will replay them here.
        </p>
      </div>
    );
  }

  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);

  const snapshots = events.filter((event) => event.kind === "snapshot");
  const finalSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const { label: finalLabel, ...finalState } = (finalSnapshot?.payload ?? {}) as {
    label?: unknown;
  } & Record<string, unknown>;

  return (
    <div className="sd-timeline">
      <div className="sd-timeline-summary" data-testid="sd-timeline-summary">
        {[...counts.entries()].map(([kind, count]) => (
          <span
            key={kind}
            className="sd-timeline-count"
            data-testid="sd-timeline-count"
            data-count-for={kind}
            data-count={count}
          >
            {kind}
            <b>{count}</b>
          </span>
        ))}
      </div>

      {finalSnapshot ? (
        <div className="sd-timeline-final" data-testid="sd-timeline-final-snapshot">
          <div className="eyebrow">
            State at the end{typeof finalLabel === "string" ? `: ${finalLabel}` : ""}
          </div>
          <PayloadTable payload={finalState} />
        </div>
      ) : null}

      <ol className="sd-timeline-rows">
        {events.map((event, index) => {
          const isSnapshot = event.kind === "snapshot";
          const { label, ...rest } = event.payload as { label?: unknown } & Record<string, unknown>;
          return (
            <li
              key={`${event.t}-${index}`}
              className={`sd-timeline-row${isSnapshot ? " is-snapshot" : ""}`}
              data-testid="sd-timeline-row"
              data-kind={event.kind}
              data-snapshot={isSnapshot ? "true" : "false"}
            >
              <span className="sd-timeline-t">t{event.t}</span>
              <span className="sd-timeline-kind" data-testid="sd-timeline-kind">
                {event.kind}
              </span>
              {isSnapshot ? (
                <div className="sd-timeline-state">
                  <span
                    className="sd-timeline-snapshot-label"
                    data-testid="sd-timeline-snapshot-label"
                  >
                    {typeof label === "string" ? label : "state"}
                  </span>
                  <PayloadTable payload={rest} />
                </div>
              ) : (
                <PayloadTable payload={event.payload} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
