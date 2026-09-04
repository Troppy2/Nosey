import { Spinner } from "./Loaders";
import "../styles/components/pull-refresh.css";

/**
 * The visual half of usePullToRefresh: renders nothing until a drag or a
 * refresh is in progress. Place once near the top of a page that calls the
 * hook, above its content.
 */
export function PullToRefreshIndicator({ pullPx, isRefreshing }: { pullPx: number; isRefreshing: boolean }) {
  if (pullPx <= 0 && !isRefreshing) return null;
  const height = isRefreshing ? 44 : Math.min(pullPx, 70);
  return (
    <div className="pull-refresh" style={{ height }} aria-hidden={!isRefreshing}>
      <Spinner size="sm" label={isRefreshing ? "Refreshing" : "Pull to refresh"} />
    </div>
  );
}

export default PullToRefreshIndicator;
