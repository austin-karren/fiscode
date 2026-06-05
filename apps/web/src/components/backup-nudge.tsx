import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";

export function BackupNudge() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
          Backup nudge
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          fiscode is local-only. After any meaningful change, download the latest CSV and upload it
          to a cloud drive as off-device insurance. There is no built-in cloud integration by
          design.
        </p>
      </CardContent>
    </Card>
  );
}
