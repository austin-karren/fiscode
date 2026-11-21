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
          fiscode is local-only. After any meaningful change, use Back up everything and keep the
          file on a cloud drive or another device as off-device insurance. It holds your rows,
          history and document files. There is no built-in cloud integration by design.
        </p>
      </CardContent>
    </Card>
  );
}
