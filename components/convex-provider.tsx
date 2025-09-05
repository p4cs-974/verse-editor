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
 * Wrapper hook for Clerk's useAuth that prefers requesting a Clerk JWT template
 * when available. Set NEXT_PUBLIC_CLERK_JWT_TEMPLATE in your environment to the
 * name of a JWT template you created in the Clerk dashboard that issues a JWT
 * containing the user id/claims Convex expects.
 *
 * The wrapper keeps the rest of Clerk's useAuth API intact while overriding
 * getToken to request the JWT template first and fall back to the default token.
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
