// Test setup shared by all Vitest runs.
// - jest-dom adds DOM matchers (toBeInTheDocument, toBeDisabled, …) for component tests.
// - cleanup() unmounts anything a jsdom component test rendered, between tests.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  // No-op for pure node tests (nothing was rendered); unmounts components in jsdom tests.
  cleanup();
});
