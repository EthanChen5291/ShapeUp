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

## Notes

- Convex functions live in `convex/`.
- App Router pages and API routes live in `src/app/`.
- Generated and local-only artifacts such as `.next/`, `coverage/`, and `tsconfig.tsbuildinfo` should not be committed.
