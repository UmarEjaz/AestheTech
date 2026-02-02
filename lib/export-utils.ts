/**
 * Export utilities for generating CSV and triggering downloads
 */

export interface ExportColumn<T> {
  header: string;
  accessor: keyof T | ((row: T) => string | number);
}

/**
 * Convert data array to CSV string
 */
export function toCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[]
): string {
  if (data.length === 0) return "";

  // Header row
  const headers = columns.map((col) => `"${col.header}"`).join(",");

  // Data rows
  const rows = data.map((row) => {
    return columns
      .map((col) => {
        const value =
          typeof col.accessor === "function"
            ? col.accessor(row)
            : row[col.accessor];
        // Escape quotes and wrap in quotes
        const stringValue = String(value ?? "").replace(/"/g, '""');
        return `"${stringValue}"`;
      })
      .join(",");
  });

  return [headers, ...rows].join("\n");
}

/**
 * Trigger download of a file
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Download data as CSV file
 */
export function downloadCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[],
  filename: string
): void {
  const csv = toCSV(data, columns);
  downloadFile(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
}

/**
 * Format currency for export
 */
export function formatCurrencyForExport(value: number, symbol: string): string {
  return `${symbol}${value.toFixed(2)}`;
}
