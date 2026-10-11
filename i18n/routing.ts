import {defineRouting} from 'next-intl/routing';



export const routing = defineRouting({
  // A list of all locales that are supported
  locales: ['en', 'fr', 'de', /*'ru'*/],
 
  // Used when no locale matches
  defaultLocale: 'en',
  // Resolve the initial locale from the browser when possible.
  localeDetection: true
});

export type SupportedLocale = (typeof routing.locales)[number];
