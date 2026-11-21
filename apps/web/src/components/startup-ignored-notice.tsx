import { Alert, AlertDescription } from "@fiscode/ui/components/alert";
import { Link } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";

// Equipment ticked Startup (d-data #75, derived.startupIgnoredForEquipment): §195 excludes
// depreciable property, so the tick is ignored and the equipment is deducted when placed in
// service. One line, like the §179 notice; on the dashboard and the year-end packet.
export function StartupIgnoredNotice({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <Alert className="print:break-inside-avoid">
      <CircleAlert />
      <AlertDescription>
        {count === 1 ? "1 equipment expense is" : `${count} equipment expenses are`} ticked Startup.
        Equipment isn't a startup cost; it's deducted when placed in service, so the tick is
        ignored. See <Link to="/expenses">Expenses</Link>.
      </AlertDescription>
    </Alert>
  );
}
