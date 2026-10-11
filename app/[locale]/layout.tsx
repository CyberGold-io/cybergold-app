import type { Metadata } from "next";
import localFont from "next/font/local";
import "../globals.css";
import "../fonts/ibm-plex-sans/subsets.css";
import { Footer } from ".././components/footer";
import { Navbar } from ".././components/navbar";
import { Web3Providers } from ".././providers";
import { DEFAULT_THEME, THEME_PREFERENCE_KEY, parseTheme } from "../lib/theme";
import {NextIntlClientProvider} from 'next-intl';
import {getLocale, getMessages} from 'next-intl/server';
import { cookies } from "next/headers";

const ibmPlexSans = localFont({
  src: "../fonts/ibm-plex-sans/latin.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-ibm-plex-sans",
  declarations: [
    // Share the family with the demand-loaded subsets without preloading them.
    { prop: "font-family", value: "IBM Plex Sans" },
    {
      prop: "unicode-range",
      value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

export const metadata: Metadata = {
  title: "CyberGold",
  description: "A platform for digital gold trading",
  icons: {
    icon: {
      url: "/favicon.png",
      type: "image/png",
    },
    shortcut: "/favicon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  await getMessages();
  const cookieStore = await cookies();
  const cookie = cookieStore.toString();
  const initialTheme =
    parseTheme(cookieStore.get(THEME_PREFERENCE_KEY)?.value) ?? DEFAULT_THEME;

  return (
    <html lang={locale} className={initialTheme === "dark" ? "dark" : ""}>
      <body className={`${ibmPlexSans.className} ${ibmPlexSans.variable} antialiased`}>
        <NextIntlClientProvider>
          <Web3Providers cookie={cookie}>
            <div className="app-shell flex min-h-dvh flex-col bg-background">
              <Navbar initialTheme={initialTheme} />
              <main className="flex flex-1 flex-col">{children}</main>
              <Footer />
            </div>
          </Web3Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
