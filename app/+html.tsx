import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Egen HTML-rot for web. Expos standard bruker height: 100%, som på iPhone Safari
// ikke tar hensyn til at adressefeltet/verktøylinjen skjuler deler av visningen.
// Da blir listene for korte til å skrolle helt ned. 100dvh følger synlig område.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="no">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
html, body { height: 100%; }
@supports (height: 100dvh) {
  html, body, #root { height: 100dvh; }
}
body { overscroll-behavior-y: none; }
`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
