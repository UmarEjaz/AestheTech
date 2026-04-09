import { SYSTEM_ROLES } from "@/lib/roles";

/**
 * Default permission-to-role mapping.
 * Used for:
 * 1. Seeding new salons with default permissions
 * 2. Fallback when a salon has no DB permission records yet
 * 3. "Reset to Defaults" feature in the permissions UI
 */
export const DEFAULT_PERMISSION_ROLES: Record<string, string[]> = {
  // Client Management
  "clients:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "clients:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.RECEPTIONIST],
  "clients:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.RECEPTIONIST],
  "clients:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Appointments
  "appointments:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "appointments:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.RECEPTIONIST],
  "appointments:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.RECEPTIONIST],
  "appointments:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Sales
  "sales:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "sales:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "sales:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "sales:delete": [SYSTEM_ROLES.OWNER],

  // Invoices
  "invoices:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "invoices:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.RECEPTIONIST],
  "invoices:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "invoices:delete": [SYSTEM_ROLES.OWNER],
  "invoices:refund": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Staff Management
  "staff:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.RECEPTIONIST],
  "staff:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "staff:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "staff:delete": [SYSTEM_ROLES.OWNER],

  // Schedules
  "schedules:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "schedules:manage": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Reports
  "reports:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "reports:financial": [SYSTEM_ROLES.OWNER],

  // Settings
  "settings:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "settings:manage": [SYSTEM_ROLES.OWNER],

  // Services
  "services:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "services:manage": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Products
  "products:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "products:manage": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Loyalty
  "loyalty:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.RECEPTIONIST],
  "loyalty:manage": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Branches
  "branches:view": [SYSTEM_ROLES.OWNER],
  "branches:manage": [SYSTEM_ROLES.OWNER],

  // Expenses
  "expenses:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expenses:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expenses:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expenses:delete": [SYSTEM_ROLES.OWNER],

  // Expense Categories
  "expense-categories:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expense-categories:manage": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Payroll
  "payroll:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "payroll:manage": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "payroll:pay": [SYSTEM_ROLES.OWNER],
  "payroll:delete": [SYSTEM_ROLES.OWNER],
  "salary-config:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "salary-config:manage": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Profit & Cost Analytics
  "profit:view": [SYSTEM_ROLES.OWNER],

  // Audit
  "audit:view": [SYSTEM_ROLES.OWNER],
};

/**
 * Permission registry — defines all permissions with metadata for the UI.
 * This is the source of truth for seeding the `permissions` table.
 */
export const PERMISSION_REGISTRY: Array<{
  code: string;
  module: string;
  label: string;
  description?: string;
  sortOrder: number;
}> = [
  // Client Management
  { code: "clients:view", module: "clients", label: "View Clients", sortOrder: 0 },
  { code: "clients:create", module: "clients", label: "Create Clients", sortOrder: 1 },
  { code: "clients:update", module: "clients", label: "Update Clients", sortOrder: 2 },
  { code: "clients:delete", module: "clients", label: "Delete Clients", sortOrder: 3 },

  // Appointments
  { code: "appointments:view", module: "appointments", label: "View Appointments", sortOrder: 0 },
  { code: "appointments:create", module: "appointments", label: "Create Appointments", sortOrder: 1 },
  { code: "appointments:update", module: "appointments", label: "Update Appointments", sortOrder: 2 },
  { code: "appointments:delete", module: "appointments", label: "Delete Appointments", sortOrder: 3 },

  // Sales
  { code: "sales:view", module: "sales", label: "View Sales", sortOrder: 0 },
  { code: "sales:create", module: "sales", label: "Create Sales", sortOrder: 1 },
  { code: "sales:update", module: "sales", label: "Update Sales", sortOrder: 2 },
  { code: "sales:delete", module: "sales", label: "Delete Sales", sortOrder: 3 },

  // Invoices
  { code: "invoices:view", module: "invoices", label: "View Invoices", sortOrder: 0 },
  { code: "invoices:create", module: "invoices", label: "Create Invoices", sortOrder: 1 },
  { code: "invoices:update", module: "invoices", label: "Update Invoices", sortOrder: 2 },
  { code: "invoices:delete", module: "invoices", label: "Delete Invoices", sortOrder: 3 },
  { code: "invoices:refund", module: "invoices", label: "Issue Refunds", sortOrder: 4 },

  // Staff Management
  { code: "staff:view", module: "staff", label: "View Staff", sortOrder: 0 },
  { code: "staff:create", module: "staff", label: "Create Staff", sortOrder: 1 },
  { code: "staff:update", module: "staff", label: "Update Staff", sortOrder: 2 },
  { code: "staff:delete", module: "staff", label: "Delete Staff", sortOrder: 3 },

  // Schedules
  { code: "schedules:view", module: "schedules", label: "View Schedules", sortOrder: 0 },
  { code: "schedules:manage", module: "schedules", label: "Manage Schedules", sortOrder: 1 },

  // Reports
  { code: "reports:view", module: "reports", label: "View Reports", sortOrder: 0 },
  { code: "reports:financial", module: "reports", label: "View Financial Reports", sortOrder: 1 },

  // Settings
  { code: "settings:view", module: "settings", label: "View Settings", sortOrder: 0 },
  { code: "settings:manage", module: "settings", label: "Manage Settings", sortOrder: 1 },

  // Services
  { code: "services:view", module: "services", label: "View Services", sortOrder: 0 },
  { code: "services:manage", module: "services", label: "Manage Services", sortOrder: 1 },

  // Products
  { code: "products:view", module: "products", label: "View Products", sortOrder: 0 },
  { code: "products:manage", module: "products", label: "Manage Products", sortOrder: 1 },

  // Loyalty
  { code: "loyalty:view", module: "loyalty", label: "View Loyalty", sortOrder: 0 },
  { code: "loyalty:manage", module: "loyalty", label: "Manage Loyalty", sortOrder: 1 },

  // Branches
  { code: "branches:view", module: "branches", label: "View Branches", sortOrder: 0 },
  { code: "branches:manage", module: "branches", label: "Manage Branches", sortOrder: 1 },

  // Expenses
  { code: "expenses:view", module: "expenses", label: "View Expenses", sortOrder: 0 },
  { code: "expenses:create", module: "expenses", label: "Create Expenses", sortOrder: 1 },
  { code: "expenses:update", module: "expenses", label: "Update Expenses", sortOrder: 2 },
  { code: "expenses:delete", module: "expenses", label: "Delete Expenses", sortOrder: 3 },

  // Expense Categories
  { code: "expense-categories:view", module: "expense-categories", label: "View Expense Categories", sortOrder: 0 },
  { code: "expense-categories:manage", module: "expense-categories", label: "Manage Expense Categories", sortOrder: 1 },

  // Payroll
  { code: "payroll:view", module: "payroll", label: "View Payroll", sortOrder: 0 },
  { code: "payroll:manage", module: "payroll", label: "Manage Payroll", sortOrder: 1 },
  { code: "payroll:pay", module: "payroll", label: "Process Payroll Payment", sortOrder: 2 },
  { code: "payroll:delete", module: "payroll", label: "Delete Payroll", sortOrder: 3 },
  { code: "salary-config:view", module: "payroll", label: "View Salary Config", sortOrder: 4 },
  { code: "salary-config:manage", module: "payroll", label: "Manage Salary Config", sortOrder: 5 },

  // Profit & Cost Analytics
  { code: "profit:view", module: "profit", label: "View Profit Analytics", sortOrder: 0 },

  // Audit
  { code: "audit:view", module: "audit", label: "View Audit Log", sortOrder: 0 },
];

/** The role name used for owner lockout checks */
export const OWNER_ROLE_NAME = SYSTEM_ROLES.OWNER;

/**
 * Permissions that OWNER role can never lose (lockout protection).
 * These checkboxes are disabled in the UI and enforced server-side.
 */
export const OWNER_LOCKED_PERMISSIONS = [
  "settings:manage",
  "settings:view",
  "staff:view",
  "staff:create",
  "staff:update",
  "staff:delete",
  "branches:view",
  "branches:manage",
];

/**
 * Human-readable module labels for the permissions UI.
 */
export const MODULE_LABELS: Record<string, string> = {
  clients: "Client Management",
  appointments: "Appointments",
  sales: "Sales",
  invoices: "Invoices",
  staff: "Staff Management",
  schedules: "Schedules",
  reports: "Reports",
  settings: "Settings",
  services: "Services",
  products: "Products",
  loyalty: "Loyalty Program",
  branches: "Branches",
  expenses: "Expenses",
  "expense-categories": "Expense Categories",
  payroll: "Payroll & Salary",
  profit: "Profit Analytics",
  audit: "Audit Log",
};
