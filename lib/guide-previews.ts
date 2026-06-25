export type TaskGuide = {
  href: string;
  title: string;
};

export type GuidePreviewResult = {
  headings: string[];
  images: string[];
  intro: string | null;
  kind: "article" | "collection" | "unavailable";
  message?: string;
  steps: string[];
  title: string;
  url: string;
};

export function getTaskGuides(title: string): TaskGuide[] {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("add backup administrator")) {
    return [
      {
        title: "Create a New Dashboard Administrator",
        href: "https://partners.kzero.com/library/admin-guides/admin-dashboard-management/dashboard-administration-creating-a-new-administrator-in-the-dashboard"
      }
    ];
  }

  if (normalizedTitle.includes("add employees and contractors")) {
    return [
      {
        title: "Individually Add Users to a Tenant",
        href: "https://partners.kzero.com/library/admin-guides/admin-dashboard-management/dashboard-administration-individually-adding-users-to-a-tenant"
      }
    ];
  }

  if (normalizedTitle.includes("share vault") || normalizedTitle.includes("browser extension guidance")) {
    return [
      {
        title: "Vault Password Import Guides",
        href: "https://partners.kzero.com/library/kzero-passwordless-biometric-vault/importing-passwords"
      },
      {
        title: "Vault and Extension End-User Guides",
        href: "https://partners.kzero.com/library/kzero-passwordless-biometric-vault/end-user-guides"
      }
    ];
  }

  return [];
}
