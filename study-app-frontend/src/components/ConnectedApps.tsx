import { Copy, Link2Off } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./Button";
import { CollapsibleSection } from "./CollapsibleSection";
import { SkeletonList } from "./Skeletons";
import { API_BASE_URL, fetchMcpConnections, revokeMcpConnection } from "../lib/api";
import { toast } from "../lib/toast";
import type { McpConnection } from "../lib/types";

// The URL people paste into Claude or ChatGPT as a custom connector.
const CONNECTOR_URL = `${API_BASE_URL.replace(/\/$/, "")}/mcp`;

// Server timestamps are naive UTC ("2026-10-14T12:00:00"); without a zone,
// Date would read them as local time.
function parseUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
}

function formatDay(value: string): string {
  return parseUtc(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatAgo(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - parseUtc(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Settings > Connected apps: apps (Claude, ChatGPT) the user let into their
// library through the MCP connector, with a Disconnect per app. Disconnecting
// revokes that app's tokens on the next call; connecting again is one click
// from the app. Signed-in accounts only, like the connector itself.
export function ConnectedApps() {
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setConnections(await fetchMcpConnections());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load connected apps.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function disconnect(connection: McpConnection) {
    setRevokingId(connection.id);
    try {
      await revokeMcpConnection(connection.id);
      setConnections((prev) => prev.filter((c) => c.id !== connection.id));
      toast.success(`${connection.client_name} disconnected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disconnect this app.");
    } finally {
      setRevokingId(null);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(CONNECTOR_URL);
      toast.success("Connector link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  }

  return (
    <div data-tour="connected-apps">
      <CollapsibleSection title="Connected apps">
        <p className="muted small">
          Let Claude or ChatGPT build tests, flashcards and lessons in your library. Add this link as a custom
          connector in the app, then sign in and allow it.
        </p>
        <div className="connected-apps-url">
          <code>{CONNECTOR_URL}</code>
          <Button type="button" variant="secondary" icon={<Copy size={16} />} onClick={() => void copyUrl()}>
            Copy
          </Button>
        </div>

        {error ? (
          <p className="muted small">{error}</p>
        ) : loading ? (
          <SkeletonList rows={1} label="Loading connected apps" />
        ) : connections.length === 0 ? (
          <p className="muted small">No apps connected.</p>
        ) : (
          <div className="settings-restore-list">
            {connections.map((connection) => (
              <div className="settings-restore-item" key={connection.id}>
                <div>
                  <p className="settings-restore-folder">{connection.client_name}</p>
                  <p className="muted small">
                    Connected {formatDay(connection.connected_at)}
                    {connection.last_used_at ? ` · Last used ${formatAgo(connection.last_used_at)}` : " · Not used yet"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="danger-outline"
                  icon={<Link2Off size={16} />}
                  onClick={() => void disconnect(connection)}
                  disabled={revokingId === connection.id}
                >
                  {revokingId === connection.id ? "Disconnecting…" : "Disconnect"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
