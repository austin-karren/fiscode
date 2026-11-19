import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@fiscode/ui/components/empty";
import { Button } from "@fiscode/ui/components/button";
import { TriangleAlert } from "lucide-react";

// The router hands over whatever was thrown, which need not be an Error.
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : error == null ? "" : String(error);

export function ErrorEmpty({ error, reset }: { error: unknown; reset?: () => void }) {
  return (
    <Empty className="border-destructive/40">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>{messageOf(error) || "An unexpected error occurred."}</EmptyDescription>
      </EmptyHeader>
      {reset ? (
        <EmptyContent>
          <Button onClick={reset}>Try again</Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
