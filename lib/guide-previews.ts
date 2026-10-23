export type TaskGuide = {
  description?: string;
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

export function getGuideAccessLabel(guideCount: number) {
  if (guideCount < 1) {
    return null;
  }

  return guideCount === 1 ? "View Guide" : `View Guides (${guideCount})`;
}

export function getTaskGuides(title: string): TaskGuide[] {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("add backup administrator")) {
    return [
      {
        description: "Steps for creating an additional administrator in the KZero Passwordless Dashboard.",
        title: "Create a New Dashboard Administrator",
        href: "https://partners.kzero.com/library/admin-guides/admin-dashboard-management/dashboard-administration-creating-a-new-administrator-in-the-dashboard"
      }
    ];
  }

  if (normalizedTitle.includes("add employees and contractors")) {
    return [
      {
        description: "Steps for adding users individually to a KZero Passwordless tenant.",
        title: "Individually Add Users to a Tenant",
        href: "https://partners.kzero.com/library/admin-guides/admin-dashboard-management/dashboard-administration-individually-adding-users-to-a-tenant"
      }
    ];
  }

  if (normalizedTitle.includes("import your passwords")) {
    return [
      {
        description: "A collection of password import guides for supported sources.",
        title: "Vault Password Import Guides",
        href: "https://partners.kzero.com/library/kzero-passwordless-biometric-vault/importing-passwords"
      }
    ];
  }

  if (normalizedTitle.includes("share vault") || normalizedTitle.includes("browser extension guidance")) {
    return [
      {
        description: "A collection of password import guides for supported sources.",
        title: "Vault Password Import Guides",
        href: "https://partners.kzero.com/library/kzero-passwordless-biometric-vault/importing-passwords"
      },
      {
        description: "A collection of KZero Passwordless Vault and browser extension guidance for end users.",
        title: "Vault and Extension End-User Guides",
        href: "https://partners.kzero.com/library/kzero-passwordless-biometric-vault/end-user-guides"
      }
    ];
  }

  return [];
}
