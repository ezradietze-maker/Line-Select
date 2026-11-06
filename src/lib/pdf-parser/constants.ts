/**
 * The biggest bid pack PDF accepted. Uploads go through a Vercel function, which refuses any request over 4.5 MB
 * before this app sees it; 4 MB leaves room for the form around the file. The largest real pack seen (Memphis 777,
 * both seats) is 1.5 MB.
 */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
