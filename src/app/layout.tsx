import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SessionProvider } from "@/components/providers/session-provider";
import { Toaster } from "sonner";

// The fonts ship with the code (src/app/fonts, SIL OFL 1.1, licences beside them): the build fetches nothing,
// which a builder in Iran could not do from Google Fonts. They are Google Fonts' own files (Vazirmatn 33.003,
// Space Mono 1.003, from github.com/google/fonts), whole rather than split by script, so every glyph is the one
// next/font/google served.
const vazirmatn = localFont({
  src: "./fonts/Vazirmatn-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-vazirmatn",
});

// Order numbers, SKUs, codes and Latin model names (design system §03).
const spaceMono = localFont({
  src: [
    { path: "./fonts/SpaceMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/SpaceMono-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "TheMoak ERP",
  description: "Enterprise Resource Planning for TheMoak",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          vazirmatn.variable,
          spaceMono.variable
        )}
        suppressHydrationWarning
      >
        <SessionProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <Toaster position="top-center" richColors />
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
