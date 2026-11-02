import type { ReportItem } from "@/lib/report-adjustments";

// Shared report fixture: one $100 haircut by Emma Wilson, as the reports' adjustment loader returns it.
export const haircut: ReportItem = {
  id: "i1",
  price: 100,
  quantity: 1,
  costAtSale: null,
  productId: null,
  serviceId: "s1",
  staffId: "u1",
  service: { id: "s1", name: "Haircut" },
  product: null,
  staff: { id: "u1", firstName: "Emma", lastName: "Wilson" },
};
