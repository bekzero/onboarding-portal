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
    <html data-theme="light" lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var value=localStorage.getItem('kzero-color-theme');document.documentElement.dataset.theme=value==='dark'?'dark':'light'}catch(error){document.documentElement.dataset.theme='light'}})();`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
