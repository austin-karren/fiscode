import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { SectionTitle } from "./section-title";

export function BackupNudge() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <SectionTitle>Back up your data</SectionTitle>
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
