import type { ReactElement, ReactNode } from "react";

// Test stand-in for @react-pdf/renderer: a real PDF can't be searched for text, so content tests render
// the PDF's building blocks as plain HTML instead. Use with
// `vi.mock("@react-pdf/renderer", async () => (await import("@/components/pdf-html-mock")).pdfHtmlMock)`.
function Box({ children }: { children?: ReactNode }): ReactElement {
  return <div>{children}</div>;
}

export const pdfHtmlMock = {
  Document: Box,
  Page: Box,
  View: Box,
  Text: ({ children }: { children?: ReactNode }): ReactElement => <span>{children}</span>,
  Image: (): null => null,
  StyleSheet: { create: <T,>(styles: T): T => styles },
};
