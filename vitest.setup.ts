// Test setup shared by all Vitest runs.
// - jest-dom adds DOM matchers (toBeInTheDocument, toBeDisabled, …) for component tests.
// - cleanup() unmounts anything a jsdom component test rendered, between tests.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't implement Pointer Capture; install a one-time no-op so pointer-drag component tests
// can run. (Guarded for the node env, where HTMLElement is undefined.)
if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
}

afterEach(() => {
  // No-op for pure node tests (nothing was rendered); unmounts components in jsdom tests.
  cleanup();
});
