import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@fiscode/ui/components/empty";
import { Link } from "@tanstack/react-router";
import { Rocket } from "lucide-react";

import { buttonVariants } from "@fiscode/ui/components/button";

export function SetupRequiredEmpty() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Rocket />
        </EmptyMedia>
        <EmptyTitle>Set up fiscode first</EmptyTitle>
        <EmptyDescription>
          Capture filing status, state of residence, and self-employment start date before using the
          rest of the app.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link to="/setup" className={buttonVariants()}>
          Run setup
        </Link>
      </EmptyContent>
    </Empty>
  );
}
