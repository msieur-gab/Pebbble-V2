// Deployment settings. The writer can override publicBase in its own settings.

const local = ['localhost', '127.0.0.1'].includes(location.hostname);

export const config = {
    // Where the player lives. This is the address written onto every stone.
    appBase: new URL('../player/', import.meta.url).href,

    // Public read URL of the R2 bucket (Cloudflare dashboard → bucket → Settings → Public access).
    publicBase: local ? `${location.origin}/bucket` : 'https://pub-REPLACE-ME.r2.dev',

    // Local dev only: the dev server stands in for R2's upload API.
    devEndpoint: local ? `${location.origin}/s3` : null,
};
