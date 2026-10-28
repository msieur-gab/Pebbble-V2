// Deployment settings. The writer can override publicBase in its own settings.

const onLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);

// On localhost, add ?r2 to the address to use the real bucket instead of the dev server's stand-in.
// Remembered for the tab, so it survives the writer's own navigation.
try { if (new URLSearchParams(location.search).has('r2')) sessionStorage.setItem('pebbble-real-r2', '1'); } catch {}
const realR2 = (() => { try { return sessionStorage.getItem('pebbble-real-r2') === '1'; } catch { return false; } })();
const local = onLocalhost && !realR2;

export const config = {
    // Where the player lives. This is the address written onto every stone.
    // Testing against the real bucket from localhost still writes the live player's address.
    appBase: onLocalhost && realR2 ? 'https://msieur-gab.github.io/Pebbble-V2/player/' : new URL('../player/', import.meta.url).href,

    // Public read URL of the R2 bucket (Cloudflare dashboard → bucket → Settings → Public access).
    publicBase: local ? `${location.origin}/bucket` : 'https://pub-073de7a826d54d4490642e8ce5e90072.r2.dev',

    // Local dev only: the dev server stands in for R2's upload API.
    devEndpoint: local ? `${location.origin}/s3` : null,
};
