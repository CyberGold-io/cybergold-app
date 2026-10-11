import {getRequestConfig} from 'next-intl/server';
import {hasLocale} from 'next-intl' 
import {routing} from './routing' 

//Internationalization (i18n) Based on language chosen, fetch different json files from messages folder (en.json, fr.json, de.json, ru.json)

export default getRequestConfig(async ({requestLocale}) => {
  // Static for now, we'll change this later
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
 
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
