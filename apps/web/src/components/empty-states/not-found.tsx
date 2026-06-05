import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@fiscode/ui/components/empty";
import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";

import { buttonVariants } from "@fiscode/ui/components/button";

export function NotFoundEmpty({ pathname }: { pathname?: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Compass />
        </EmptyMedia>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>
          {pathname ? (
            <>
              We couldn't find <code className="font-mono">{pathname}</code>. Check the URL, or head
              back home.
            </>
          ) : (
            <>We couldn't find that page. Check the URL, or head back home.</>
          )}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link to="/" className={buttonVariants()}>
          Go home
        </Link>
      </EmptyContent>
    </Empty>
  );
}
