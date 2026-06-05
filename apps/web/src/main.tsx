import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { boot } from "@fiscode/db";

import { router } from "./router";

// Boot the local DB before rendering so route loaders can read synchronously.
// Local SQLocal boot is fast (~50ms); we deliberately do not show a spinner.
boot().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
});
