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

export function ErrorEmpty({ error, reset }: { error: Error; reset?: () => void }) {
  return (
    <Empty className="border-destructive/40">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>{error.message || "An unexpected error occurred."}</EmptyDescription>
      </EmptyHeader>
      {reset ? (
        <EmptyContent>
          <Button onClick={reset}>Try again</Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
