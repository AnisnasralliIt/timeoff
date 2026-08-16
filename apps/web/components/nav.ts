import {
  Bell,
  LayoutDashboard,
  CalendarDays,
  Inbox,
  ClipboardCheck,
  Settings,
  Users,
  Palette,
  History,
  Clock,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  /** Message key under `nav.items`. */
  labelKey: string;
  href: string;
  icon: LucideIcon;
  /** Role-gated; `undefined` means visible to all authenticated users. */
  minRole?: "approver" | "insights" | "people-ops" | "super-admin" | "audit";
  badge?: number;
  /** Feature-gated; hidden unless the company enabled the module. */
  featureFlag?: "authorisations";
};

export type NavSection = {
  /** Message key under `nav.sections`. */
  titleKey: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    titleKey: "workspace",
    items: [
      { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
      { labelKey: "requests", href: "/requests", icon: Inbox },
      { labelKey: "authorisations", href: "/authorisations", icon: Clock, featureFlag: "authorisations" },
      { labelKey: "calendar", href: "/calendar", icon: CalendarDays },
      { labelKey: "approvals", href: "/approvals", icon: ClipboardCheck, minRole: "approver" },
      { labelKey: "notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    titleKey: "insights",
    items: [
      { labelKey: "workforce", href: "/workforce", icon: Users, minRole: "insights" },
    ],
  },
  {
    titleKey: "manage",
    items: [
      { labelKey: "admin", href: "/admin", icon: Settings, minRole: "people-ops" },
      { labelKey: "auditLog", href: "/admin/audit-log", icon: History, minRole: "audit" },
      { labelKey: "styleGuide", href: "/style-guide", icon: Palette, minRole: "super-admin" },
    ],
  },
];
