# App Store-billeder

`video/` holder en video på ca. 36 sekunder i 1920 × 1080 på engelsk og
dansk, uden lyd. Den uploades på YouTube og indsættes under Feature media.

`billeder/` holder de færdige billeder til App Store (1600 × 900) på dansk og
engelsk, og app-ikonet (1200 × 1200) i en mørk og en lys udgave.

Billederne er bygget i `kilde/`. PREAURAs dele (datoboks, tidslinje, kurvens
beløb, venteliste) bruger samme stil som temaudvidelsen, og admin-siderne er
lavet med Shopifys Polaris-komponenter og appens egne tekster. Videoen
slutter med logoet (`kilde/preaura-logo.jpg`). Tallene er
demodata.

Byg igen (kræver Playwright og netadgang til Google Fonts og cdn.shopify.com):

    cd docs/app-store/kilde
    node slides.js   # billede 1–4
    node admin.js    # billede 5–6
    node icon.js     # ikonet
    node video.js en # videoen (også da), kræver ffmpeg, ca. 8 min.

Ingen tankestreger i teksterne, og ingen Shopify-logo eller priser for appen
i billederne (Shopifys regel 4.2.2 og 4.4.3).
