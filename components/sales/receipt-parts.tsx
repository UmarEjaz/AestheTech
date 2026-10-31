import type { ReactElement } from "react";

// Small presentational pieces shared by the on-screen receipt layouts (sale receipt slip/document and
// the single-payment receipt).

/** A label on the left, a value on the right. */
export function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex justify-between gap-2">
      <span className="opacity-80">{label}</span>
      <span className="whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

/** Inline "LABEL value" pair used in the document layout's meta block. */
export function DocMeta({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">{label} </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/** Dashed rule for the thermal slip; a light solid rule when `doc` is set (A5/A4 document). */
export function Divider({ doc }: { doc?: boolean }): ReactElement {
  return <div className={doc ? "my-3 border-t border-neutral-300" : "my-2 border-t border-dashed border-black"} />;
}
