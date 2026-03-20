import { fetchSportsTopTraders } from "../../lib/polymarket";
import { CopyTradingPanel } from "./CopyTradingPanel";

export const revalidate = 60;

export default async function CopyTradingPage() {
  const traders = await fetchSportsTopTraders(50);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-white">Copy trading</h1>
      <p className="text-xs text-slate-400">
        Select traders from the top trader list and live slugs to copy. Start/stop the bot and place
        manual buy/sell in selected slugs. When a slug finishes you get a notification; when all
        finish, the bot stops and you can change options.
      </p>
      <CopyTradingPanel initialTraders={traders} />
    </div>
  );
}
