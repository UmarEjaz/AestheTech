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
  "appointments:cancel": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.RECEPTIONIST],
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
  "schedules:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "schedules:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "schedules:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Reports
  "reports:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "reports:financial": [SYSTEM_ROLES.OWNER],

  // Settings
  "settings:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "settings:manage": [SYSTEM_ROLES.OWNER],
  "roles:manage": [SYSTEM_ROLES.OWNER],
  "permissions:manage": [SYSTEM_ROLES.OWNER],

  // Services
  "services:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "services:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "services:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "services:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Service Categories
  "service-categories:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "service-categories:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "service-categories:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "service-categories:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Products
  "products:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST],
  "products:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "products:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "products:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Product Categories
  "product-categories:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "product-categories:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "product-categories:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "product-categories:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Loyalty
  "loyalty:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.RECEPTIONIST],
  "loyalty:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "loyalty:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "loyalty:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Branches
  "branches:view": [SYSTEM_ROLES.OWNER],
  "branches:create": [SYSTEM_ROLES.OWNER],
  "branches:update": [SYSTEM_ROLES.OWNER],
  "branches:delete": [SYSTEM_ROLES.OWNER],

  // Expenses
  "expenses:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expenses:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expenses:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expenses:delete": [SYSTEM_ROLES.OWNER],

  // Expense Categories
  "expense-categories:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expense-categories:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expense-categories:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "expense-categories:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Payroll
  "payroll:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "payroll:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "payroll:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "payroll:cancel": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "payroll:pay": [SYSTEM_ROLES.OWNER],
  "payroll:delete": [SYSTEM_ROLES.OWNER],
  "salary-config:view": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "salary-config:create": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "salary-config:update": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],
  "salary-config:delete": [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN],

  // Profit & Cost Analytics
  "profit:view": [SYSTEM_ROLES.OWNER],

  // Audit
  "audit:view": [SYSTEM_ROLES.OWNER],

  // Data Access (cross-branch viewing)
  "data:all-branches": [SYSTEM_ROLES.OWNER],
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
  { code: "appointments:cancel", module: "appointments", label: "Cancel Appointments", description: "Cancel scheduled appointments", sortOrder: 3 },
  { code: "appointments:delete", module: "appointments", label: "Delete Appointments", sortOrder: 4 },

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
  { code: "schedules:create", module: "schedules", label: "Create Schedules", sortOrder: 1 },
  { code: "schedules:update", module: "schedules", label: "Update Schedules", sortOrder: 2 },
  { code: "schedules:delete", module: "schedules", label: "Delete Schedules", sortOrder: 3 },

  // Reports
  { code: "reports:view", module: "reports", label: "View Reports", sortOrder: 0 },
  { code: "reports:financial", module: "reports", label: "View Financial Reports", sortOrder: 1 },

  // Settings
  { code: "settings:view", module: "settings", label: "View Settings", sortOrder: 0 },
  { code: "settings:manage", module: "settings", label: "Manage Settings", sortOrder: 1 },
  { code: "roles:manage", module: "settings", label: "Manage Roles", description: "Create, edit, and delete custom roles", sortOrder: 2 },
  { code: "permissions:manage", module: "settings", label: "Manage Permissions", description: "Edit role permissions and user-level overrides", sortOrder: 3 },

  // Services
  { code: "services:view", module: "services", label: "View Services", sortOrder: 0 },
  { code: "services:create", module: "services", label: "Create Services", sortOrder: 1 },
  { code: "services:update", module: "services", label: "Update Services", sortOrder: 2 },
  { code: "services:delete", module: "services", label: "Delete Services", sortOrder: 3 },

  // Service Categories
  { code: "service-categories:view", module: "service-categories", label: "View Service Categories", sortOrder: 0 },
  { code: "service-categories:create", module: "service-categories", label: "Create Service Categories", sortOrder: 1 },
  { code: "service-categories:update", module: "service-categories", label: "Update Service Categories", sortOrder: 2 },
  { code: "service-categories:delete", module: "service-categories", label: "Delete Service Categories", sortOrder: 3 },

  // Products
  { code: "products:view", module: "products", label: "View Products", sortOrder: 0 },
  { code: "products:create", module: "products", label: "Create Products", sortOrder: 1 },
  { code: "products:update", module: "products", label: "Update Products", sortOrder: 2 },
  { code: "products:delete", module: "products", label: "Delete Products", sortOrder: 3 },

  // Product Categories
  { code: "product-categories:view", module: "product-categories", label: "View Product Categories", sortOrder: 0 },
  { code: "product-categories:create", module: "product-categories", label: "Create Product Categories", sortOrder: 1 },
  { code: "product-categories:update", module: "product-categories", label: "Update Product Categories", sortOrder: 2 },
  { code: "product-categories:delete", module: "product-categories", label: "Delete Product Categories", sortOrder: 3 },

  // Loyalty
  { code: "loyalty:view", module: "loyalty", label: "View Loyalty", sortOrder: 0 },
  { code: "loyalty:create", module: "loyalty", label: "Create Loyalty Rules", sortOrder: 1 },
  { code: "loyalty:update", module: "loyalty", label: "Update Loyalty Rules", sortOrder: 2 },
  { code: "loyalty:delete", module: "loyalty", label: "Delete Loyalty Rules", sortOrder: 3 },

  // Branches
  { code: "branches:view", module: "branches", label: "View Branches", sortOrder: 0 },
  { code: "branches:create", module: "branches", label: "Create Branches", sortOrder: 1 },
  { code: "branches:update", module: "branches", label: "Update Branches", sortOrder: 2 },
  { code: "branches:delete", module: "branches", label: "Delete Branches", sortOrder: 3 },

  // Expenses
  { code: "expenses:view", module: "expenses", label: "View Expenses", sortOrder: 0 },
  { code: "expenses:create", module: "expenses", label: "Create Expenses", sortOrder: 1 },
  { code: "expenses:update", module: "expenses", label: "Update Expenses", sortOrder: 2 },
  { code: "expenses:delete", module: "expenses", label: "Delete Expenses", sortOrder: 3 },

  // Expense Categories
  { code: "expense-categories:view", module: "expense-categories", label: "View Expense Categories", sortOrder: 0 },
  { code: "expense-categories:create", module: "expense-categories", label: "Create Expense Categories", sortOrder: 1 },
  { code: "expense-categories:update", module: "expense-categories", label: "Update Expense Categories", sortOrder: 2 },
  { code: "expense-categories:delete", module: "expense-categories", label: "Delete Expense Categories", sortOrder: 3 },

  // Payroll
  { code: "payroll:view", module: "payroll", label: "View Payroll", sortOrder: 0 },
  { code: "payroll:create", module: "payroll", label: "Create Payroll", sortOrder: 1 },
  { code: "payroll:update", module: "payroll", label: "Update Payroll", sortOrder: 2 },
  { code: "payroll:cancel", module: "payroll", label: "Cancel Payroll Runs", description: "Cancel a payroll run (preserves record for audit; does not delete data)", sortOrder: 3 },
  { code: "payroll:pay", module: "payroll", label: "Process Payroll Payment", sortOrder: 4 },
  { code: "payroll:delete", module: "payroll", label: "Delete Payroll", sortOrder: 5 },
  { code: "salary-config:view", module: "payroll", label: "View Salary Config", sortOrder: 5 },
  { code: "salary-config:create", module: "payroll", label: "Create Salary Config", sortOrder: 6 },
  { code: "salary-config:update", module: "payroll", label: "Update Salary Config", sortOrder: 7 },
  { code: "salary-config:delete", module: "payroll", label: "Delete Salary Config", sortOrder: 8 },

  // Profit & Cost Analytics
  { code: "profit:view", module: "profit", label: "View Profit Analytics", sortOrder: 0 },

  // Audit
  { code: "audit:view", module: "audit", label: "View Audit Log", sortOrder: 0 },

  // Data Access (cross-branch viewing)
  { code: "data:all-branches", module: "data", label: "View Data Across All Branches", description: "Access combined data from all branches (dashboard, reports, audit logs, payroll, expenses). Without this, users only see data from their current branch.", sortOrder: 0 },
];

/** The slug of the owner system role, used for owner-specific checks */
export const OWNER_ROLE_SLUG = SYSTEM_ROLES.OWNER;

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
  "service-categories": "Service Categories",
  products: "Products",
  "product-categories": "Product Categories",
  loyalty: "Loyalty Program",
  branches: "Branches",
  expenses: "Expenses",
  "expense-categories": "Expense Categories",
  payroll: "Payroll & Salary",
  profit: "Profit Analytics",
  audit: "Audit Log",
  data: "Data Access",
};
