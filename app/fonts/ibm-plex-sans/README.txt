IBM Plex Sans — bundled font assets

These unmodified variable WOFF2 files were copied from the successful
production build of App dev aa3e5e6dc1def42ff603dec574357f00510117ea
on 2026-09-27. That build used next/font/google (IBM_Plex_Sans), normal
weights 400/500/600/700 and the Latin preload. Font metadata reports
IBM Plex Sans version 3.201. No font conversion or subsetting was performed.

All six original subsets and their Unicode ranges are retained. Only Latin
is preloaded by next/font/local; subsets.css loads other scripts on demand.
No build-time Google Fonts request is needed.

Upstream sources:
https://github.com/IBM/plex
https://github.com/google/fonts/tree/main/ofl/ibmplexsans
https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap

License: SIL Open Font License 1.1; see OFL.txt.
License source:
https://raw.githubusercontent.com/google/fonts/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl/ibmplexsans/OFL.txt

Files (original build asset; SHA-256):

cyrillic-ext.woff2 (19684 bytes)
7b19b489dc6743ba-s.woff2
c01b3de8c8058462caadd044a6b874a9f4d7098d7d71d6c70e6a278096b8640e

cyrillic.woff2 (25408 bytes)
28793f5c5e3d822d-s.woff2
5bac72520e0a9a5669e08b15fa1e15be6f4da74aa0b2d4315a97c11e1465120a

greek.woff2 (16296 bytes)
c9c3823090ec8b55-s.woff2
a29d4e6345cdb7e2b6daabf4961a6dcafcbc7ed1eac26186ca4a004cd32d64d8

vietnamese.woff2 (9612 bytes)
b3bf17a9041d9433-s.woff2
526a4dd36c3af41f73a623e852302d8947d7fd4c00ee3026d82ef1f24a412fcd

latin-ext.woff2 (25868 bytes)
2801417b65625cf5-s.woff2
ae1d854fefa1167a79071f1afe01d4d51b60c5840c1be36dd74bd5fe7375b405

latin.woff2 (40240 bytes)
26d4368bf94c0ec4-s.p.woff2
056e4e2459f57a0033c8c9c844ff19d6e42ac8602027803d4345823bcc939818

To update the font, review the official IBM/Google Fonts release, replace all
applicable subsets together, preserve their Unicode ranges and license, and
check the production build and all supported locales. Keep the Latin-only
preload to avoid downloading unused script subsets on every page.

Phase 1 website typography (2026-10-26)
The existing variable normal faces are registered for weights 300-700.
The six added *-italic.woff2 faces are unmodified Google Fonts v23 variable
files (available axis 100-700; registered 300-600 in next/font/local).
Latin normal/italic are provided by next/font/local. italic-subsets.css
loads other scripts on demand. Both styles share the existing OFL license.
Source CSS: https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@1,100..700&display=swap
