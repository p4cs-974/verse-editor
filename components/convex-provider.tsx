"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { ConvexReactClient, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";

if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL in your .env file");
}

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL);

/**
 * Wraps Clerk's `useAuth` to provide a Convex-compatible `getToken`.
 *
 * When `NEXT_PUBLIC_CLERK_JWT_TEMPLATE` is set, the returned `getToken` will
 * first attempt to request a token using that JWT template and fall back to
 * Clerk's default `getToken` if the template request fails. If the underlying
 * `getToken` is not available, calls return `null`.
 *
 * The hook preserves the original `useAuth` object shape but replaces `getToken`
 * with the wrapped implementation.
 *
 * @returns The `useAuth` object from Clerk with `getToken` overridden to prefer
 * the configured JWT template.
 */
function useAuthForConvex() {
  const auth = useAuth();
  const originalGetToken = (auth as any)?.getToken;
  const getToken = async (opts?: any) => {
    if (!originalGetToken) return null;
    const template = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
    if (template) {
      try {
        return await originalGetToken({ template });
      } catch (e) {
        // If requesting the template fails, fall back to the default token.
        return await originalGetToken(opts);
      }
    }
    return await originalGetToken(opts);
  };

  // Return the same object shape as Clerk's useAuth but with the wrapped getToken.
  return { ...(auth as any), getToken };
}

/**
 * Client-side helper component that ensures a billing user exists for the
 * authenticated Clerk user. It checks by Clerk user id and creates the minimal
 * billing documents when missing.
 *
 * This component runs inside ConvexProviderWithClerk so it can safely use
 * Convex react hooks.
 */
function EnsureBillingUser() {
  const { user } = useUser();
  // Use the signup-credit mutation and guard by an idempotency key so the credit
  // is only granted once even if this runs multiple times.
  const awardSignupCredit = useMutation(api.billing.createUserWithSignupCredit);
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // Only run when the Clerk user id changes
    if (lastSeen.current === user.id) return;
    lastSeen.current = user.id;

    (async () => {
      try {
        await awardSignupCredit({
          email: user.emailAddresses[0]?.emailAddress,
          name: user.fullName || user.firstName || undefined,
          idempotencyKey: `signup-${user.id}`,
        });
      } catch (err) {
        // Don't block UI; log for debugging.
        // eslint-disable-next-line no-console
        console.error("createUserWithSignupCredit failed:", err);
      }
    })();
  }, [user?.id, awardSignupCredit, user]);

  return null;
}

/**
 * Wraps the app in a Convex provider that uses Clerk-aware authentication and ensures a billing user exists.
 *
 * This component renders a ConvexProvider configured with the shared Convex client and a Clerk-aware `useAuth`
 * hook, mounts an internal side-effect component that creates a minimal billing record for the authenticated
 * Clerk user, and then renders `children`.
 *
 * @param children - React node(s) to render inside the Convex provider.
 * @returns The provider tree containing billing initialization and the supplied children.
 */
export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuthForConvex}>
      <EnsureBillingUser />
      {children}
    </ConvexProviderWithClerk>
  );
}
