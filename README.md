# ShapeUp

AI haircut visualization app built with Next.js, Convex, Clerk, S3, Stripe, and our ML generation pipeline.

Users scan or upload a face image, generate haircut looks through the diffusion pipeline, view the result as a 3D Gaussian Splat, and save projects to their account.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the Next.js app:

```bash
npm run dev
```

By default the app runs at `http://localhost:3000`. If that port is busy:

```bash
npm run dev -- --port 3001
```

## Quality Checks

Run the test suite:

```bash
npm test
```

Run tests with coverage:

```bash
npm run test:coverage
```

Run TypeScript:

```bash
npm run typecheck
```

Run ESLint:

```bash
npm run lint
```

## Apple Wallet barber cards

Published barber cards can expose a signed `.pkpass` download. The action is
shown only when all signing settings are present, so local development and
deployments without Apple credentials continue to work normally.

Create a Pass Type ID and Pass Type ID certificate in the Apple Developer
portal, convert the signing certificate, private key, and Apple WWDR
intermediate certificate to PEM, then set:

```bash
APPLE_WALLET_TEAM_ID=ABCDE12345
APPLE_WALLET_PASS_TYPE_ID=pass.cc.tryshapeup.barber
APPLE_WALLET_SIGNER_CERT_BASE64=<base64-encoded signer certificate PEM>
APPLE_WALLET_SIGNER_KEY_BASE64=<base64-encoded private key PEM>
APPLE_WALLET_SIGNER_KEY_PASSPHRASE=<optional private key passphrase>
APPLE_WALLET_WWDR_CERT_BASE64=<base64-encoded Apple WWDR certificate PEM>
```

Keep the certificate and key in deployment secrets; never commit them. The
download endpoint is `/api/barber/<slug>/wallet`. Before launch, download the
official localized Add to Apple Wallet SVG from Apple's badge guidelines and
use it for any Apple-branded marketing treatment.

## Notes

- Convex functions live in `convex/`.
- App Router pages and API routes live in `src/app/`.
- Generated and local-only artifacts such as `.next/`, `coverage/`, and `tsconfig.tsbuildinfo` should not be committed.
