import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KZero Onboarding Portal",
  description: "Passwordless onboarding portal for MSPs and KZero teams."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
