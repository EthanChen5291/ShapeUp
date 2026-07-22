import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isAdminUserId } from './lib/adminAllowlist';

// Pages: /admin, /admin/feedback, /admin-admin … API: /api/admin-*
const isAdminRoute = createRouteMatcher(['/admin(.*)', '/api/admin(.*)']);

export default clerkMiddleware(async (auth, req) => {
  // The public product is now deliberately narrow. Preserve old URLs without
  // preserving the old consumer app as a second competing product surface.
  const path = req.nextUrl.pathname;
  if (path === '/dashboard' || path.startsWith('/studio/') || path === '/preview') {
    return NextResponse.redirect(new URL('/barber', req.url));
  }
  if (path === '/pricing' || path === '/for-barbers') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  if (isAdminRoute(req)) {
    const { userId } = await auth();
    console.log('[admin-mw]', req.nextUrl.pathname, 'userId=', userId, 'isAdmin=', isAdminUserId(userId));
    if (!isAdminUserId(userId)) {
      // API callers get a clean 403; page visitors are bounced home so the
      // admin shells never even render for non-admins.
      if (req.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', req.url));
    }
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
