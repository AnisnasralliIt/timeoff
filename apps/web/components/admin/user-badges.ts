export function roleBadgeVariant(role: string) {
  switch (role) {
    case "SUPER_ADMIN":
      return "danger" as const;
    case "HR":
      return "warning" as const;
    case "ADMIN":
      return "info" as const;
    case "MANAGER":
      return "success" as const;
    case "EXECUTIVE":
      return "neutral" as const;
    default:
      return "neutral" as const;
  }
}
