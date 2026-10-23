import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
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
    <html data-theme="dark" lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var value=localStorage.getItem('kzero-color-theme');document.documentElement.dataset.theme=value==='light'?'light':'dark'}catch(error){document.documentElement.dataset.theme='dark'}})();`
          }}
        />
      </head>
      <body>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
